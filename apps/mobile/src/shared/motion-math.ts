/* The arithmetic behind the app's few motions, kept as plain worklet functions so it
 * runs on the UI thread inside animated styles AND can be unit-tested. Progress
 * values are 0..1; nothing here knows about React or Reanimated.
 */

/* One ring growing out of a point: scale 1 → `spread`, opacity up to `peak` and back
 * to nothing. It is invisible at BOTH ends (0 and 1), so a ring at rest shows nothing
 * and a looping ripple wraps from the end of one cycle to the start of the next
 * without a pop. The quick fade-in (first eighth) keeps the ring from appearing as a
 * hard outline on top of whatever it rings. */
export function ringFrame(k: number, spread: number, peak: number): { scale: number; opacity: number } {
  'worklet';
  if (k <= 0 || k >= 1) return { scale: 1, opacity: 0 };
  return { scale: 1 + (spread - 1) * k, opacity: peak * Math.min(1, k * 8) * (1 - k) };
}

/* Entrance delay for row `index` of a list: rows past `cap` get no entrance (null), so
 * a long list never makes the reader wait for rows they cannot see yet. */
export function staggerDelay(index: number, step: number, cap: number): number | null {
  if (index < 0 || index >= cap) return null;
  return index * step;
}

/* Left → right reveal by counter-translation: a clipping view shifted LEFT by `shift`
 * holds the content shifted RIGHT by the same amount, so the content stays put while
 * the clip's right edge sweeps from 0 to `width`. Pure transforms — no layout work per
 * frame, and nothing needs to know the colour behind the chart. */
export function revealShift(width: number, progress: number): number {
  'worklet';
  return width * (1 - Math.min(1, Math.max(0, progress)));
}
