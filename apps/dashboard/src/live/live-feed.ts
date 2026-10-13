/* Live view: what the participant's phone broadcasts while "Live view for setup" is
 * on (docs/architecture/live-view-and-alerts.md §2), turned into something to draw.
 *
 * Everything that arrives is checked here first: it comes from another person's
 * phone, so a malformed or oversized message is dropped, never trusted. Times in
 * the messages are the PHONE's clock; the offset to this computer's clock is
 * estimated from `sentAt` on each batch (network delay is small next to the
 * seconds-scale skew between devices), so the rolling window lines up with "now".
 */

export const STATUS_TIMEOUT_MS = 12_000; // the phone sends `status` every 5 s
const MAX_VALUES = 4000;                  // per signal per batch: 250 Hz ECG sends ~125
const MAX_RATE_HZ = 2000;
const MIN_RATE_HZ = 0.01;
/* Phone and computer clocks differ by seconds, rarely minutes: anything wilder is a
   broken or hostile sender, and would push dates out of range. */
const MAX_SKEW_MS = 24 * 3600_000;
const MAX_LIVE_MS = 9 * 60 * 60_000;      // live view lasts up to 8 h; leave room

export interface LiveStatus {
  state: 'live' | 'stopped';
  endsAt: number;
  device: string | null;
  simulated: boolean;
  signals: number[];
  /** the phone is recording, and whether this viewer asked for it (may stop it) */
  recording: boolean;
  startedByYou: boolean;
  /** how the phone is linked to the patch, and the patch's firmware; null if not said */
  link: 'bluetooth' | 'wifi' | 'simulation' | null;
  firmware: string | null;
  /** the sensors the patch has, of those shared with this viewer; null if not said */
  sensors: number[] | null;
}

/** The phone's answer to this viewer's recording request (contract §2). */
export type RecordAnswer = 'asked' | 'started' | 'declined' | 'recording' | 'unavailable' | 'stopped';
const RECORD_ANSWERS: readonly RecordAnswer[] = ['asked', 'started', 'declined', 'recording', 'unavailable', 'stopped'];
export function parseRecordAnswer(p: unknown): RecordAnswer | null {
  return isObj(p) && p.v === 1 && RECORD_ANSWERS.includes(p.answer as RecordAnswer) ? (p.answer as RecordAnswer) : null;
}

/* `leadsOff`: an ECG electrode was off the skin when the batch's latest packet came. */
export interface SignalBatch { rateHz: number; t0: number; values: number[]; leadsOff?: boolean }
export interface LiveBatch { sentAt: number; signals: Map<number, SignalBatch> }

/* A fall, at each step of the phone's alarm: detected (counting down), ok (they tapped
   "I'm OK"), raised (nobody answered), dismissed (the raised alarm was closed).
   `at` is the phone's clock and identifies the fall across its steps. */
export type FallState = 'detected' | 'ok' | 'raised' | 'dismissed';
export interface LiveFall { at: number; state: FallState; impactG: number }
const FALL_STATES: readonly FallState[] = ['detected', 'ok', 'raised', 'dismissed'];
const MAX_IMPACT_G = 64;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sensorCode = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 32 ? n : null;
};

export function parseStatus(p: unknown): LiveStatus | null {
  if (!isObj(p) || p.v !== 1 || (p.state !== 'live' && p.state !== 'stopped') || !finite(p.endsAt)) return null;
  const signals = Array.isArray(p.signals) ? p.signals.map(sensorCode).filter((s): s is number => s !== null) : [];
  const device = typeof p.device === 'string' ? p.device.slice(0, 64) : null;
  return {
    state: p.state, endsAt: p.endsAt, device, simulated: p.simulated === true, signals,
    recording: p.recording === true, startedByYou: p.recording === true && p.startedByYou === true,
    link: p.link === 'bluetooth' || p.link === 'wifi' || p.link === 'simulation' ? p.link : null,
    firmware: typeof p.firmware === 'string' && /^[\w.+-]{1,32}$/.test(p.firmware) ? p.firmware : null,
    sensors: Array.isArray(p.sensors) ? p.sensors.map(sensorCode).filter((s): s is number => s !== null) : null,
  };
}

export function parseSamples(p: unknown): LiveBatch | null {
  if (!isObj(p) || p.v !== 1 || !finite(p.sentAt) || !isObj(p.signals)) return null;
  const signals = new Map<number, SignalBatch>();
  for (const [key, raw] of Object.entries(p.signals)) {
    const code = sensorCode(key);
    if (code === null || !isObj(raw) || !finite(raw.rateHz) || !finite(raw.t0) || !Array.isArray(raw.values)) continue;
    if (raw.rateHz < MIN_RATE_HZ || raw.rateHz > MAX_RATE_HZ || raw.values.length > MAX_VALUES) continue;
    if (!raw.values.every(finite)) continue;
    signals.set(code, { rateHz: raw.rateHz, t0: raw.t0, values: raw.values as number[], leadsOff: raw.leadsOff === true });
  }
  return { sentAt: p.sentAt, signals };
}

export function parseFall(p: unknown): LiveFall | null {
  if (!isObj(p) || p.v !== 1 || !finite(p.at) || !FALL_STATES.includes(p.state as FallState)) return null;
  if (!finite(p.impactG) || p.impactG < 0 || p.impactG > MAX_IMPACT_G) return null;
  return { at: p.at, state: p.state as FallState, impactG: p.impactG };
}

/** A rolling window of one signal's samples, in phone-clock ms. */
export class SignalBuffer {
  private t: number[] = [];
  private v: number[] = [];
  constructor(private readonly windowMs: number) {}

