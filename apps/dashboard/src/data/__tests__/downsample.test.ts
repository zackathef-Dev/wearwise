import { describe, expect, test } from 'vitest';
import { SensorType } from '@wearwise/sensor-protocol';
import { unpackChannelChunks } from '../chunk-container';
import { buildSeries, BLOCK, type SampleSeries } from '../series';
import { countInWindow, envelopeExtent, minMaxEnvelope, pointsInWindow } from '../downsample';
import { packChannelChunks, samplesChunk, type TestChunk } from './pack';

const S = 1_000_000n; // µs per second

/** Through the real container decoder, so these tests cover decode → series → display. */
const series = (chunks: TestChunk[], opts: { sensorType?: number; rate: number; originUs?: bigint }): SampleSeries =>
  buildSeries(unpackChannelChunks(packChannelChunks(chunks)), {
    sensorType: opts.sensorType ?? SensorType.Ppg, sampleRateHz: opts.rate, originUs: opts.originUs ?? 0n,
  });

const range = (n: number, f: (i: number) => number = (i) => i): number[] => Array.from({ length: n }, (_, i) => f(i));

/** Brute force: every sample into its bucket. The reference the fast paths must match. */
function bruteEnvelope(s: SampleSeries, tStart: number, tEnd: number, buckets: number) {
  const lo = new Array<number>(buckets).fill(Infinity);
  const hi = new Array<number>(buckets).fill(-Infinity);
  for (const seg of s.segments) {
    const dt = seg.count > 1 ? (seg.t1 - seg.t0) / (seg.count - 1) : 0;
    for (let i = 0; i < seg.count; i++) {
      const t = seg.t0 + i * dt;
      if (t < tStart || t > tEnd) continue;
      const b = Math.min(buckets - 1, Math.max(0, Math.floor((t - tStart) * (buckets / (tEnd - tStart)))));
      const v = s.raw[seg.start + i]! * s.scale;
      lo[b] = Math.min(lo[b]!, v);
      hi[b] = Math.max(hi[b]!, v);
    }
  }
  return { lo, hi };
}

describe('buildSeries', () => {
  test('scales raw int16 into physical units and spreads samples across the chunk span', () => {
    // ECG: 1 raw step = 0.001 mV. 5 samples from 10 s to 10.016 s → 4 ms apart.
    const s = series([samplesChunk(0, [125, -3, 0, 1000, -32768], 10n * S, 10n * S + 16_000n)], {
      sensorType: SensorType.Ecg, rate: 250, originUs: 10n * S,
    });
    expect(s.scale).toBe(0.001);
    expect(s.decimals).toBe(3);
    expect(Array.from(s.raw)).toEqual([125, -3, 0, 1000, -32768]);
    expect(s.segments[0]).toMatchObject({ start: 0, count: 5, t0: 0, t1: 0.016 });
    expect(s.tStart).toBe(0);
    expect(s.tEnd).toBeCloseTo(0.016, 9);
    const p = pointsInWindow(s, 0, 0.016, 100)!;
    expect(Array.from(p.t).map((t) => Math.round(t * 1e6))).toEqual([0, 4000, 8000, 12000, 16000]);
    expect(Array.from(p.v)).toEqual([0.125, -0.003, 0, 1, -32.768]);
  });

  test('orders chunks by chunk number and keeps one segment per chunk', () => {
    const s = series([
      samplesChunk(1, [3, 4], 2n * S, 3n * S),
      samplesChunk(0, [1, 2], 0n, 1n * S),
    ], { rate: 1 });
    expect(Array.from(s.raw)).toEqual([1, 2, 3, 4]);
    expect(s.segments.map((g) => [g.t0, g.t1])).toEqual([[0, 1], [2, 3]]);
  });

  test('a chunk whose clock does not advance falls back to the nominal rate', () => {
    const s = series([samplesChunk(0, [1, 2, 3], 5n * S, 5n * S)], { rate: 2 });
    expect(s.segments[0]!.t1).toBeCloseTo(6, 9); // 5 s + 2 × 0.5 s
  });

  test('reads only the samples the payload holds if sampleCount disagrees', () => {
    const c = samplesChunk(0, [7, 8], 0n, 1n * S);
    c.sampleCount = 5;
    expect(Array.from(series([c], { rate: 1 }).raw)).toEqual([7, 8]);
  });
});

