/* A short tone when a new alert arrives while the dashboard is open, made with Web
 * Audio (no sound files to host). A fall gets an urgent high-low pattern, other alerts
 * a soft two-note chime. Browsers allow sound only after the person has interacted
 * with the page, so unlockChime() runs on their first click or key press — and again
 * when a chime is due, since a click can come before anything was listening for it
 * (a page reloaded and clicked while still loading would otherwise stay silent).
 */

let ctx: AudioContext | null = null;

export function unlockChime(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no Web Audio: alerts stay silent */ }
}

/** [frequency Hz, start s, length s] */
const PATTERN: Record<'fall' | 'alert', [number, number, number][]> = {
  fall: [[1046.5, 0, 0.16], [784, 0.2, 0.16], [1046.5, 0.4, 0.16], [784, 0.6, 0.16]],
  alert: [[880, 0, 0.14], [1174.7, 0.17, 0.22]],
};

/** False while the browser would still block sound: nobody has clicked or typed on the page yet. */
export function chimeAllowed(): boolean {
  return navigator.userActivation?.hasBeenActive ?? true;
}

export function playChime(kind: 'fall' | 'alert'): void {
  if (!chimeAllowed()) return;
  unlockChime();
  if (!ctx) return;
  if (ctx.state === 'running') schedule(ctx, kind);
  else void ctx.resume().then(() => { if (ctx?.state === 'running') schedule(ctx, kind); }).catch(() => undefined);
}

function schedule(ctx: AudioContext, kind: 'fall' | 'alert'): void {
  const t0 = ctx.currentTime + 0.02;
  for (const [freq, at, len] of PATTERN[kind]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    /* Quick fade in and out: no clicks, and quiet enough not to startle. */
    gain.gain.setValueAtTime(0, t0 + at);
    gain.gain.linearRampToValueAtTime(kind === 'fall' ? 0.22 : 0.12, t0 + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + len + 0.02);
  }
}
