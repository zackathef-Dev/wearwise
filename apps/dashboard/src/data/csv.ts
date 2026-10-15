import { segmentRange, type SampleSeries } from './series';

/* CSV export of one channel: `timestamp_us,elapsed_s,<value column>`.
 *
 *   timestamp_us  device-clock microseconds, as the phone recorded them (the
 *                 chunk's first/last timestamps, evenly interpolated between)
 *   elapsed_s     seconds since the session's first sample (same axis as the chart)
 *   value         the physical value, written with exactly the decimals one raw
 *                 step carries (ECG 0.001 mV → 3), so nothing is invented or lost
 *
 * Numbers are formatted from integers, never through floating-point printing, so
 * the file says -0.003, not -0.0030000000000000001.
 *
 * Built in pieces (`csvParts`) so a long channel never becomes one giant string;
 * the Blob is handed straight to the browser's download and the object URL revoked.
 */

const ROWS_PER_PART = 20_000;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** raw × 10^-decimals as an exact decimal string: (-125, 3) → "-0.125". */
export function formatScaled(raw: number, decimals: number): string {
  if (decimals <= 0) return String(raw);
  const neg = raw < 0;
  const digits = String(Math.abs(raw)).padStart(decimals + 1, '0');
  const cut = digits.length - decimals;
  return `${neg ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

/** Microseconds as seconds with 6 decimals, exactly: 4000 → "0.004000". */
export function formatMicrosAsSeconds(us: number): string {
  const neg = us < 0;
  const a = Math.abs(us);
  const whole = Math.floor(a / 1_000_000);
  const frac = String(a - whole * 1_000_000).padStart(6, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export interface CsvOptions {
  /** header for the value column, e.g. "ecg_mV" */
  valueHeader: string;
  /** optional window in seconds from origin; whole channel when omitted */
  tStart?: number;
  tEnd?: number;
}

export function* csvParts(series: SampleSeries, opts: CsvOptions): Generator<string> {
  let out = `timestamp_us,elapsed_s,${opts.valueHeader}\n`;
  let rows = 0;
  const tStart = opts.tStart ?? -Infinity;
  const tEnd = opts.tEnd ?? Infinity;

  for (const s of series.segments) {
    const r = segmentRange(s, tStart, tEnd);
    if (!r) continue;
    const spanUs = s.count > 1 ? Number(s.endUs - s.startUs) : 0;
    /* Same rule as buildSeries: a non-increasing chunk clock falls back to the nominal rate. */
    const stepUs = s.count > 1
      ? (spanUs > 0 ? spanUs / (s.count - 1) : series.nominalDt * 1e6)
      : 0;
    const offsetUs = Number(s.startUs - series.originUs);
    const safe = s.startUs + BigInt(Math.ceil(stepUs * s.count)) <= MAX_SAFE;
    const startNum = safe ? Number(s.startUs) : 0;

    for (let i = r[0]; i <= r[1]; i++) {
      const stepped = Math.round(i * stepUs);
      const ts = safe ? String(startNum + stepped) : (s.startUs + BigInt(stepped)).toString();
      out += `${ts},${formatMicrosAsSeconds(offsetUs + stepped)},${formatScaled(series.raw[s.start + i]!, series.decimals)}\n`;
      if (++rows % ROWS_PER_PART === 0) { yield out; out = ''; }
    }
  }
  if (out) yield out;
}

export function csvBlob(series: SampleSeries, opts: CsvOptions): Blob {
  /* Encode each part as it is produced so the strings can be collected early. */
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  for (const p of csvParts(series, opts)) parts.push(enc.encode(p));
  return new Blob(parts, { type: 'text/csv;charset=utf-8' });
}

/** Rough size of a whole-channel export, to warn before a very large download. */
export const estimateCsvBytes = (sampleCount: number): number => sampleCount * 32;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Give the browser a moment to start the download before releasing the data. */
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** When a session started, for its file names, in this computer's local time as the
 *  page shows it: "2026-10-13T09:38:12Z" in Sydney → "2026-10-13_2038". */
export function fileTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fileSlug(iso.slice(0, 16));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** A filename-safe slug: "2026-10-12 14:02" → "2026-10-12_1402". */
export const fileSlug = (s: string): string =>
  s.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
