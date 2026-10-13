import { SAMPLE_SCALE, type SensorType } from '@wearwise/sensor-protocol';
import type { AccessGrant } from '@/data/remote/sharing';

/* Live view for setup — the parts with no React Native, network or clock in them, so
 * they are tested on their own: batching samples, timing them, choosing what each
 * viewer may see, and the event payloads. The wire format is the contract in
 * docs/architecture/live-view-and-alerts.md §2; change it there first.
 */

/* How long live view stays on: the participant picks one of these when starting it,
   30 minutes unless they choose longer. It switches itself off at the end. */
export const LIVE_VIEW_MINUTES = [30, 60, 120, 240, 480] as const;
export const DEFAULT_LIVE_VIEW_MINUTES = 30;
/* The chosen length in ms; anything not on the list falls back to the default. */
export const liveViewMs = (minutes: number): number =>
  ((LIVE_VIEW_MINUTES as readonly number[]).includes(minutes) ? minutes : DEFAULT_LIVE_VIEW_MINUTES) * 60_000;
export const durationLabel = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`);
/* A samples event about this often, a status event this often. */
export const BATCH_MS = 500;
export const STATUS_MS = 5_000;
/* Who may watch is re-checked this often: Realtime keeps a channel open after its grant
   is revoked, so the phone itself stops sending to anyone no longer on the list. */
export const GRANT_RECHECK_MS = 30_000;
/* If that check fails this many times in a row (about two minutes offline), live view
   stops: nobody's access can be confirmed, and nothing would get through anyway. */
export const MAX_FAILED_GRANT_CHECKS = 4;
/* A batch keeps at most this many values per signal (newest), so one late batch can't
   approach Realtime's 64 KB message limit. A normal 250 Hz batch holds ~125. */
export const MAX_VALUES_PER_SIGNAL = 1000;
/* The sensor counts as gone for good once it has been explicitly disconnected this
   long, or has failed to reconnect for this long. */
export const SENSOR_GONE_MS = 10_000;
export const SENSOR_LOST_MS = 120_000;

/* At or below this rate a stream is gappy (heart rate and SpO₂ only report a value
   when they have one), so each value is timed by its arrival. Above it the stream is
   continuous and runs on its own clock, re-anchored if it drifts this far. */
const LOW_RATE_HZ = 5;
const REANCHOR_MS = 300;
/* A signal is "streamed" if a value arrived this recently. */
const STREAMED_WINDOW_MS = 10_000;

export interface LiveGrant {
  id: string;
  name: string | null;
  email: string | null;
  sensorTypes: SensorType[];
  /* Their share includes falls: they get fall events while live view is on. */
  includeFalls: boolean;
}

/* Grants that may watch: active viewers with at least one signal. Ids lowercase, as
   the channel name must be exactly `live:<uuid>` in canonical form. */
export const liveViewGrants = (grants: readonly AccessGrant[]): LiveGrant[] =>
  grants
    .filter((g) => g.accessActive && g.sensorTypes.length > 0)
    .map((g) => ({
      id: g.id.toLowerCase(), name: g.name, email: g.email, sensorTypes: [...g.sensorTypes], includeFalls: g.includeFalls,
    }));

export const viewerName = (g: Pick<LiveGrant, 'name' | 'email'>): string => g.name ?? g.email ?? 'Unnamed viewer';

export type LiveViewBlocker = 'no-backend' | 'no-viewers' | 'no-sensor';
/* Why live view can't start right now, or null if it can. */
export function liveViewBlocker(s: { backend: boolean; viewers: number; sensorConnected: boolean }): LiveViewBlocker | null {
  if (!s.backend) return 'no-backend';
  if (s.viewers === 0) return 'no-viewers';
  if (!s.sensorConnected) return 'no-sensor';
  return null;
}

/* Has the sensor gone for good? `since`: when it was last seen connected → not. */
export function sensorGone(connection: string | undefined, notConnectedSince: number | null, now: number): boolean {
  if (notConnectedSince == null) return false;
  const away = now - notConnectedSince;
  return connection === 'disconnected' || connection === 'failed' ? away >= SENSOR_GONE_MS : away >= SENSOR_LOST_MS;
}

export function timeLeftLabel(endsAt: number, now: number): string {
  const left = endsAt - now;
  if (left < 60_000) return 'less than a minute left';
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m} min left` : `${h} h left`;
}

/* ---- events (contract §2) ---- */

/* `leadsOff`: the latest packet in the batch said an ECG electrode is off the skin. */
export interface SignalBatch { rateHz: number; t0: number; values: number[]; leadsOff?: true }
export type Batch = Partial<Record<SensorType, SignalBatch>>;

export interface SamplesEvent { v: 1; sentAt: number; signals: Record<string, SignalBatch> }
export interface StatusEvent {
  v: 1; state: 'live' | 'stopped'; endsAt: number; device: string; simulated: boolean; signals: number[];
  /* The phone is making a recording right now, and whether this viewer asked for it
     (only they may stop it from their side). */
  recording: boolean;
  startedByYou: boolean;
  /* How the phone is linked to the patch, and the patch's firmware version. */
  link: 'bluetooth' | 'wifi' | 'simulation';
  firmware: string | null;
  /* The sensors the patch has (this viewer's share of them), streaming or not. */
  sensors: number[];
}

