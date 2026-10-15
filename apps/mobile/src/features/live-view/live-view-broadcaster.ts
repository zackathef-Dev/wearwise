import type { SensorType } from '@wearwise/sensor-protocol';
import type { LiveLink } from '@/domain/repositories/live-link';
import {
  SampleBatcher, samplesEvent, statusEvent, STATUS_MS, RECORD_ASK_GAP_MS,
  type FallEvent, type LiveGrant, type RecordAnswer, type StatusEvent,
} from './live-view-core';

/* Sends live readings to each viewer while live view is on: every tick (~500 ms) a
 * samples event with what arrived since the last one, filtered to that viewer's
 * signals, plus a status event on joining, every 5 s and on stop. Falls go out as they
 * happen, only to viewers whose share includes falls.
 *
 * A viewer may stop watching from their side (a 'stop' on their channel): they are
 * dropped and not taken back until live view is started again. They may also ask for
 * a recording ('record'): the store asks the participant, and the answer goes back to
 * that viewer alone. Status says whether the phone is recording.
 *
 * Owns no timers and no network: the store calls tick() on its clock, and each
 * viewer's channel comes from openLink() (Supabase Realtime in the app, a fake in
 * tests). A viewer whose channel isn't joined yet (or dropped) is skipped; when it
 * (re)joins it gets a status first.
 */

export interface BroadcasterDeps {
  /* `viewer`: what the viewer asked for on their channel. */
  openLink(grantId: string, viewer: { stop(): void; record(): void; recordStop(): void }): LiveLink;
  /* A viewer stopped watching from their side and has been dropped. */
  onViewerStopped?(grantId: string): void;
  /* A viewer asked for a recording (at most once per RECORD_ASK_GAP_MS each), or to
     stop one. */
  onRecordRequest?(grant: LiveGrant): void;
  onRecordStop?(grant: LiveGrant): void;
  /* The sensor as the dashboard names it, whether its readings are simulated, and the
     signals it has reported in the last few seconds. */
  source(): {
    device: string; simulated: boolean; streamed: SensorType[]; recording: boolean; recordingBy: string | null;
    link: 'bluetooth' | 'wifi' | 'simulation'; firmware: string | null; sensors: SensorType[];
  };
  now(): number;
}

interface Viewer {
  grant: LiveGrant;
  link: LiveLink;
  /* When this viewer last got a status; null = owed one at the next chance. */
  statusAt: number | null;
  /* When they last asked for a recording. */
  recordAskAt: number;
}

const sameSignals = (a: readonly SensorType[], b: readonly SensorType[]) =>
  a.length === b.length && a.every((t) => b.includes(t));
/* A fall still worth telling someone who (re)joins: its alarm is on screen. */
const pending = (f: FallEvent | null) => (f && (f.state === 'detected' || f.state === 'raised') ? f : null);

export class LiveViewBroadcaster {
  private batcher = new SampleBatcher();
  private viewers = new Map<string, Viewer>();
  /* Viewers who stopped watching; setGrants doesn't bring them back. */
  private stoppedBy = new Set<string>();
  private lastFall: FallEvent | null = null;
  private stopped = false;

  constructor(private deps: BroadcasterDeps, readonly endsAt: number) {}

  /* The current list of who may watch. Someone no longer on it gets nothing more —
     not even a goodbye — and their channel is left. A changed signal list takes
     effect with the next batch, announced by a fresh status. */
  setGrants(grants: readonly LiveGrant[]): void {
    if (this.stopped) return;
    const keep = new Set(grants.map((g) => g.id));
    for (const [id, v] of this.viewers) {
      if (!keep.has(id)) { this.viewers.delete(id); void v.link.close(); }
    }
    for (const grant of grants) {
      if (this.stoppedBy.has(grant.id)) continue;
      const v = this.viewers.get(grant.id);
      if (!v) {
        const link = this.deps.openLink(grant.id, {
          stop: () => this.viewerStopped(grant.id),
          record: () => this.recordRequested(grant.id),
          recordStop: () => { const v = this.viewers.get(grant.id); if (!this.stopped && v) this.deps.onRecordStop?.(v.grant); },
        });
        this.viewers.set(grant.id, { grant, link, statusAt: null, recordAskAt: Number.NEGATIVE_INFINITY });
        continue;
      }
      if (!sameSignals(v.grant.sensorTypes, grant.sensorTypes) || v.grant.includeFalls !== grant.includeFalls) v.statusAt = null;
      v.grant = grant;
    }
  }

