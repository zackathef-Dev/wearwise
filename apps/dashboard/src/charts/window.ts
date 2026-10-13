/* The time window every chart on a session page shares: seconds from the session's
   first sample. Kept inside the session's domain and never narrower than MIN_SPAN. */

export interface TimeWindow { start: number; end: number }

export const MIN_SPAN = 0.05; // 50 ms: a dozen ECG samples

export function clampWindow(w: TimeWindow, domain: TimeWindow): TimeWindow {
  const full = domain.end - domain.start;
  let span = Math.min(Math.max(w.end - w.start, Math.min(MIN_SPAN, full)), full);
  if (!(span > 0)) span = full;
  let start = Math.min(Math.max(w.start, domain.start), domain.end - span);
  if (!Number.isFinite(start)) start = domain.start;
  return { start, end: start + span };
}

/** Zoom by `factor` (< 1 zooms in) keeping `center` where it is on screen. */
export function zoomWindow(w: TimeWindow, factor: number, domain: TimeWindow, center = (w.start + w.end) / 2): TimeWindow {
  const f = (center - w.start) / (w.end - w.start || 1);
  const span = (w.end - w.start) * factor;
  return clampWindow({ start: center - f * span, end: center - f * span + span }, domain);
}

/** Shift by a fraction of the current span (negative = earlier). */
export function panWindow(w: TimeWindow, fraction: number, domain: TimeWindow): TimeWindow {
  const d = (w.end - w.start) * fraction;
  return clampWindow({ start: w.start + d, end: w.end + d }, domain);
}

export const isWhole = (w: TimeWindow, domain: TimeWindow): boolean =>
  w.start <= domain.start + 1e-9 && w.end >= domain.end - 1e-9;

/** A window of `span` seconds centred on `t`. */
export const around = (t: number, span: number, domain: TimeWindow): TimeWindow =>
  clampWindow({ start: t - span / 2, end: t + span / 2 }, domain);
