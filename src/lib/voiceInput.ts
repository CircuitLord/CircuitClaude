import { Channel } from "@tauri-apps/api/core";
import { AudioCapture } from "./audioCapture";
import {
  whisperStartSession,
  whisperPushAudio,
  whisperStopSession,
  whisperCancelSession,
  type WhisperEvent,
} from "./whisper";
import type { VoiceEngine } from "../types";

// ---------------------------------------------------------------------------
//  Common types & interface
// ---------------------------------------------------------------------------

export type VoiceInputState = "idle" | "listening" | "processing" | "loading" | "unsupported" | "error";

interface VoiceInputHandlers {
  onStateChange?: (state: VoiceInputState) => void;
  onInterimTranscript?: (transcript: string) => void;
  onFinalTranscript?: (transcript: string) => void;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
}

interface VoiceInputEngine {
  configureHandlers(handlers: VoiceInputHandlers): void;
  isSupported(): boolean;
  isListening(): boolean;
  setDeviceId(deviceId: string | null | undefined): void;
  setModelName(name: string): void;
  start(): Promise<boolean>;
  stop(): void;
  cancel(): void;
}

// ---------------------------------------------------------------------------
//  WhisperEngine — local CUDA/CPU inference via whisper.cpp
// ---------------------------------------------------------------------------

let whisperSessionCounter = 0;

class WhisperEngine implements VoiceInputEngine {
  private handlers: VoiceInputHandlers = {};
  private audioCapture = new AudioCapture();
  private whisperSessionId: string | null = null;
  private state: VoiceInputState = "idle";
  private selectedDeviceId = "default";
  private modelName = "base.en";

  configureHandlers(handlers: VoiceInputHandlers): void {
    this.handlers = handlers;
  }

  isSupported(): boolean {
    return true;
  }

  isListening(): boolean {
    return this.state === "listening";
  }

  setDeviceId(deviceId: string | null | undefined): void {
    this.selectedDeviceId = deviceId && deviceId.trim().length > 0 ? deviceId : "default";
  }

  setModelName(name: string): void {
    this.modelName = name || "base.en";
  }

  async start(): Promise<boolean> {
    if (this.state === "listening" || this.state === "loading") return true;

    const sessionId = `whisper_${++whisperSessionCounter}_${Date.now()}`;
    this.whisperSessionId = sessionId;
    this.updateState("loading");

    const channel = new Channel<WhisperEvent>();
    channel.onmessage = (event: WhisperEvent) => {
      if (this.whisperSessionId !== sessionId) return;

      switch (event.type) {
        case "Transcript":
          if (event.data.is_final) {
            this.handlers.onFinalTranscript?.(event.data.text);
          } else {
            this.handlers.onInterimTranscript?.(event.data.text);
          }
          break;
        case "Ready":
          this.startAudioCapture(sessionId);
          break;
        case "Error":
          this.updateState("error");
          this.handlers.onError?.(event.data.message);
          break;
      }
    };

    try {
      await whisperStartSession(sessionId, this.modelName, channel);
      return true;
    } catch (err) {
      this.whisperSessionId = null;
      const message = err instanceof Error ? err.message : String(err);
      this.updateState("error");
      this.handlers.onError?.(message);
      return false;
    }
  }

  stop(): void {
    if (!this.whisperSessionId) return;
    const sessionId = this.whisperSessionId;
    this.whisperSessionId = null;

    this.audioCapture.stop();
    this.updateState("processing");

    whisperStopSession(sessionId)
      .then((finalText) => {
        this.handlers.onFinalTranscript?.(finalText);
        this.updateState("idle");
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.handlers.onError?.(message);
        this.updateState("idle");
      });
  }

  cancel(): void {
    if (!this.whisperSessionId) return;
    const sessionId = this.whisperSessionId;
    this.whisperSessionId = null;

    this.audioCapture.stop();
    whisperCancelSession(sessionId).catch(() => {});
    this.updateState("idle");
  }

  private async startAudioCapture(sessionId: string): Promise<void> {
    try {
      await this.audioCapture.start(
        this.selectedDeviceId !== "default" ? this.selectedDeviceId : undefined,
        {
          onSamples: (samples: Float32Array) => {
            if (this.whisperSessionId !== sessionId) return;
            whisperPushAudio(sessionId, Array.from(samples)).catch(() => {});
          },
        },
      );
      this.updateState("listening");
    } catch (err) {
      this.whisperSessionId = null;
      whisperCancelSession(sessionId).catch(() => {});
      this.updateState("error");
      const message = err instanceof Error ? err.message : String(err);
      this.handlers.onError?.(message);
    }
  }

