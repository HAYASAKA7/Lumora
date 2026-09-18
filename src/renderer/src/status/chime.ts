/** Two sessions finishing together should not ring twice. */
const QUIET_AFTER_CHIME_MS = 1_500;

type AudioContextConstructor = new () => AudioContext;

let context: AudioContext | null = null;
let lastChimeAt = Number.NEGATIVE_INFINITY;

/**
 * A short two-note chime, drawn with Web Audio rather than shipped as a file.
 * It stays quiet where there is no audio device, and a failure to play is not
 * worth telling anyone about.
 */
export function playSessionChime(now: number = Date.now()): void {
  if (now - lastChimeAt < QUIET_AFTER_CHIME_MS) return;
  const AudioContextClass = (window as unknown as {
    AudioContext?: AudioContextConstructor;
  }).AudioContext;
  if (AudioContextClass === undefined) return;
  lastChimeAt = now;
  try {
    context ??= new AudioContextClass();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const start = context.currentTime;
    for (const [offset, frequency] of [[0, 880], [0.13, 1318.5]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.1, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.38);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.4);
    }
  } catch {
    // No audio device, or the context was refused: the dot and the tip still show.
  }
}
