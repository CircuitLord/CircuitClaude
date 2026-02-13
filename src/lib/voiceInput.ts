export type VoiceInputState = "idle" | "listening" | "processing" | "unsupported" | "error";

interface VoiceInputHandlers {
  onStateChange?: (state: VoiceInputState) => void;
  onInterimTranscript?: (transcript: string) => void;
  onFinalTranscript?: (transcript: string) => void;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
}

const DEFAULT_LANG = "en-US";

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

export class VoiceInputController {
  private recognition: SpeechRecognition | null = null;
  private micStream: MediaStream | null = null;
  private handlers: VoiceInputHandlers = {};
  private finalSegments: string[] = [];
  private stopRequested = false;
  private selectedDeviceId = "default";
  private starting = false;
  private state: VoiceInputState = "idle";

  configureHandlers(handlers: VoiceInputHandlers): void {
    this.handlers = handlers;
  }

  isSupported(): boolean {
    return this.getCtor() !== null;
  }

  isListening(): boolean {
    return this.state === "listening";
  }

  setDeviceId(deviceId: string | null | undefined): void {
    this.selectedDeviceId = deviceId && deviceId.trim().length > 0 ? deviceId : "default";
  }

  async start(): Promise<boolean> {
    if (this.state === "listening" || this.starting) return true;
    const Ctor = this.getCtor();
    if (!Ctor) {
      this.updateState("unsupported");
      this.handlers.onError?.("voice unavailable on this system");
      return false;
    }
    this.starting = true;

    this.detachRecognition();
    this.cleanupMicStream();
    this.finalSegments = [];
    this.stopRequested = false;

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
          this.updateState("error");
          this.handlers.onError?.(String(err));
          return false;
        }
      }
    }

    recognition.onstart = () => {
      this.starting = false;
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
        this.handlers.onFinalTranscript?.(finalized);
      }
      this.updateState("idle");
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
      this.updateState("error");
      this.handlers.onError?.("unable to start voice capture");
      return false;
    }
  }

  stop(): void {
    this.starting = false;
    if (!this.recognition) return;
    this.stopRequested = true;
    this.updateState("processing");
    try {
      this.recognition.stop();
    } catch {
      this.detachRecognition();
      this.cleanupMicStream();
      this.updateState("idle");
      this.handlers.onError?.("unable to stop voice capture");
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
