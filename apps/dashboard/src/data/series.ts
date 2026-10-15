import { SAMPLE_SCALE, type SensorType } from '@wearwise/sensor-protocol';
import type { ContainerChunk } from './chunk-container';

/* A decoded channel, held compactly enough for a day of ECG.
 *
 * Samples stay as the int16 values the device sent (2 bytes each: 24 h of 250 Hz
 * ECG is ~43 MB) and are scaled to physical units only when read. Time is not
 * stored per sample: each chunk is internally contiguous (the phone closes a chunk
 * at every packet gap or device restart), so one SEGMENT per chunk carries its first
 * and last timestamps and the samples in between are evenly spaced.
 *
 * Times are seconds relative to `originUs`, a device-clock microsecond value the
 * caller picks (the session's earliest first_timestamp_us, so every channel of a
 * session shares one time axis). The exact u64 timestamps stay available as
 * bigint on each segment for CSV export.
 *
 * Lives only in memory for the life of the page; nothing here is cached or logged.
 */

export interface Segment {
  /** index of the segment's first sample in `raw` */
  start: number;
  count: number;
  /** seconds from origin of the first and last sample */
  t0: number;
  t1: number;
  /** exact device-clock µs of the first and last sample */
  startUs: bigint;
  endUs: bigint;
  /** index of this segment's first block in blockMin/blockMax */
  blockStart: number;
}

export interface SampleSeries {
  sensorType: number;
  /** physical value = raw × scale */
  scale: number;
  /** decimals that represent one raw step exactly (0.001 → 3) */
  decimals: number;
  /** nominal seconds between samples (1 / rate), 0 when the rate is unknown */
  nominalDt: number;
  raw: Int16Array;
  segments: Segment[];
  originUs: bigint;
  /** min/max of every BLOCK samples within a segment, for fast zoomed-out drawing */
  blockMin: Int16Array;
  blockMax: Int16Array;
  /** extent of the data, seconds from origin (0/0 when empty) */
  tStart: number;
  tEnd: number;
}

export const BLOCK = 64;

export const decimalsForScale = (scale: number): number =>
  scale > 0 && scale < 1 ? Math.round(-Math.log10(scale)) : 0;

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/* Seconds between origin and a device timestamp. The difference fits a double
   exactly for any realistic session (2^53 µs is ~285 years). */
export const secondsFrom = (originUs: bigint, us: bigint): number => Number(us - originUs) / 1e6;

export interface BuildOptions {
  sensorType: SensorType | number;
  sampleRateHz: number;
  originUs: bigint;
}

export function buildSeries(chunks: ContainerChunk[], opts: BuildOptions): SampleSeries {
  const scale = SAMPLE_SCALE[opts.sensorType as SensorType]?.scale ?? 1;
  const nominalDt = opts.sampleRateHz > 0 ? 1 / opts.sampleRateHz : 0;
  const ordered = [...chunks].sort((a, b) => a.chunkNumber - b.chunkNumber);

  /* A chunk's sampleCount and payload length should agree; if they ever don't,
     read only what the payload actually holds. */
  const counts = ordered.map((c) => Math.min(c.sampleCount, Math.floor(c.payload.length / 2)));
  const total = counts.reduce((a, b) => a + b, 0);
  const raw = new Int16Array(total);

  let blocks = 0;
  for (const n of counts) blocks += Math.ceil(n / BLOCK);
  const blockMin = new Int16Array(blocks);
  const blockMax = new Int16Array(blocks);

  const segments: Segment[] = [];
  let at = 0;
  let blockAt = 0;
  ordered.forEach((c, k) => {
    const n = counts[k]!;
    if (n === 0) return;
    const p = c.payload;
    if (LITTLE_ENDIAN && p.byteOffset % 2 === 0) {
      raw.set(new Int16Array(p.buffer, p.byteOffset, n), at);
    } else {
      const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
      for (let i = 0; i < n; i++) raw[at + i] = dv.getInt16(i * 2, true);
    }

    const t0 = secondsFrom(opts.originUs, c.startedAtUs);
    let t1 = secondsFrom(opts.originUs, c.endedAtUs);
    /* A chunk's end should be after its start. If a bad clock says otherwise,
       fall back to the nominal rate rather than drawing samples on top of each other. */
    if (n > 1 && !(t1 > t0)) t1 = t0 + (n - 1) * nominalDt;
    if (n === 1) t1 = t0;

    for (let b = 0; b * BLOCK < n; b++) {
      let lo = 32767;
      let hi = -32768;
      const end = Math.min(n, (b + 1) * BLOCK);
      for (let i = at + b * BLOCK; i < at + end; i++) {
        const v = raw[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      blockMin[blockAt + b] = lo;
      blockMax[blockAt + b] = hi;
    }

    segments.push({ start: at, count: n, t0, t1, startUs: c.startedAtUs, endUs: c.endedAtUs, blockStart: blockAt });
    at += n;
    blockAt += Math.ceil(n / BLOCK);
  });

  let tStart = 0;
  let tEnd = 0;
  if (segments.length) {
    tStart = Infinity;
    tEnd = -Infinity;
    for (const s of segments) {
      if (s.t0 < tStart) tStart = s.t0;
      if (s.t1 > tEnd) tEnd = s.t1;
    }
  }

  return {
    sensorType: opts.sensorType, scale, decimals: decimalsForScale(scale), nominalDt,
    raw, segments, originUs: opts.originUs, blockMin, blockMax, tStart, tEnd,
  };
}

/** Seconds between consecutive samples of a segment (0 for a one-sample segment). */
export const segmentDt = (s: Segment): number => (s.count > 1 ? (s.t1 - s.t0) / (s.count - 1) : 0);

/** Index range [i0, i1] (relative to the segment) of samples with t in [tStart, tEnd]; null if none. */
export function segmentRange(s: Segment, tStart: number, tEnd: number): [number, number] | null {
  if (s.t1 < tStart || s.t0 > tEnd) return null;
  const dt = segmentDt(s);
  if (dt <= 0) return [0, s.count - 1];
  const eps = 1e-9;
  const i0 = Math.max(0, Math.ceil((tStart - s.t0) / dt - eps));
  const i1 = Math.min(s.count - 1, Math.floor((tEnd - s.t0) / dt + eps));
  return i0 <= i1 ? [i0, i1] : null;
}
