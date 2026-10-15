/* Display formatting. Dates use the viewer's locale and time zone. */

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const valid = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDate = (iso: string | null | undefined): string => {
  const d = valid(iso);
  return d ? dateFmt.format(d) : '—';
};

export const formatDateTime = (iso: string | null | undefined): string => {
  const d = valid(iso);
  return d ? dateTimeFmt.format(d) : '—';
};

/* Guarded: a timestamp from another device can be anything, and Intl throws on an
   out-of-range date (it would take the whole page down). */
export const formatClock = (ms: number): string => {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? timeFmt.format(d) : '—';
};

/** 38 s · 42 min · 1 h 05 min */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/**
 * Elapsed seconds as a clock: 75 → "1:15", 3725 → "1:02:05".
 * `decimals` adds fractional seconds for zoomed-in axes: (1.25, 2) → "0:01.25".
 */
export function formatElapsed(seconds: number, decimals = 0): string {
  const neg = seconds < 0;
  const scale = 10 ** decimals;
  const total = Math.round(Math.abs(seconds) * scale);
  const whole = Math.floor(total / scale);
  const frac = total - whole * scale;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, '0') + (decimals > 0 ? `.${String(frac).padStart(decimals, '0')}` : '');
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return (neg ? '−' : '') + body;
}

/** A span of seconds in words: 0.5 → "0.5 s", 150 → "2 min 30 s". */
export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 10) return `${Number(seconds.toPrecision(2))} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

const numberFmt = new Intl.NumberFormat();
export const formatCount = (n: number | null | undefined): string => (n == null ? '—' : numberFmt.format(n));

export const formatValue = (v: number | null | undefined, digits: number): string =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

export function formatRate(hz: number): string {
  if (!(hz > 0)) return '—';
  return hz >= 1 ? `${Number(hz.toPrecision(4))} Hz` : `1 per ${Math.round(1 / hz)} s`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