  private updateState(state: VoiceInputState): void {
    const prev = this.state;
    this.state = state;
    console.log(`[voice:whisper] ${prev} → ${state}`);
    this.handlers.onStateChange?.(state);
  }
}

// ---------------------------------------------------------------------------
//  EdgeEngine — browser Web Speech API (Edge/Chromium)
// ---------------------------------------------------------------------------

const EDGE_DEFAULT_LANG = "en-US";
const EDGE_RESTART_BASE_MS = 300;
const EDGE_RESTART_MAX_MS = 2000;
const EDGE_RECOVERY_STATUS = "recovering microphone...";

function normalizeTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function mapSpeechError(error: SpeechRecognitionErrorCode): string {
  switch (error) {
    case "audio-capture":
      return "microphone unavailable";
    case "not-allowed":
      return "microphone permission denied";
    case "network":
      return "speech service network error";
    case "no-speech":
      return "no speech detected";
    case "aborted":
      return "voice capture aborted";
    default:
      return "voice capture failed";
  }
}

function isRecoverableSpeechError(error: SpeechRecognitionErrorCode): boolean {
  switch (error) {
    case "aborted":
    case "network":
    case "no-speech":
      return true;
    default:
      return false;
  }
}

class EdgeEngine implements VoiceInputEngine {
  private recognition: SpeechRecognition | null = null;
  private micStream: MediaStream | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: VoiceInputHandlers = {};
  private committedFinalSegments: string[] = [];
  private activeSegmentsByIndex: string[] = [];
  private activeFinalizedIndices: Set<number> = new Set();
  private stopRequested = false;
  private cancelRequested = false;
  private sessionActive = false;
  private selectedDeviceId = "default";
  private starting = false;
  private restartAttempt = 0;
  private state: VoiceInputState = "idle";

  configureHandlers(handlers: VoiceInputHandlers): void {
    this.handlers = handlers;
  }

  isSupported(): boolean {
    return this.getCtor() !== null;
  }

  isListening(): boolean {
    return this.state === "listening" || (this.sessionActive && !this.stopRequested);
  }

  setDeviceId(deviceId: string | null | undefined): void {
    this.selectedDeviceId = deviceId && deviceId.trim().length > 0 ? deviceId : "default";
  }

  setModelName(_name: string): void {
    // No-op — Edge STT doesn't use models
  }

  async start(): Promise<boolean> {
    if (this.sessionActive || this.starting || this.state === "listening") return true;
    if (!this.getCtor()) {
      this.updateState("unsupported");
      this.handlers.onError?.("voice unavailable on this system");
      return false;
    }
    this.clearRestartTimer();
    this.detachRecognition();
    this.cleanupMicStream();
    this.resetTranscriptState();
    this.stopRequested = false;
    this.cancelRequested = false;
    this.sessionActive = true;
    this.restartAttempt = 0;

    return this.startRecognition(false);
  }

  stop(): void {
    this.starting = false;
    if (!this.sessionActive && !this.recognition && !this.restartTimer) return;
    this.stopRequested = true;
    this.cancelRequested = false;
    this.sessionActive = false;
    this.clearRestartTimer();
    this.updateState("processing");

    if (this.recognition) {
      try {
        this.recognition.stop();
        return;
      } catch {
        this.stopRequested = false;
        this.resetTranscriptState();
        this.detachRecognition();
        this.cleanupMicStream();
        this.updateState("idle");
        this.handlers.onError?.("unable to stop voice capture");
        return;
      }
    }

    const finalized = this.buildFinalTranscript();
    this.stopRequested = false;
    this.resetTranscriptState();
    this.detachRecognition();
    this.cleanupMicStream();
    this.handlers.onFinalTranscript?.(finalized);
    this.updateState("idle");
  }