describe('minMaxEnvelope', () => {
  test('min and max of each bucket', () => {
    const s = series([samplesChunk(0, range(10), 0n, 9n * S)], { rate: 1 }); // t = value = 0..9
    const env = minMaxEnvelope(s, 0, 10, 5);
    expect(Array.from(env.min)).toEqual([0, 2, 4, 6, 8]);
    expect(Array.from(env.max)).toEqual([1, 3, 5, 7, 9]);
  });

  test('a one-sample spike survives heavy downsampling', () => {
    const values = range(5000, (i) => (i === 3217 ? 900 : i === 4100 ? -700 : 0));
    const s = series([samplesChunk(0, values, 0n, 4999n * 4000n)], { rate: 250 });
    const env = minMaxEnvelope(s, s.tStart, s.tEnd, 50);
    expect(Math.max(...env.max)).toBe(900);
    expect(Math.min(...env.min)).toBe(-700);
    expect(env.max.filter((v) => v === 900)).toHaveLength(1);
  });

  test('a gap in the data leaves empty (NaN) buckets instead of a fake line', () => {
    const s = series([
      samplesChunk(0, range(10), 0n, 9n * S),
      samplesChunk(1, range(10), 20n * S, 29n * S),
    ], { rate: 1 });
    const env = minMaxEnvelope(s, 0, 30, 30);
    expect(range(30).filter((b) => Number.isNaN(env.min[b]))).toEqual(range(10, (i) => i + 10));
  });

  test('only samples inside the window count', () => {
    const s = series([samplesChunk(0, range(10), 0n, 9n * S)], { rate: 1 });
    const env = minMaxEnvelope(s, 3, 6, 1);
    expect([env.min[0], env.max[0]]).toEqual([3, 6]);
    expect(countInWindow(s, 3, 6)).toBe(4);
    expect(countInWindow(s, 9.5, 20)).toBe(0);
  });

  test('block fast path matches brute force when buckets align with blocks', () => {
    // 250 Hz (4 ms, exact in µs); buckets of 512 samples = 8 whole blocks, with the
    // bucket edges half a sample away from any sample: the fast path runs and is exact.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const n = 512 * 20;
    const values = range(n, () => (rnd() % 20001) - 10000);
    const s = series([samplesChunk(0, values, 0n, BigInt(n - 1) * 4000n)], { rate: 250 });
    const [a, b] = [-0.002, n * 0.004 - 0.002];
    const env = minMaxEnvelope(s, a, b, 20);
    const ref = bruteEnvelope(s, a, b, 20);
    expect(Array.from(env.min)).toEqual(ref.lo);
    expect(Array.from(env.max)).toEqual(ref.hi);
  });

  test('block fast path stays within a neighbouring bucket when buckets do not align', () => {
    let seed = 11;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const n = BLOCK * 2000;
    const values = range(n, () => (rnd() % 2001) - 1000);
    const s = series([samplesChunk(0, values, 3n * S, 3n * S + BigInt(n - 1) * 4000n)], { rate: 250 });
    const [a, b, buckets] = [3.1234, 3.1234 + (n - 1) * 0.004 * 0.9, 97];
    const env = minMaxEnvelope(s, a, b, buckets);
    const ref = bruteEnvelope(s, a, b, buckets);
    expect(envelopeExtent(env)).toEqual([Math.min(...ref.lo), Math.max(...ref.hi)]);
    for (let k = 0; k < buckets; k++) {
      const near = [k - 1, k, k + 1].filter((j) => j >= 0 && j < buckets);
      expect(env.min[k]).toBeGreaterThanOrEqual(Math.min(...near.map((j) => ref.lo[j]!)));
      expect(env.max[k]).toBeLessThanOrEqual(Math.max(...near.map((j) => ref.hi[j]!)));
    }
  });

  test('degenerate windows return empty envelopes', () => {
    const s = series([samplesChunk(0, [1, 2], 0n, 1n * S)], { rate: 1 });
    expect(minMaxEnvelope(s, 5, 5, 10).min.every(Number.isNaN)).toBe(true);
    expect(minMaxEnvelope(s, 0, 1, 0).buckets).toBe(0);
  });
});

describe('pointsInWindow', () => {
  test('returns the samples plus one on each side, and null when there are too many', () => {
    const s = series([samplesChunk(0, range(100), 0n, 99n * S)], { rate: 1 });
    const p = pointsInWindow(s, 10, 20, 50)!;
    expect(p.t[0]).toBe(9);
    expect(p.t[p.t.length - 1]).toBe(21);
    expect(pointsInWindow(s, 0, 99, 50)).toBeNull();
  });

  test('breaks the line at a gap between chunks but not at a normal chunk boundary', () => {
    const s = series([
      samplesChunk(0, [1, 2, 3], 0n, 2n * S),
      samplesChunk(1, [4, 5, 6], 3n * S, 5n * S), // contiguous: next sample one period later
      samplesChunk(2, [7, 8, 9], 30n * S, 32n * S), // 25 s of silence
    ], { rate: 1 });
    const p = pointsInWindow(s, 0, 32, 100)!;
    expect(Array.from(p.breakBefore)).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0]);
  });
});
