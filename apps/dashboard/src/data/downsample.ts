import { BLOCK, segmentDt, segmentRange, type SampleSeries } from './series';

/* Downsampling for display.
 *
 * A chart is a few hundred to a few thousand pixels wide; a day of ECG is ~21 M
 * samples. Drawing every sample is slow and, worse, a stride/average downsample
 * hides exactly what a reader looks for (a QRS spike, an impact peak). So each
 * pixel column (bucket) gets the MIN and MAX of every sample that falls in it, and
 * the chart draws that vertical span: peaks survive at any zoom.
 *
 * When the window holds fewer samples than there are pixels, there is nothing to
 * reduce, and `pointsInWindow` returns the samples themselves for a polyline.
 *
 * Zoomed far out, a bucket spans thousands of samples; there the precomputed
 * per-BLOCK min/max (see series.ts) stands in for the raw samples, so the cost
 * scales with blocks, not samples. A block is assigned to the bucket holding its
 * midpoint, which can move an extreme by at most a quarter of a bucket (the block
 * path only runs when a bucket spans >= 4 blocks): well under a pixel.
 */

export interface Envelope {
  tStart: number;
  tEnd: number;
  buckets: number;
  /** physical units; NaN where the bucket holds no sample (a real gap in the data) */
  min: Float64Array;
  max: Float64Array;
}

const BLOCKS_PER_BUCKET_FOR_FAST_PATH = 4;

export function minMaxEnvelope(series: SampleSeries, tStart: number, tEnd: number, buckets: number): Envelope {
  const n = Math.max(0, Math.floor(buckets));
  const lo = new Float64Array(n).fill(Infinity);
  const hi = new Float64Array(n).fill(-Infinity);
  const span = tEnd - tStart;

  if (n > 0 && span > 0) {
    const perSecond = n / span;
    const bucketSeconds = span / n;
    const last = n - 1;
    const { raw, blockMin, blockMax } = series;

    const rawRun = (s: SampleSeries['segments'][number], dt: number, from: number, to: number) => {
      for (let i = from; i <= to; i++) {
        let b = Math.floor((s.t0 + i * dt - tStart) * perSecond);
        if (b < 0) b = 0; else if (b > last) b = last;
        const v = raw[s.start + i]!;
        if (v < lo[b]!) lo[b] = v;
        if (v > hi[b]!) hi[b] = v;
      }
    };

    for (const s of series.segments) {
      const r = segmentRange(s, tStart, tEnd);
      if (!r) continue;
      const [i0, i1] = r;
      const dt = segmentDt(s);

      if (dt > 0 && bucketSeconds / dt >= BLOCK * BLOCKS_PER_BUCKET_FOR_FAST_PATH) {
        /* Whole blocks inside [i0, i1] use their summary; the partial blocks at
           either edge fall back to raw samples. */
        const firstFull = Math.ceil(i0 / BLOCK);
        const lastFull = Math.floor((i1 + 1) / BLOCK) - 1;
        if (firstFull <= lastFull) {
          rawRun(s, dt, i0, firstFull * BLOCK - 1);
          for (let k = firstFull; k <= lastFull; k++) {
            const mid = s.t0 + (k * BLOCK + (BLOCK - 1) / 2) * dt;
            let b = Math.floor((mid - tStart) * perSecond);
            if (b < 0) b = 0; else if (b > last) b = last;
            const bl = blockMin[s.blockStart + k]!;
            const bh = blockMax[s.blockStart + k]!;
            if (bl < lo[b]!) lo[b] = bl;
            if (bh > hi[b]!) hi[b] = bh;
          }
          rawRun(s, dt, (lastFull + 1) * BLOCK, i1);
          continue;
        }
      }
      rawRun(s, dt, i0, i1);
    }
  }

  const min = new Float64Array(n);
  const max = new Float64Array(n);
  for (let b = 0; b < n; b++) {
    if (lo[b] === Infinity) { min[b] = NaN; max[b] = NaN; continue; }
    min[b] = lo[b]! * series.scale;
    max[b] = hi[b]! * series.scale;
  }
  return { tStart, tEnd, buckets: n, min, max };
}

/** How many samples fall in [tStart, tEnd]. Cheap: per segment, not per sample. */
export function countInWindow(series: SampleSeries, tStart: number, tEnd: number): number {
  let total = 0;
  for (const s of series.segments) {
    const r = segmentRange(s, tStart, tEnd);
    if (r) total += r[1] - r[0] + 1;
  }
  return total;
}

export interface Points {
  /** seconds from origin */
  t: Float64Array;
  /** physical units */
  v: Float64Array;
  /** 1 where the line must NOT be joined to the previous point (a gap in the data) */
  breakBefore: Uint8Array;
}

/* The samples in the window plus one on each side, so a zoomed-in line runs to
   the plot edges instead of stopping short. Returns null if there are more than
   `maxPoints`: the caller should use the envelope instead. */
export function pointsInWindow(series: SampleSeries, tStart: number, tEnd: number, maxPoints: number): Points | null {
  const segs = series.segments;
  /* Widen the window by a little more than one sample period on each side. */
  let pad = series.nominalDt;
  for (const s of segs) pad = Math.max(pad, segmentDt(s));
  const a = tStart - pad * 1.01;
  const b = tEnd + pad * 1.01;
  if (countInWindow(series, a, b) > maxPoints) return null;

  const ts: number[] = [];
  const vs: number[] = [];
  const brk: number[] = [];
  let prevT = NaN;
  let prevDt = 0;
  for (const s of segs) {
    const r = segmentRange(s, a, b);
    if (!r) continue;
    const dt = segmentDt(s);
    for (let i = r[0]; i <= r[1]; i++) {
      const t = s.t0 + i * dt;
      /* Join across a chunk boundary only when the step is about one sample
         period; a longer silence is a gap and stays visibly open. */
      const expected = Math.max(dt, prevDt, series.nominalDt);
      const gap = Number.isNaN(prevT) ? false : t - prevT > expected * 2.5 || t < prevT;
      ts.push(t);
      vs.push(series.raw[s.start + i]! * series.scale);
      brk.push(Number.isNaN(prevT) || gap ? 1 : 0);
      prevT = t;
    }
    prevDt = dt;
  }
  return { t: Float64Array.from(ts), v: Float64Array.from(vs), breakBefore: Uint8Array.from(brk) };
}

/** Min and max of the finite values of an envelope (for the y-axis). */
export function envelopeExtent(env: Envelope): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < env.buckets; i++) {
    const a = env.min[i]!;
    if (Number.isNaN(a)) continue;
    if (a < lo) lo = a;
    const b = env.max[i]!;
    if (b > hi) hi = b;
  }
  return lo === Infinity ? null : [lo, hi];
}

export function pointsExtent(p: Points, tStart: number, tEnd: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < p.t.length; i++) {
    const t = p.t[i]!;
    if (t < tStart || t > tEnd) continue;
    const v = p.v[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? null : [lo, hi];
}
