export const REST_CHIME_KEY = "workout-rest-chime";

/** The chime is on until someone turns it off. */
export function readRestChime(stored: string | null): boolean {
  return stored !== "off";
}

export function restChimeStored(enabled: boolean): string {
  return enabled ? "on" : "off";
}

export function shouldPlayRestChime(input: {
  enabled: boolean;
  remainingMs: number;
  alreadyPlayed: boolean;
  skipped: boolean;
}): boolean {
  return input.enabled && !input.skipped && !input.alreadyPlayed && input.remainingMs <= 0;
}

/**
 * Two short tones. Browsers without Web Audio, or a blocked resume, stay quiet.
 * Call after a tap so iOS will allow the sound when the timer later ends.
 */
export function playRestChime(): void {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    return;
  }
  try {
    const context = sharedContext(Ctx);
    if (context.state !== "running") {
      void context.resume();
    }
    const start = context.currentTime;
    tone(context, 880, start, 0.22);
    tone(context, 1175, start + 0.16, 0.24);
  } catch {
    // A blocked audio device should not stop the timer.
  }
}

/**
 * Call from a tap. iOS keeps audio locked until a sound starts inside a user
 * gesture, and locks it again ("interrupted") after the app is backgrounded,
 * so a silent one-sample buffer is played whenever the context is not running.
 */
export function unlockRestAudio(): void {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    return;
  }
  try {
    const context = sharedContext(Ctx);
    if (context.state === "running") {
      return;
    }
    void context.resume();
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.start(0);
  } catch {
    // Unlocking is best-effort. The timer still finishes.
  }
}

let audio: AudioContext | null = null;

function sharedContext(Ctx: typeof AudioContext): AudioContext {
  audio ??= new Ctx();
  return audio;
}

function tone(context: AudioContext, frequency: number, start: number, length: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + length);
}