  push(b: SignalBatch): void {
    const step = 1000 / b.rateHz;
    const last = this.t.length ? this.t[this.t.length - 1]! : -Infinity;
    b.values.forEach((value, i) => {
      const at = b.t0 + i * step;
      if (at > last) { this.t.push(at); this.v.push(value); } // a resent or overlapping batch adds nothing twice
    });
    this.trim(this.t[this.t.length - 1] ?? 0);
  }

  /** Drops samples older than the window, measured back from `newest`. */
  trim(newest: number): void {
    let drop = 0;
    while (drop < this.t.length && this.t[drop]! < newest - this.windowMs) drop++;
    if (drop) { this.t.splice(0, drop); this.v.splice(0, drop); }
  }

  get length(): number { return this.t.length; }
  get latest(): { t: number; v: number } | null {
    return this.t.length ? { t: this.t[this.t.length - 1]!, v: this.v[this.v.length - 1]! } : null;
  }
  /** Samples in [from, to] (phone clock). */
  range(from: number, to: number): { t: number[]; v: number[] } {
    let a = 0;
    while (a < this.t.length && this.t[a]! < from) a++;
    let b = this.t.length;
    while (b > a && this.t[b - 1]! > to) b--;
    return { t: this.t.slice(a, b), v: this.v.slice(a, b) };
  }
}

/* paused: live view is still on (its end time hasn't come) but the phone has gone quiet,
   usually because WearWise is in the background there; it picks up when they open it. */
export type LivePhase = 'waiting' | 'live' | 'paused' | 'ended';

export class LiveFeed {
  status: LiveStatus | null = null;
  private statusAt = 0;
  /** the live session's end time as the phone sent it: identifies the session */
  private sessionEndsAt: number | null = null;
  /** this viewer stopped the current session: its stragglers are ignored */
  stoppedByViewer = false;
  /** the newest fall the phone has told us about, if falls are shared */
  fall: LiveFall | null = null;
  private fallSteps = new Set<string>();
  /** per signal: is an electrode off right now (ECG) */
  readonly leadsOff = new Map<number, boolean>();
  /** phone clock − this computer's clock, ms */
  offset = 0;
  private haveOffset = false;
  readonly buffers = new Map<number, SignalBuffer>();
  /** what the grant allows: anything else is ignored even if sent */
  constructor(
    private readonly allowed: readonly number[], private readonly windowMs = 10_000, private readonly includeFalls = false,
  ) {}

  onStatus(payload: unknown, receivedAt: number): boolean {
    const s = parseStatus(payload);
    if (!s) return false;
    /* After this viewer pressed Stop, the phone may still have a message in flight;
       only a new session (a new end time) counts. */
    if (this.stoppedByViewer && s.endsAt === this.sessionEndsAt) return false;
    this.stoppedByViewer = false;
    this.sessionEndsAt = s.endsAt;
    /* An end time far beyond what live view allows is clamped, never trusted. */
    s.endsAt = Math.min(s.endsAt, this.phoneNow(receivedAt) + MAX_LIVE_MS);
    this.status = {
      ...s, signals: s.signals.filter((x) => this.allowed.includes(x)),
      sensors: s.sensors ? s.sensors.filter((x) => this.allowed.includes(x)) : null,
    };
    this.statusAt = receivedAt;
    return true;
  }

  onSamples(payload: unknown, receivedAt: number): boolean {
    const b = parseSamples(payload);
    if (!b || this.stoppedByViewer) return false;
    const offset = b.sentAt - receivedAt;
    if (Math.abs(offset) > MAX_SKEW_MS) return false;
    /* Smoothed, so one slow delivery doesn't jolt the traces. */
    this.offset = this.haveOffset ? this.offset + 0.2 * (offset - this.offset) : offset;
    this.haveOffset = true;
    for (const [code, batch] of b.signals) {
      if (!this.allowed.includes(code)) continue;
      if (Math.abs(batch.t0 - b.sentAt) > MAX_SKEW_MS) continue;
      let buf = this.buffers.get(code);
      if (!buf) { buf = new SignalBuffer(this.windowMs); this.buffers.set(code, buf); }
      buf.push(batch);
      this.leadsOff.set(code, batch.leadsOff === true);
    }
    return true;
  }

  /** A fall step. Returns it if it is news (not a repeat, not an older fall), else null. */
  onFall(payload: unknown, receivedAt: number): LiveFall | null {
    if (!this.includeFalls) return null;
    const f = parseFall(payload);
    if (!f || Math.abs(f.at - this.phoneNow(receivedAt)) > MAX_SKEW_MS) return null;
    if (this.fall && f.at < this.fall.at) return null;
    const key = `${f.at}:${f.state}`;
    if (this.fallSteps.has(key)) return null;
    if (this.fallSteps.size > 64) this.fallSteps.clear();
    this.fallSteps.add(key);
    this.fall = f;
    return f;
  }

  /** This viewer stopped live view: show it as ended until the phone starts a new one. */
  stopByViewer(): void {
    this.stoppedByViewer = true;
    if (this.status) this.status = { ...this.status, state: 'stopped' };
  }

  /** A phone-clock time on this computer's clock. */
  toLocal(phoneMs: number): number { return phoneMs - this.offset; }

  /** This computer's time, on the phone's clock. */
  phoneNow(now: number): number { return now + this.offset; }

  phase(now: number): LivePhase {
    if (!this.status) return 'waiting';
    if (this.status.state === 'stopped') return 'ended';
    if (this.status.endsAt <= this.phoneNow(now)) return 'ended';
    if (now - this.statusAt > STATUS_TIMEOUT_MS) return 'paused';
    return 'live';
  }

  /** When live view ends, on this computer's clock. */
  endsAtLocal(): number | null {
    return this.status ? this.status.endsAt - this.offset : null;
  }
}
