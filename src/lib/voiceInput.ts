import { Channel } from "@tauri-apps/api/core";
import { AudioCapture } from "./audioCapture";
import {
  whisperStartSession,
  whisperPushAudio,
  whisperStopSession,
  whisperCancelSession,
  type WhisperEvent,
} from "./whisper";

export type VoiceInputState = "idle" | "listening" | "processing" | "loading" | "error";

interface VoiceInputHandlers {
  onStateChange?: (state: VoiceInputState) => void;
  onInterimTranscript?: (transcript: string) => void;
  onFinalTranscript?: (transcript: string) => void;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
}

let sessionCounter = 0;

export class VoiceInputController {
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

    const sessionId = `whisper_${++sessionCounter}_${Date.now()}`;
    this.whisperSessionId = sessionId;
    this.updateState("loading");

    // Create channel for whisper events
    const channel = new Channel<WhisperEvent>();
    channel.onmessage = (event: WhisperEvent) => {
      // Ignore events for stale sessions
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
          // Model loaded, start audio capture
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
      // Distinguish model-not-found for auto-download flow
      if (message.includes("Model not found") || message.includes("not found")) {
        this.updateState("error");
        this.handlers.onError?.(message);
      } else {
        this.updateState("error");
        this.handlers.onError?.(message);
      }
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
            // Convert Float32Array to number[] for JSON serialization
            whisperPushAudio(sessionId, Array.from(samples)).catch(() => {});
          },
        },
      );
      this.updateState("listening");
    } catch (err) {
      // Audio capture failed — cancel the whisper session
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
    console.log(`[voice] ${prev} → ${state}`);
    this.handlers.onStateChange?.(state);
  }
}

export const voiceInputController = new VoiceInputController();
