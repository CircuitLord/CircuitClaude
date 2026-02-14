export type VoiceInputState = "idle" | "listening" | "processing" | "unsupported" | "error";

interface VoiceInputHandlers {
  onStateChange?: (state: VoiceInputState) => void;
  onInterimTranscript?: (transcript: string) => void;
  onFinalTranscript?: (transcript: string) => void;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
}

const DEFAULT_LANG = "en-US";
const RESTART_BASE_MS = 300;
const RESTART_MAX_MS = 2000;
const RECOVERY_STATUS_MESSAGE = "recovering microphone...";

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

export class VoiceInputController {
  private recognition: SpeechRecognition | null = null;
  private micStream: MediaStream | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: VoiceInputHandlers = {};
  private finalSegments: string[] = [];
  private stopRequested = false;
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
    this.finalSegments = [];
    this.stopRequested = false;
    this.sessionActive = true;
    this.restartAttempt = 0;

    return this.startRecognition(false);
  }

  stop(): void {
    this.starting = false;
    if (!this.sessionActive && !this.recognition && !this.restartTimer) return;
    this.stopRequested = true;
    this.sessionActive = false;
    this.clearRestartTimer();
    this.updateState("processing");

    if (this.recognition) {
      try {
        this.recognition.stop();
        return;
      } catch {
        this.stopRequested = false;
        this.finalSegments = [];
        this.detachRecognition();
        this.cleanupMicStream();
        this.updateState("idle");
        this.handlers.onError?.("unable to stop voice capture");
        return;
      }
    }

    const finalized = normalizeTranscript(this.finalSegments.join(" "));
    this.stopRequested = false;
    this.finalSegments = [];
    this.detachRecognition();
    this.cleanupMicStream();
    this.handlers.onFinalTranscript?.(finalized);
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
    recognition.lang = DEFAULT_LANG;

    let preferredTrack: MediaStreamTrack | undefined;
    const supportsTrackInput = recognition.start.length > 0;
    if (this.selectedDeviceId !== "default") {
      if (!supportsTrackInput) {
        this.handlers.onInfo?.("selected mic unsupported here; using system default");
      } else {
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
      const interimSegments: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        const normalized = normalizeTranscript(transcript);
        if (!normalized) continue;
        if (result.isFinal) {
          this.finalSegments.push(normalized);
        } else {
          interimSegments.push(normalized);
        }
      }
      const liveTranscript = normalizeTranscript([...this.finalSegments, ...interimSegments].join(" "));
      this.handlers.onInterimTranscript?.(liveTranscript);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.starting = false;
      if (!this.sessionActive) return;
      if (isRecoverableSpeechError(event.error)) {
        this.handlers.onInfo?.(RECOVERY_STATUS_MESSAGE);
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
      this.sessionActive = false;
      this.clearRestartTimer();
      this.updateState("error");
      this.handlers.onError?.(mapSpeechError(event.error));
    };

    recognition.onend = () => {
      this.starting = false;
      const finalized = normalizeTranscript(this.finalSegments.join(" "));
      const shouldEmitTranscript = this.stopRequested;
      this.detachRecognition();
      this.cleanupMicStream();

      if (shouldEmitTranscript) {
        this.stopRequested = false;
        this.sessionActive = false;
        this.clearRestartTimer();
        this.finalSegments = [];
        this.handlers.onFinalTranscript?.(finalized);
        this.updateState("idle");
        return;
      }

      if (!this.sessionActive) {
        this.stopRequested = false;
        this.finalSegments = [];
        this.clearRestartTimer();
        this.updateState("idle");
        return;
      }

      this.handlers.onInfo?.(RECOVERY_STATUS_MESSAGE);
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
        this.handlers.onInfo?.(RECOVERY_STATUS_MESSAGE);
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
    this.state = state;
    this.handlers.onStateChange?.(state);
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
    const delayMs = Math.min(RESTART_BASE_MS * 2 ** this.restartAttempt, RESTART_MAX_MS);
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.sessionActive || this.stopRequested) return;
      void this.startRecognition(true);
    }, delayMs);
  }

  private async getPreferredAudioTrack(): Promise<MediaStreamTrack | undefined> {
    if (this.selectedDeviceId === "default") {
      return undefined;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("microphone selection unsupported");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: this.selectedDeviceId },
        },
      });
      this.micStream = stream;
      return stream.getAudioTracks()[0];
    } catch {
      throw new Error("selected microphone unavailable");
    }
  }

  private getCtor(): SpeechRecognitionConstructor | null {
    if (typeof window === "undefined") return null;
    if (typeof window.SpeechRecognition === "function") {
      return window.SpeechRecognition;
    }
    if (typeof window.webkitSpeechRecognition === "function") {
      return window.webkitSpeechRecognition;
    }
    return null;
  }
}

export const voiceInputController = new VoiceInputController();