  cancel(): void {
    this.starting = false;
    if (!this.sessionActive && !this.recognition && !this.restartTimer) return;
    this.cancelRequested = true;
    this.stopRequested = false;
    this.sessionActive = false;
    this.clearRestartTimer();

    if (this.recognition) {
      try {
        this.recognition.stop();
        return;
      } catch {
        // Fall through to manual cleanup
      }
    }

    this.cancelRequested = false;
    this.resetTranscriptState();
    this.detachRecognition();
    this.cleanupMicStream();
    this.updateState("idle");
  }

  private async startRecognition(isRecoveryStart: boolean): Promise<boolean> {
    const Ctor = this.getCtor();
    if (!Ctor) {
      this.sessionActive = false;
      this.updateState("unsupported");
      this.handlers.onError?.("voice unavailable on this system");
      return false;
    }
    this.starting = true;
    this.clearRestartTimer();
    this.detachRecognition();
    this.cleanupMicStream();

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = EDGE_DEFAULT_LANG;

    let preferredTrack: MediaStreamTrack | undefined;
    const supportsTrackInput = recognition.start.length > 0;
    if (this.selectedDeviceId !== "default") {
      if (supportsTrackInput) {
        try {
          preferredTrack = await this.getPreferredAudioTrack();
        } catch (err) {
          this.starting = false;
          this.sessionActive = false;
          this.updateState("error");
          this.handlers.onError?.(String(err));
          return false;
        }
      }
    }

    recognition.onstart = () => {
      this.starting = false;
      this.restartAttempt = 0;
      this.updateState("listening");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (event.results.length < this.activeSegmentsByIndex.length) {
        this.activeSegmentsByIndex.length = event.results.length;
        this.activeFinalizedIndices.forEach((idx) => {
          if (idx >= event.results.length) {
            this.activeFinalizedIndices.delete(idx);
          }
        });
      }

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        const normalized = normalizeTranscript(transcript);
        this.activeSegmentsByIndex[i] = normalized;
        if (result.isFinal) {
          this.activeFinalizedIndices.add(i);
        } else {
          this.activeFinalizedIndices.delete(i);
        }
      }

      this.handlers.onInterimTranscript?.(this.buildLiveTranscript());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.starting = false;
      if (!this.sessionActive) return;
      if (isRecoverableSpeechError(event.error)) {
        this.handlers.onInfo?.(EDGE_RECOVERY_STATUS);
        try {
          recognition.stop();
        } catch {
          this.detachRecognition();
          this.cleanupMicStream();
          this.scheduleRestart();
        }
        return;
      }
      this.stopRequested = false;
      this.cancelRequested = false;
      this.sessionActive = false;
      this.clearRestartTimer();
      this.updateState("error");
      this.handlers.onError?.(mapSpeechError(event.error));
    };

    recognition.onend = () => {
      this.starting = false;
      const finalized = this.buildFinalTranscript();
      const shouldEmitTranscript = this.stopRequested && !this.cancelRequested;
      this.detachRecognition();
      this.cleanupMicStream();

      if (this.cancelRequested) {
        this.cancelRequested = false;
        this.stopRequested = false;
        this.sessionActive = false;
        this.clearRestartTimer();
        this.resetTranscriptState();
        this.updateState("idle");
        return;
      }

      if (shouldEmitTranscript) {
        this.stopRequested = false;
        this.sessionActive = false;
        this.clearRestartTimer();
        this.resetTranscriptState();
        this.handlers.onFinalTranscript?.(finalized);
        this.updateState("idle");
        return;
      }

      if (!this.sessionActive) {
        this.stopRequested = false;
        this.resetTranscriptState();
        this.clearRestartTimer();
        this.updateState("idle");
        return;
      }

      this.commitActiveFinalSegments();
      this.handlers.onInfo?.(EDGE_RECOVERY_STATUS);
      this.scheduleRestart();
    };

