/* Axis helpers: clean tick values for a value axis and a time axis. */

/** 1, 2 or 5 × 10^k, the smallest such step giving at most `target` intervals over `span`. */
export function niceStep(span: number, target: number): number {
  if (!(span > 0) || !(target > 0)) return 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

const stepDecimals = (step: number): number => (step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)));

export interface ValueAxis { lo: number; hi: number; ticks: number[]; decimals: number }

/* Domain expanded outward to whole steps, so the plot starts and ends on a gridline.
   A flat signal gets a small band around its value instead of a zero-height axis. */
export function valueAxis(min: number, max: number, minResolution: number, target = 4): ValueAxis {
  let lo = min;
  let hi = max;
  if (!(hi - lo > 0)) {
    const pad = Math.max(Math.abs(lo) * 0.05, minResolution * 10, 1e-9);
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, target);
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = a, i = 0; v <= b + step * 1e-6 && i < 50; v = a + ++i * step) ticks.push(Number(v.toFixed(12)));
  return { lo: a, hi: b, ticks, decimals: stepDecimals(step) };
}

const TIME_STEPS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400,
];

export interface TimeAxis { ticks: number[]; decimals: number }

/** Ticks on clock-friendly steps (…, 0.5 s, 1 s, 5 s, 15 s, 1 min, 5 min, 1 h, …). */
export function timeAxis(start: number, end: number, maxTicks: number): TimeAxis {
  const span = end - start;
  if (!(span > 0)) return { ticks: [], decimals: 0 };
  const step = TIME_STEPS.find((s) => span / s <= Math.max(1, maxTicks)) ?? TIME_STEPS[TIME_STEPS.length - 1]!;
  const ticks: number[] = [];
  const first = Math.ceil(start / step - 1e-9);
  for (let i = first; i * step <= end + 1e-9 && ticks.length < 100; i++) ticks.push(Number((i * step).toFixed(6)));
  return { ticks, decimals: stepDecimals(step) };
}