/* A viewer asked the phone to start a recording ('record' from the viewer); the phone's
   answer goes back to that viewer only. asked: the participant is being asked;
   started / declined: what they chose (declined also when nobody answered); recording:
   one is already running; unavailable: nothing to record (sensor not connected);
   stopped: the recording they asked for was stopped at their request, and saved. */
export type RecordAnswer = 'asked' | 'started' | 'declined' | 'recording' | 'unavailable' | 'stopped';
export interface RecordAnswerEvent { v: 1; answer: RecordAnswer }
/* A viewer's requests closer together than this are ignored, so nobody can flood the
   participant with prompts. */
export const RECORD_ASK_GAP_MS = 10_000;

/* A fall, as the phone's alarm goes through it: detected (the alarm is counting down),
   ok (the participant tapped "I'm OK"), raised (nobody answered), dismissed (the raised
   alarm was closed). `at` (epoch ms) identifies the fall across its events. */
export type FallState = 'detected' | 'ok' | 'raised' | 'dismissed';
export interface FallEvent { v: 1; at: number; state: FallState; impactG: number }

export const fallEvent = (f: { atIso: string; impactPeakG: number }, state: FallState): FallEvent | null => {
  const at = Date.parse(f.atIso);
  return Number.isFinite(at) ? { v: 1, at, state, impactG: Math.round(f.impactPeakG * 10) / 10 } : null;
};

/* One viewer's share of a batch: only their signals, and only those with new values.
   Null when there is nothing for them. */
export function samplesEvent(batch: Batch, allowed: readonly SensorType[], sentAt: number): SamplesEvent | null {
  const signals: Record<string, SignalBatch> = {};
  for (const t of allowed) {
    const s = batch[t];
    if (s && s.values.length) signals[String(t)] = s;
  }
  return Object.keys(signals).length ? { v: 1, sentAt, signals } : null;
}

export function statusEvent(s: {
  state: 'live' | 'stopped'; endsAt: number; device: string; simulated: boolean;
  streamed: readonly SensorType[]; allowed: readonly SensorType[]; recording: boolean; startedByYou: boolean;
  link: 'bluetooth' | 'wifi' | 'simulation'; firmware: string | null; sensors: readonly SensorType[];
}): StatusEvent {
  return {
    v: 1, state: s.state, endsAt: s.endsAt, device: s.device, simulated: s.simulated,
    signals: s.streamed.filter((t) => s.allowed.includes(t)).map(Number).sort((a, b) => a - b),
    recording: s.recording, startedByYou: s.recording && s.startedByYou, link: s.link, firmware: s.firmware,
    sensors: s.sensors.filter((t) => s.allowed.includes(t)).map(Number).sort((a, b) => a - b),
  };
}

/* Round to the protocol's own resolution (ECG 0.001 mV, HR 0.1 BPM, …): exact for
   what the sensor sent, and it keeps float noise out of the JSON. */
const factorFor = (t: SensorType): number => {
  const scale = SAMPLE_SCALE[t]?.scale ?? 0.001;
  return 10 ** Math.max(0, Math.round(-Math.log10(scale)));
};

/* Gathers samples between sends and times them on the phone's wall clock. */
export class SampleBatcher {
  private pending = new Map<SensorType, SignalBatch>();
  private clocks = new Map<SensorType, { rateHz: number; nextAt: number }>();
  private lastSeen = new Map<SensorType, number>();
  private lastSimulatedAt = Number.NEGATIVE_INFINITY;

  /* One packet's samples; `atMs` is its arrival, about the time of its LAST sample. */
  push(sensor: SensorType, samples: readonly number[], rateHz: number, atMs: number, simulated = false, leadsOff = false): void {
    if (!samples.length || !(rateHz > 0)) return;
    this.lastSeen.set(sensor, atMs);
    if (simulated) this.lastSimulatedAt = atMs;
    const period = 1000 / rateHz;
    const arrivedFirst = atMs - (samples.length - 1) * period;
    const clock = this.clocks.get(sensor);
    const continuous = clock != null && clock.rateHz === rateHz && rateHz > LOW_RATE_HZ
      && Math.abs(arrivedFirst - clock.nextAt) <= REANCHOR_MS;
    const first = continuous ? clock.nextAt : arrivedFirst;
    this.clocks.set(sensor, { rateHz, nextAt: first + samples.length * period });

    let batch = this.pending.get(sensor);
    /* A batch is one evenly spaced run: a rate change starts a new one. */
    if (!batch || batch.rateHz !== rateHz) { batch = { rateHz, t0: first, values: [] }; this.pending.set(sensor, batch); }
    if (leadsOff) batch.leadsOff = true; else delete batch.leadsOff;
    const f = factorFor(sensor);
    for (const v of samples) batch.values.push(Math.round(v * f) / f);
    const over = batch.values.length - MAX_VALUES_PER_SIGNAL;
    if (over > 0) { batch.values.splice(0, over); batch.t0 += over * period; }
  }

  /* Everything gathered since the last call. */
  take(): Batch {
    const out: Batch = {};
    for (const [t, b] of this.pending) out[t] = b;
    this.pending.clear();
    return out;
  }

  /* The signals the sensor is streaming now. */
  streamed(now: number): SensorType[] {
    return [...this.lastSeen].filter(([, at]) => now - at <= STREAMED_WINDOW_MS).map(([t]) => t).sort((a, b) => a - b);
  }

  simulatedRecently(now: number): boolean {
    return now - this.lastSimulatedAt <= STREAMED_WINDOW_MS;
  }
}