    try {
      if (preferredTrack) {
        recognition.start(preferredTrack);
      } else {
        recognition.start();
      }
      this.recognition = recognition;
      return true;
    } catch {
      this.starting = false;
      this.detachRecognition();
      this.cleanupMicStream();
      if (isRecoveryStart && this.sessionActive) {
        this.handlers.onInfo?.(EDGE_RECOVERY_STATUS);
        this.scheduleRestart();
        return false;
      }
      this.sessionActive = false;
      this.updateState("error");
      this.handlers.onError?.("unable to start voice capture");
      return false;
    }
  }

  private updateState(state: VoiceInputState): void {
    const prev = this.state;
    this.state = state;
    console.log(`[voice:edge] ${prev} → ${state}`);
    this.handlers.onStateChange?.(state);
  }

  private commitActiveFinalSegments(): void {
    const ordered = [...this.activeFinalizedIndices].sort((a, b) => a - b);
    for (const idx of ordered) {
      const text = this.activeSegmentsByIndex[idx] ?? "";
      if (!text) continue;
      this.committedFinalSegments.push(text);
    }
    this.activeSegmentsByIndex = [];
    this.activeFinalizedIndices.clear();
  }

  private buildLiveTranscript(): string {
    const activeSegments = this.activeSegmentsByIndex.filter((s) => s.length > 0);
    return normalizeTranscript([...this.committedFinalSegments, ...activeSegments].join(" "));
  }

  private buildFinalTranscript(): string {
    const finalizedActiveSegments = [...this.activeFinalizedIndices]
      .sort((a, b) => a - b)
      .map((idx) => this.activeSegmentsByIndex[idx] ?? "")
      .filter((s) => s.length > 0);
    return normalizeTranscript([...this.committedFinalSegments, ...finalizedActiveSegments].join(" "));
  }

  private resetTranscriptState(): void {
    this.committedFinalSegments = [];
    this.activeSegmentsByIndex = [];
    this.activeFinalizedIndices.clear();
  }

  private detachRecognition(): void {
    if (!this.recognition) return;
    this.recognition.onstart = null;
    this.recognition.onresult = null;
    this.recognition.onerror = null;
    this.recognition.onend = null;
    this.recognition = null;
  }

  private cleanupMicStream(): void {
    if (!this.micStream) return;
    for (const track of this.micStream.getTracks()) {
      track.stop();
    }
    this.micStream = null;
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private scheduleRestart(): void {
    if (!this.sessionActive || this.stopRequested) return;
    this.clearRestartTimer();
    const delayMs = Math.min(EDGE_RESTART_BASE_MS * 2 ** this.restartAttempt, EDGE_RESTART_MAX_MS);
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.sessionActive || this.stopRequested) return;
      void this.startRecognition(true);
    }, delayMs);
  }

  private async getPreferredAudioTrack(): Promise<MediaStreamTrack | undefined> {
    if (this.selectedDeviceId === "default") return undefined;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("microphone selection unsupported");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: this.selectedDeviceId } },
      });
      this.micStream = stream;
      return stream.getAudioTracks()[0];
    } catch {
      throw new Error("selected microphone unavailable");
    }
  }

  private getCtor(): SpeechRecognitionConstructor | null {
    if (typeof window === "undefined") return null;
    if (typeof window.SpeechRecognition === "function") return window.SpeechRecognition;
    if (typeof window.webkitSpeechRecognition === "function") return window.webkitSpeechRecognition;
    return null;
  }
}

// ---------------------------------------------------------------------------
//  DelegatingController — routes to the active engine
// ---------------------------------------------------------------------------

class DelegatingController implements VoiceInputEngine {
  private whisper = new WhisperEngine();
  private edge = new EdgeEngine();
  private activeEngine: VoiceEngine = "whisper";
  private handlers: VoiceInputHandlers = {};

  setEngine(engine: VoiceEngine): void {
    if (engine === this.activeEngine) return;
    if (this.getEngine().isListening()) {
      this.getEngine().cancel();
    }
    this.activeEngine = engine;
    this.getEngine().configureHandlers(this.handlers);
  }

  getActiveEngine(): VoiceEngine {
    return this.activeEngine;
  }

  private getEngine(): VoiceInputEngine {
    return this.activeEngine === "whisper" ? this.whisper : this.edge;
  }

  configureHandlers(handlers: VoiceInputHandlers): void {
    this.handlers = handlers;
    this.whisper.configureHandlers(handlers);
    this.edge.configureHandlers(handlers);
  }

  isSupported(): boolean { return this.getEngine().isSupported(); }
  isListening(): boolean { return this.getEngine().isListening(); }
  setDeviceId(deviceId: string | null | undefined): void { this.getEngine().setDeviceId(deviceId); }
  setModelName(name: string): void { this.getEngine().setModelName(name); }
  start(): Promise<boolean> { return this.getEngine().start(); }
  stop(): void { this.getEngine().stop(); }
  cancel(): void { this.getEngine().cancel(); }
}

export const voiceInputController = new DelegatingController();
