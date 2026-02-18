let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * Subtle two-tone ascending chime for the "waiting for input" notification.
 * Uses Web Audio API — no external files needed.
 */
export function playWaitingSound() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = 0.12;
  master.connect(ctx.destination);

  // First tone — soft ping
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.value = 660;
  gain1.gain.setValueAtTime(1, now);
  gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
  osc1.connect(gain1);
  gain1.connect(master);
  osc1.start(now);
  osc1.stop(now + 0.15);

  // Second tone — slightly higher, offset by 100ms
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.value = 880;
  gain2.gain.setValueAtTime(0.01, now);
  gain2.gain.setValueAtTime(1, now + 0.1);
  gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
  osc2.connect(gain2);
  gain2.connect(master);
  osc2.start(now + 0.1);
  osc2.stop(now + 0.3);
}
