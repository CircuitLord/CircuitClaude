const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

interface AudioCaptureCallbacks {
  onSamples: (samples: Float32Array) => void;
  onError?: (message: string) => void;
}

export class AudioCapture {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;

  async start(deviceId: string | undefined, callbacks: AudioCaptureCallbacks): Promise<void> {
    this.stop();

    const constraints: MediaStreamConstraints = {
      audio: deviceId && deviceId !== "default"
        ? { deviceId: { exact: deviceId } }
        : true,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      throw new Error("microphone unavailable");
    }

    this.context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (event: AudioProcessingEvent) => {
      const input = event.inputBuffer.getChannelData(0);
      // Copy to avoid referencing the recycled buffer
      callbacks.onSamples(new Float32Array(input));
    };

    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  stop(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }
}
