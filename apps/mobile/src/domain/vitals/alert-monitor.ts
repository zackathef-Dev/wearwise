import type { SensorType } from '@wearwise/sensor-protocol';
import type { AlertKind } from '@/domain/entities/session';
import { VITAL_RANGES, classify } from './ranges';

/* Turns a stream of readings into alerts: a vital that stays out of range for its
 * sustain time opens one alert; it closes once the reading has been back in range
 * for CLEAR_MS, or when the sensor goes quiet. One alert per excursion — a heart
 * rate that sits at 120 for ten minutes is one alert (with its peak), not hundreds.
 *
 * Pure: time comes in with each reading and persistence goes out through the sink,
 * so the rules are unit-tested without a clock, a database or a device.
 */

/* Back in range this long before an open alert is closed (stops flapping at the edge). */
export const CLEAR_MS = 10_000;
/* No reading for this long: the sensor lost contact; close whatever is open. */
export const QUIET_MS = 10_000;

export interface AlertSink {
  open(a: { id: string; sensorType: SensorType; kind: Exclude<AlertKind, 'fall'>; value: number; startedAtMs: number }): void;
  update(id: string, patch: { value?: number; endedAtMs?: number }): void;
}

interface Track {
  pending: { kind: 'low' | 'high'; sinceMs: number; extreme: number } | null;
  open: { id: string; kind: 'low' | 'high'; extreme: number } | null;
  normalSinceMs: number | null;
  lastMs: number;
}

const moreExtreme = (kind: 'low' | 'high', a: number, b: number) => (kind === 'high' ? Math.max(a, b) : Math.min(a, b));

export class AlertMonitor {
  private tracks = new Map<SensorType, Track>();

  constructor(private sink: AlertSink, private newId: () => string) {}

  push(sensor: SensorType, value: number, atMs: number): void {
    const range = VITAL_RANGES[sensor];
    const status = classify(sensor, value);
    if (!range || !status) return;
    let t = this.tracks.get(sensor);
    if (!t) { t = { pending: null, open: null, normalSinceMs: null, lastMs: atMs }; this.tracks.set(sensor, t); }
    t.lastMs = atMs;

    const abnormal = status !== 'normal' && range.alertOn.includes(status) ? status : null;

    if (!abnormal) {
      t.pending = null;
      if (t.open) {
        t.normalSinceMs ??= atMs;
        if (atMs - t.normalSinceMs >= CLEAR_MS) {
          this.sink.update(t.open.id, { endedAtMs: t.normalSinceMs });
          t.open = null; t.normalSinceMs = null;
        }
      }
      return;
    }

    t.normalSinceMs = null;
    if (t.open && t.open.kind === abnormal) {
      const next = moreExtreme(abnormal, t.open.extreme, value);
      if (next !== t.open.extreme) { t.open.extreme = next; this.sink.update(t.open.id, { value: next }); }
      return;
    }
    if (t.open) {   // swung straight from high to low (or back): the old excursion ended now
      this.sink.update(t.open.id, { endedAtMs: atMs });
      t.open = null;
    }
    if (!t.pending || t.pending.kind !== abnormal) t.pending = { kind: abnormal, sinceMs: atMs, extreme: value };
    else t.pending.extreme = moreExtreme(abnormal, t.pending.extreme, value);

    if (atMs - t.pending.sinceMs >= range.sustainMs) {
      const id = this.newId();
      this.sink.open({ id, sensorType: sensor, kind: abnormal, value: t.pending.extreme, startedAtMs: t.pending.sinceMs });
      t.open = { id, kind: abnormal, extreme: t.pending.extreme };
      t.pending = null;
    }
  }

  /* Call periodically: closes alerts for sensors that stopped reporting. */
  tick(nowMs: number): void {
    for (const t of this.tracks.values()) {
      if (nowMs - t.lastMs < QUIET_MS) continue;
      t.pending = null;
      if (t.open) { this.sink.update(t.open.id, { endedAtMs: t.lastMs }); t.open = null; }
      t.normalSinceMs = null;
    }
  }

  /* Disconnect / sign-out: close everything at its last reading. */
  closeAll(): void {
    for (const t of this.tracks.values()) {
      if (t.open) this.sink.update(t.open.id, { endedAtMs: t.lastMs });
    }
    this.tracks.clear();
  }
}