  /* The answer to a viewer's recording request, to them alone. */
  answerRecord(grantId: string, answer: RecordAnswer): void {
    const v = this.viewers.get(grantId);
    if (!this.stopped && v?.link.ready()) void v.link.send('record', { v: 1, answer });
  }

  /* Recording started or stopped: everyone gets a fresh status at the next tick. */
  announce(): void {
    for (const v of this.viewers.values()) v.statusAt = null;
  }

  /* Who is being sent to: everyone on the list except those who stopped watching. */
  viewing(): LiveGrant[] {
    return [...this.viewers.values()].map((v) => v.grant);
  }

  push(sensor: SensorType, samples: readonly number[], rateHz: number, atMs: number, simulated: boolean, leadsOff = false): void {
    if (!this.stopped) this.batcher.push(sensor, samples, rateHz, atMs, simulated, leadsOff);
  }

  /* A fall, at each step of the phone's alarm. Sent now to viewers who get falls; one
     whose channel isn't joined gets it when it (re)joins, if the alarm is still on. */
  fall(ev: FallEvent): void {
    if (this.stopped) return;
    this.lastFall = ev;
    for (const v of this.viewers.values()) {
      if (v.grant.includeFalls && v.link.ready()) void v.link.send('fall', ev);
    }
  }

  tick(): void {
    if (this.stopped) return;
    const now = this.deps.now();
    const batch = this.batcher.take();
    for (const v of this.viewers.values()) {
      if (!v.link.ready()) { v.statusAt = null; continue; }   // re-announce once (re)joined
      if (v.statusAt == null || now - v.statusAt >= STATUS_MS) {
        const announce = v.statusAt == null;
        void v.link.send('status', this.status('live', v.grant, now));
        v.statusAt = now;
        const fall = pending(this.lastFall);
        if (announce && fall && v.grant.includeFalls) void v.link.send('fall', fall);
      }
      const ev = samplesEvent(batch, v.grant.sensorTypes, now);
      if (ev) void v.link.send('samples', ev);
    }
  }

  /* How many viewers are connected right now. */
  reachable(): number {
    let n = 0;
    for (const v of this.viewers.values()) if (v.link.ready()) n++;
    return n;
  }

  /* Tell everyone it has stopped, then leave every channel. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.deps.now();
    const viewers = [...this.viewers.values()];
    this.viewers.clear();
    await Promise.all(viewers.map(async (v) => {
      if (v.link.ready()) await v.link.send('status', this.status('stopped', v.grant, now)).catch(() => {});
      await v.link.close().catch(() => {});
    }));
  }

  private recordRequested(id: string): void {
    const v = this.viewers.get(id);
    const now = this.deps.now();
    if (this.stopped || !v || now - v.recordAskAt < RECORD_ASK_GAP_MS) return;
    v.recordAskAt = now;
    this.deps.onRecordRequest?.(v.grant);
  }

  private viewerStopped(id: string): void {
    const v = this.viewers.get(id);
    if (this.stopped || !v) return;
    this.viewers.delete(id);
    this.stoppedBy.add(id);
    void v.link.close();
    this.deps.onViewerStopped?.(id);
  }

  private status(state: 'live' | 'stopped', grant: LiveGrant, now: number): StatusEvent {
    const src = this.deps.source();
    /* What arrived here, plus what the sensor reported just before (a 1 Hz signal may
       not have reached this batcher yet). */
    const streamed = [...new Set([...this.batcher.streamed(now), ...src.streamed])];
    return statusEvent({
      state, endsAt: this.endsAt, device: src.device,
      simulated: src.simulated || this.batcher.simulatedRecently(now),
      streamed, allowed: grant.sensorTypes, recording: src.recording, startedByYou: src.recordingBy === grant.id,
      link: src.link, firmware: src.firmware, sensors: src.sensors,
    });
  }
}
