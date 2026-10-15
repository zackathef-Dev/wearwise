import { describe, expect, test } from 'vitest';
import { SensorType } from '@wearwise/sensor-protocol';
import { unpackChannelChunks } from '../chunk-container';
import { buildSeries } from '../series';
import { csvBlob, csvParts, fileSlug, formatMicrosAsSeconds, formatScaled, fileTime } from '../csv';
import { packChannelChunks, samplesChunk, type TestChunk } from './pack';

const series = (chunks: TestChunk[], sensorType: number, rate: number, originUs: bigint) =>
  buildSeries(unpackChannelChunks(packChannelChunks(chunks)), { sensorType, sampleRateHz: rate, originUs });

const text = (s: ReturnType<typeof series>, header: string, win?: { tStart: number; tEnd: number }) =>
  [...csvParts(s, { valueHeader: header, ...win })].join('');

describe('number formatting', () => {
  test('formatScaled writes the exact decimal of raw × 10^-decimals', () => {
    expect(formatScaled(-125, 3)).toBe('-0.125');
    expect(formatScaled(5, 3)).toBe('0.005');
    expect(formatScaled(-3, 3)).toBe('-0.003');
    expect(formatScaled(0, 2)).toBe('0.00');
    expect(formatScaled(12345, 2)).toBe('123.45');
    expect(formatScaled(-1, 1)).toBe('-0.1');
    expect(formatScaled(-32768, 3)).toBe('-32.768');
    expect(formatScaled(42, 0)).toBe('42');
    expect(formatScaled(-42, 0)).toBe('-42');
  });

  test('formatMicrosAsSeconds keeps microsecond precision', () => {
    expect(formatMicrosAsSeconds(0)).toBe('0.000000');
    expect(formatMicrosAsSeconds(4000)).toBe('0.004000');
    expect(formatMicrosAsSeconds(1_500_000)).toBe('1.500000');
    expect(formatMicrosAsSeconds(-250)).toBe('-0.000250');
    expect(formatMicrosAsSeconds(86_400_000_001)).toBe('86400.000001');
  });
});

describe('CSV export', () => {
  test('one row per sample: device timestamp, seconds since the first sample, physical value', () => {
    const s = series([
      samplesChunk(0, [125, -3, 0], 1_000_000n, 1_008_000n),
      samplesChunk(1, [1000], 1_012_000n, 1_012_000n),
    ], SensorType.Ecg, 250, 1_000_000n);
    expect(text(s, 'ecg_mV')).toBe(
      'timestamp_us,elapsed_s,ecg_mV\n' +
      '1000000,0.000000,0.125\n' +
      '1004000,0.004000,-0.003\n' +
      '1008000,0.008000,0.000\n' +
      '1012000,0.012000,1.000\n',
    );
  });

  test('uses each sensor’s own resolution', () => {
    const hr = series([samplesChunk(0, [723, 731], 0n, 1_000_000n)], SensorType.HeartRate, 1, 0n);
    expect(text(hr, 'heart_rate_bpm').split('\n')[1]).toBe('0,0.000000,72.3');
    const temp = series([samplesChunk(0, [3671], 0n, 0n)], SensorType.Temperature, 1, 0n);
    expect(text(temp, 'temperature_C').split('\n')[1]).toBe('0,0.000000,36.71');
    const ppg = series([samplesChunk(0, [-512], 0n, 0n)], SensorType.Ppg, 50, 0n);
    expect(text(ppg, 'ppg_counts').split('\n')[1]).toBe('0,0.000000,-512');
  });

  test('a window exports only the samples inside it', () => {
    const s = series([samplesChunk(0, [1, 2, 3, 4, 5], 0n, 4_000_000n)], SensorType.Ppg, 1, 0n);
    expect(text(s, 'v', { tStart: 1, tEnd: 3 })).toBe('timestamp_us,elapsed_s,v\n1000000,1.000000,2\n2000000,2.000000,3\n3000000,3.000000,4\n');
  });

  test('timestamps past 2^53 µs are written exactly', () => {
    const start = 2n ** 60n + 1n;
    const s = series([samplesChunk(0, [1, 2], start, start + 4000n)], SensorType.Ppg, 250, start);
    expect(text(s, 'v')).toBe(`timestamp_us,elapsed_s,v\n${start},0.000000,1\n${start + 4000n},0.004000,2\n`);
  });

  test('splits long exports into parts and the Blob holds all of it', async () => {
    const n = 45_000;
    const s = series([samplesChunk(0, Array.from({ length: n }, (_, i) => i % 1000), 0n, BigInt(n - 1) * 4000n)], SensorType.Ppg, 250, 0n);
    expect([...csvParts(s, { valueHeader: 'v' })].length).toBeGreaterThan(1);
    const blob = csvBlob(s, { valueHeader: 'v' });
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const lines = (await blob.text()).trimEnd().split('\n');
    expect(lines).toHaveLength(n + 1);
    expect(lines[n]).toBe(`${(n - 1) * 4000},${((n - 1) * 0.004).toFixed(6)},${(n - 1) % 1000}`);
  });

  test('an empty channel is just the header', () => {
    const s = series([], SensorType.Ecg, 250, 0n);
    expect(text(s, 'ecg_mV')).toBe('timestamp_us,elapsed_s,ecg_mV\n');
  });

  test('fileSlug makes a safe filename', () => {
    expect(fileSlug('Heart rhythm / 12 Oct 2026, 14:02')).toBe('Heart_rhythm_12_Oct_2026_14_02');
  });
});

describe('fileTime', () => {
  test('names a file by the local time the page shows, not UTC', () => {
    const iso = '2026-10-13T09:38:12.000Z';
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    expect(fileTime(iso)).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`);
    expect(fileTime(iso)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}$/);
    expect(fileTime('not a date')).toBe('not_a_date');
  });
});
