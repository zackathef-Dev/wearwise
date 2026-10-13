import {
  SequenceTracker, SAMPLE_SCALE, SENSOR_CODES, FLAG_SIMULATED, FLAG_LEADS_OFF, crc32, SensorType,
  type SensorPacket,
} from '@wearwise/sensor-protocol';
import { FallDetector } from '@/domain/fall/fall-detector';
import type { SensorTransport, TransportConnectionState } from '@/domain/repositories/sensor-transport';
import type { SessionStore } from '@/domain/repositories/session-store';
import { emptySummary, type ChannelSummary, type RecordingState, type SessionConfiguration, type TransportType } from '@/domain/entities/session';

/* The recording engine — build-instruction §15 as a state machine.
 *
 *   idle → preparing → recording → stopping → saved
 *                          └──────────────→ failed
 *
 * It is the ONLY consumer of packets during a session. It dedups by sequence,
 * buffers per channel, and flushes to the store on a policy that bounds loss:
 * a chunk is written when its buffer reaches FLUSH_SAMPLES or FLUSH_MS elapses,
 * whichever first — so an app crash loses at most ~1 s of data (documented in
 * docs/architecture/offline-first.md).
 *
 * Nothing here knows about React, SQL or Bluetooth. `store` and `transport` are
 * ports; the screens read `snapshot()` and subscribe to `onChange`.
 */

const FLUSH_SAMPLES = 512;   // ≈ 7 s of ECG at 70 Hz, but FLUSH_MS fires first
const FLUSH_MS = 1000;

/* UI notifications are coalesced to this cadence (~15 fps). Ingest still runs at
   the full packet rate — buffers, summaries and flushes are untouched, so recording
   fidelity is unchanged. What this bounds is how often React re-renders: without it,
   4 sensors at 5 packets/s each drive ~20 full-tree re-renders per second (every one
   rebuilding the Skia trace path), which saturates the JS thread and makes the graph
   stutter and taps lag. State transitions bypass this and emit immediately. */
const NOTIFY_MS = 66;

export interface EngineSnapshot {
  state: RecordingState;
  sessionId: string | null;
  startedAt: string | null;
  elapsedMs: number;
  simulated: boolean;
  transport: TransportType | null;
  connection: TransportConnectionState;
  /* Live, per sensor — for the monitoring screen. */
  channels: Partial<Record<SensorType, {
    latest: number | null;
    summary: ChannelSummary;
    /* Most recent samples for the trace, newest last. Bounded. */
    recent: number[];
    /* Arrival time (ms) per entry in `recent`; EMPTY for high-rate channels, where
       index-based plotting is already time-correct. Present for gappy low-rate
       streams (HR/SpO₂) so the UI can place them on a true time axis. */
    recentAt: number[];
    /* Wall-clock (ms) of the newest sample — the UI blanks the number/trace when a
       channel goes quiet (e.g. finger lifted off the MAX30102). 0 = no data yet. */
    lastAtMs: number;
    /* Channel sample rate (Hz) — lets the live trace scroll on a real time axis. */
    rateHz: number;
    /* ECG: the newest packet was flagged leads-off, so its samples are not a
       signal — the UI must say "not attached", never show 0 mV as a reading. */
    leadsOff: boolean;
  }>>;
  transportSwitchCount: number;
  failure: string | null;
  /* Live preview: the sensor is streaming and `channels` shows its readings, but
     nothing is being saved. Independent of `state` — a recording can run on top of
     the preview, and the preview carries on after the recording stops. */
  previewing: boolean;
  /* An unacknowledged fall, if one has been detected on the accelerometer channel
     and not yet dismissed. Set the instant a fall confirms (emitted immediately, not
     coalesced) so the alarm shows at once; cleared by clearFall() on "I'm OK". */
  fall: FallSnapshot | null;
}

/* A fall the engine has detected during this session, surfaced to the UI. */
export interface FallSnapshot {
  /* Session elapsed time (ms) at which the fall confirmed; 0 outside a recording. */
  atMs: number;
  /* Wall clock (ISO) of the fall, and the recording it happened in (null = live
     preview, nothing being saved). Captured at detection so the alarm resolves the
     right fall even if a recording starts or stops while it is on screen. */
  atIso: string;
  sessionId: string | null;
  freefallMinG: number;
  impactPeakG: number;
}

interface ChannelState {
  channelId: string;
  sensorType: SensorType;
  sampleRateHz: number;
  summary: ChannelSummary;
  buffer: number[];          // physical units, pending flush
  bufferFirstSeq: number;
  bufferLastSeq: number;
  bufferStartUs: bigint;
  bufferEndUs: bigint;
  chunkNumber: number;
  /* Added to every device timestamp on this channel. The device clock restarts at 0
     when the patch reboots, so after a restart the stream is re-anchored onto the
     session's wall-clock timeline instead of overlapping its first seconds. */
  timeOffsetUs: bigint;
}

/* Live-trace window per sensor, in SECONDS — the sample cap is derived from the
   channel's real rate, so the "last N s" label stays true for any firmware rate
   (a fixed 70 Hz ECG cap showed only 1.7 s of a 250 Hz stream). */
/* Live history per signal — at least the longest window a live graph offers
   (shared/graph-window.ts LIVE_WINDOWS). Slow vitals are ~1 Hz, so even 15 min of
   temperature is ~900 numbers; movement (50 Hz) stays at 30 s. */
const RECENT_WINDOW_S: Record<number, number> = { 1: 6, 2: 300, 3: 900, 4: 300, 5: 30, 6: 6 }; // ECG, SpO₂, temp, HR, accel, PPG
const recentMax = (sensorType: number, rateHz: number): number =>
  Math.max(2, Math.ceil((RECENT_WINDOW_S[sensorType] ?? 6) * (rateHz > 0 ? rateHz : 1)));

/* Channels at or below this rate get per-sample arrival timestamps (see recentAt).
   Above it, streams are continuous and dense, so index-based plotting is already
   time-correct and the extra array would cost real work on the packet firehose. */
const TIMED_MAX_HZ = 5;
/* Shared empty array for untimed (high-rate) channels — avoids allocating per patch. */
const EMPTY_TIMES: number[] = [];

/* What the screens see of one sensor: its rolling trace. Kept for every STREAMED
   sensor (preview and recording alike), separately from the per-channel recording
   state, so recording a subset never blanks the others on screen. */
interface LiveState {
  rateHz: number;
  recent: number[];
  /* Arrival time (ms) per entry in `recent`, kept ONLY for low-rate channels
     (see TIMED_MAX_HZ). Those streams are gappy — HR/SpO₂ publish only when the
     estimate is valid — so plotting them by sample index distorts time. High-rate
     channels are continuous, so index IS time for them and they skip this cost. */
  recentAt: number[];
}

export interface StartOptions {
  userId: string;
  sensors: SensorType[];
  configuration: SessionConfiguration;
  deviceId: string;
  newId: () => string;
}

/* One accepted packet's samples as they reach the screen (deduplicated, canonical
   units) — for consumers that need every value, not the coalesced snapshot. */
export interface LiveSamples {
  sensorType: SensorType;
  samples: readonly number[];
  rateHz: number;
  /* The packet carried FLAG_SIMULATED. */
  simulated: boolean;
  /* The packet carried FLAG_LEADS_OFF (ECG: an electrode isn't on the skin). */
  leadsOff: boolean;
  /* Wall clock (ms) on arrival — about the time of the LAST sample. */
  atMs: number;
}

export class RecordingEngine {
  private snap: EngineSnapshot = {
    state: 'idle', sessionId: null, startedAt: null, elapsedMs: 0, simulated: false,
    transport: null, connection: 'disconnected', channels: {}, transportSwitchCount: 0, failure: null, fall: null,
    previewing: false,
  };
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private sampleListeners = new Set<(s: LiveSamples) => void>();
  private channels = new Map<SensorType, ChannelState>();
  private live = new Map<SensorType, LiveState>();
  /* Preview stream: the sensors streamed while not recording, and the stream id the
     device stamps on them. Null = no preview. */
  private preview: { streamId: string; sensors: SensorType[] } | null = null;
  /* Where START/STOP go. On Wi-Fi the packet source is a WebSocket that cannot carry
     commands, so Bluetooth stays the control link. Defaults to the packet transport
     (simulation, Bluetooth alone). */
  private control: SensorTransport | null = null;
  private tracker = new SequenceTracker();
  /* Runs on the accelerometer magnitude stream while recording; null when no
     accelerometer channel is active this session. */
  private fallDetector: FallDetector | null = null;
  private fallRateHz = 0;
  private unsubPacket: (() => void) | null = null;
  private unsubState: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private startedMs = 0;
  private flushing: Promise<void> = Promise.resolve();

  constructor(private transport: SensorTransport, private store: SessionStore) {
    this.unsubState = transport.onConnectionState((c) => this.patch({ connection: c }));
  }

  snapshot(): EngineSnapshot { return this.snap; }

  /* Send START/STOP over this transport instead of the packet transport. */
  setControlTransport(t: SensorTransport | null): void { this.control = t; }
  private commands(): SensorTransport { return this.control ?? this.transport; }
  private busy(): boolean {
    return this.snap.state === 'recording' || this.snap.state === 'preparing' || this.snap.state === 'stopping';
  }

  /* ---- live preview ----
     Stream `sensors` and show their readings without saving anything. Safe to call
     again (e.g. after a reconnect); while a recording runs it only updates what the
     preview resumes with when the recording stops. */
  async startPreview(streamId: string, sensors: SensorType[]): Promise<void> {
    if (!sensors.length) return;
    this.preview = { streamId, sensors: [...sensors] };
    if (this.busy()) return;
    this.tracker.reset();
    this.subscribePackets();
    this.patch({ previewing: true });
    try {
      await this.commands().startStreaming(streamId, sensors);
    } catch (e) {
      this.preview = null;
      this.unsubPacket?.(); this.unsubPacket = null;
      this.patch({ previewing: false });
      throw e;
    }
  }

  /* End the preview: the device stops streaming and the readings clear. A running
     recording is not affected (it stops the device itself when it ends). */
  async stopPreview(): Promise<void> {
    if (!this.preview) return;
    this.preview = null;
    if (this.busy()) { this.patch({ previewing: false }); return; }
    this.unsubPacket?.(); this.unsubPacket = null;
    this.live.clear();
    this.patch({ previewing: false, channels: {} });
    try { await this.commands().stopStreaming(); } catch { /* link already gone */ }
  }

  private subscribePackets(): void {
    this.unsubPacket?.();
    this.unsubPacket = this.transport.onPacket((p) => this.ingest(p));
  }
  onChange(l: (s: EngineSnapshot) => void): () => void { this.listeners.add(l); l(this.snap); return () => { this.listeners.delete(l); }; }

  /* Every streamed packet's samples, preview or recording, at full rate. Listeners run
     inside ingest, so they must be quick; one that throws is ignored. */
  onSamples(l: (s: LiveSamples) => void): () => void { this.sampleListeners.add(l); return () => { this.sampleListeners.delete(l); }; }

  /* Dismiss the current fall alarm ("I'm OK"). The detector keeps running, so a
     later, distinct fall can still raise a fresh alarm. */
  clearFall(): void { if (this.snap.fall) this.patch({ fall: null }); }

  /* `immediate` (the default) notifies synchronously — used for every state change
     so the UI reacts to start/stop/connection/failure at once. The high-frequency
     ingest and clock updates pass immediate=false: snap is still updated in place
     (so snapshot() is always current), but listeners are notified at most once per
     NOTIFY_MS, collapsing a burst of same-tick packets into a single re-render. */
  private patch(p: Partial<EngineSnapshot>, immediate = true) {
    this.snap = { ...this.snap, ...p };
    if (immediate) this.emit();
    else this.schedule();
  }

  private emit() {
    if (this.notifyTimer) { clearTimeout(this.notifyTimer); this.notifyTimer = null; }
    for (const l of this.listeners) l(this.snap);
  }

  private schedule() {
    if (this.notifyTimer) return; // a frame is already pending; it will send the latest snap
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const l of this.listeners) l(this.snap);
    }, NOTIFY_MS);
  }

  /* Swap the packet source without touching the session — the fallback path.
     Sequence tracking persists across the swap, which is what drops the overlap. */
  attachTransport(next: SensorTransport): void {
    this.unsubPacket?.();
    this.unsubState?.();
    this.transport = next;
    this.unsubState = next.onConnectionState((c) => this.patch({ connection: c }));
    if (this.snap.state === 'recording') {
      this.unsubPacket = next.onPacket((p) => this.ingest(p));
      this.patch({ transport: next.type, transportSwitchCount: this.snap.transportSwitchCount + 1 });
    } else {
      this.unsubPacket = this.preview ? next.onPacket((p) => this.ingest(p)) : null;
      this.patch({ transport: next.type });
    }
  }

  async start(opts: StartOptions): Promise<void> {
    if (this.snap.state !== 'idle' && this.snap.state !== 'saved' && this.snap.state !== 'failed') {
      throw new Error(`cannot start from state ${this.snap.state}`);
    }
    const sessionId = opts.newId();
    const startedAt = new Date().toISOString();
    /* `simulated` is per session: it resets here and only this session's packet flags
       raise it. Carrying it over meant one simulated session made every later real
       session display — and be SAVED — as simulated. */
    /* The preview's readings stay on screen through the switch — only the session
       bookkeeping starts fresh. */
    this.patch({ state: 'preparing', sessionId, startedAt, elapsedMs: 0, failure: null, transportSwitchCount: 0, transport: this.transport.type, simulated: false });

    try {
      /* 1–4: validate + create the session row and its channels BEFORE any packet,
         so a crash during preparing leaves an empty-but-honest session, never a
         chunk with no parent. */
      await this.store.createSession({
        id: sessionId, userId: opts.userId, deviceId: opts.deviceId, startedAt,
        simulated: this.transport.type === 'simulation',
        initialTransport: this.transport.type, configurationSnapshot: opts.configuration,
      });
      this.channels.clear();
      this.tracker.reset();
      const channels: EngineSnapshot['channels'] = { ...this.snap.channels };
      for (const sensorType of opts.sensors) {
        const cfg = opts.configuration.channels.find((c) => c.sensorType === sensorType);
        const channelId = opts.newId();
        await this.store.createChannel({
          id: channelId, sessionId, sensorType, canonicalUnit: SAMPLE_SCALE[sensorType]?.unit ?? '',
          sampleRateHz: cfg?.sampleRateHz ?? 0,
        });
        this.channels.set(sensorType, {
          channelId, sensorType, sampleRateHz: cfg?.sampleRateHz ?? 0, summary: emptySummary(),
          buffer: [], bufferFirstSeq: 0, bufferLastSeq: 0, bufferStartUs: 0n, bufferEndUs: 0n, chunkNumber: 0,
          timeOffsetUs: 0n,
        });
        const prior = channels[sensorType];
        channels[sensorType] = prior
          ? { ...prior, summary: emptySummary() }
          : { latest: null, summary: emptySummary(), recent: [], recentAt: [], lastAtMs: 0, rateHz: cfg?.sampleRateHz ?? 0, leadsOff: false };
      }

      /* 5–7: subscribe, start the device, start the clock. The device streams the
         recorded sensors PLUS whatever the preview shows, so the screens keep every
         reading; only the selected ones are saved. */
      this.subscribePackets();
      const streamed = [...new Set([...opts.sensors, ...(this.preview?.sensors ?? [])])];
      await this.commands().startStreaming(sessionId, streamed);
      this.startedMs = Date.now();
      this.flushTimer = setInterval(() => void this.flushAll(), FLUSH_MS);
      this.tickTimer = setInterval(() => this.patch({ elapsedMs: Date.now() - this.startedMs }, false), 250);
      this.patch({ state: 'recording', channels });
    } catch (e) {
      this.teardownRuntime();
      this.patch({ state: 'failed', failure: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  private ingest(p: SensorPacket) {
    const recording = this.snap.state === 'recording';
    if (recording) {
      if (p.sessionId !== this.snap.sessionId) return;       // stale stream from an earlier session
    } else if (!this.preview || p.sessionId !== this.preview.streamId) {
      return;                                                 // no preview, or the tail of a finished session
    }
    const ch = recording ? this.channels.get(p.sensorType) : undefined;

    const verdict = this.tracker.observe(p);
    if (verdict.kind === 'duplicate' || verdict.kind === 'stale') {
      if (ch) ch.summary.packetsDuplicate += 1;
      return;
    }
    /* Streamed but not recorded (preview, or a sensor the recording left out): show it. */
    if (!ch) { this.showLive(p, null); return; }
    if (verdict.kind === 'accept' && verdict.gap > 0) ch.summary.sequenceGaps += verdict.gap;
    const rateHz = p.sampleRateHz > 0 ? p.sampleRateHz : 1; // never divide by zero
    const periodUs = BigInt(Math.round(1_000_000 / rateHz));
    if (verdict.kind === 'accept-after-restart') {
      /* Flush what we have: a restart is a hard discontinuity, and a chunk must
         never span one. */
      void this.flush(ch);
      /* The patch rebooted, so its clock is back near 0. Re-anchor this channel on
         the session's wall clock (never earlier than the data we already hold), and
         count the dead time as missing packets so the outage is visible, not "0 gaps". */
      const wallUs = BigInt(Math.round((Date.now() - this.startedMs) * 1000));
      const prevEndUs = ch.summary.lastTimestampUs;
      const minStartUs = prevEndUs == null ? 0n : prevEndUs + periodUs;
      const startUs = wallUs > minStartUs ? wallUs : minStartUs;
      ch.timeOffsetUs = startUs - p.deviceTimestampUs;
      if (prevEndUs != null) {
        /* Size the dead time in TYPICAL packets: the first packet after a reboot is
           often a near-empty flush, and dividing by it inflated a 6 s outage ~20×. */
        const s = ch.summary;
        const avgSamples = s.packetsAccepted > 0 ? s.sampleCount / s.packetsAccepted : p.samples.length;
        const packetUs = Math.max(1, (avgSamples / rateHz) * 1_000_000);
        const missing = Math.round(Number(startUs - minStartUs) / packetUs);
        ch.summary.sequenceGaps += Math.max(1, missing);
      }
    }

    /* A packet-level sample-gap also closes the chunk, so chunk boundaries line
       up with real discontinuities and each chunk is internally contiguous. */
    if (ch.buffer.length && (verdict.kind === 'accept' && verdict.gap > 0)) void this.flush(ch);

    const tsUs = p.deviceTimestampUs + ch.timeOffsetUs;
    if (ch.buffer.length === 0) { ch.bufferFirstSeq = p.sequenceNumber; ch.bufferStartUs = tsUs; }
    ch.bufferLastSeq = p.sequenceNumber;
    ch.bufferEndUs = tsUs + BigInt(Math.round(((p.samples.length - 1) / rateHz) * 1_000_000));
    for (const v of p.samples) {
      ch.buffer.push(v);
      ch.summary.sampleCount += 1;
      ch.summary.sum += v;
      if (v < ch.summary.min) ch.summary.min = v;
      if (v > ch.summary.max) ch.summary.max = v;
    }
    ch.summary.packetsAccepted += 1;
    if (ch.summary.firstTimestampUs == null) ch.summary.firstTimestampUs = tsUs;
    ch.summary.lastTimestampUs = ch.bufferEndUs;

    this.showLive(p, ch);
    if (ch.buffer.length >= FLUSH_SAMPLES) void this.flush(ch);
  }

  /* Push a packet onto the on-screen trace for its sensor (recorded or not). */
  private showLive(p: SensorPacket, ch: ChannelState | null) {
    const rateHz = ch?.sampleRateHz || (p.sampleRateHz > 0 ? p.sampleRateHz : 1);
    let lv = this.live.get(p.sensorType);
    if (!lv) { lv = { rateHz, recent: [], recentAt: [] }; this.live.set(p.sensorType, lv); }
    lv.rateHz = rateHz;

    const max = recentMax(p.sensorType, rateHz);
    lv.recent.push(...p.samples);
    if (lv.recent.length > max) lv.recent.splice(0, lv.recent.length - max);

    /* Timestamp low-rate samples on arrival so the UI can lay them on a real time
       axis. Samples inside one packet are spaced by the channel period; the last is
       "now". Cheap here (≤ a few samples per packet at ≤ 5 Hz). */
    if (rateHz <= TIMED_MAX_HZ) {
      const now = Date.now();
      const stepMs = 1000 / rateHz;
      for (let i = 0; i < p.samples.length; i++) {
        lv.recentAt.push(now - (p.samples.length - 1 - i) * stepMs);
      }
      if (lv.recentAt.length > max) lv.recentAt.splice(0, lv.recentAt.length - max);
    }

    /* Fall detection runs on EVERY streamed accelerometer sample — live preview or
       recording, saved or not — so a fall is caught whenever the sensor is on. It only
       raises an alarm when none is already pending (one fall at a time), and patches
       immediately so the alarm appears the instant a fall confirms. */
    if (p.sensorType === SensorType.Accelerometer) {
      if (!this.fallDetector || this.fallRateHz !== rateHz) { this.fallDetector = new FallDetector(rateHz); this.fallRateHz = rateHz; }
      for (const v of p.samples) {
        const ev = this.fallDetector.push(v);
        if (ev && !this.snap.fall) {
          const recording = this.snap.state === 'recording';
          this.patch({ fall: {
            atMs: recording ? this.snap.elapsedMs : 0, atIso: new Date().toISOString(),
            sessionId: recording ? this.snap.sessionId : null,
            freefallMinG: ev.freefallMinG, impactPeakG: ev.impactPeakG,
          } });
        }
      }
    }

    const simulated = (p.flags & FLAG_SIMULATED) !== 0;
    if (this.sampleListeners.size) {
      const e: LiveSamples = { sensorType: p.sensorType, samples: p.samples, rateHz, simulated, leadsOff: (p.flags & FLAG_LEADS_OFF) !== 0, atMs: Date.now() };
      for (const l of this.sampleListeners) { try { l(e); } catch { /* never disturb ingest */ } }
    }
    const prior = this.snap.channels[p.sensorType];
    this.patch({
      simulated: this.snap.simulated || simulated,
      channels: { ...this.snap.channels, [p.sensorType]: {
        latest: p.samples[p.samples.length - 1] ?? null,
        summary: ch ? { ...ch.summary } : (prior?.summary ?? emptySummary()),
        recent: lv.recent.slice(), recentAt: lv.recentAt.length ? lv.recentAt.slice() : EMPTY_TIMES,
        lastAtMs: Date.now(), rateHz, leadsOff: (p.flags & FLAG_LEADS_OFF) !== 0,
      } },
    }, false); // coalesced — the packet firehose must not drive a re-render each time
  }

  /* Serialised so two flushes of one channel can never interleave chunk numbers. */
  private flush(ch: ChannelState): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (!ch.buffer.length || !this.snap.sessionId) return;
      const samples = ch.buffer; ch.buffer = [];
      const scale = SAMPLE_SCALE[ch.sensorType]?.scale ?? 1;
      const payload = new Uint8Array(samples.length * 2);
      const dv = new DataView(payload.buffer);
      samples.forEach((v, i) => dv.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(v / scale))), true));
      await this.store.appendChunk({
        id: `${ch.channelId}:${ch.chunkNumber}`, sessionId: this.snap.sessionId, channelId: ch.channelId,
        chunkNumber: ch.chunkNumber++, firstSequence: ch.bufferFirstSeq, lastSequence: ch.bufferLastSeq,
        startedAtUs: ch.bufferStartUs, endedAtUs: ch.bufferEndUs, sampleCount: samples.length,
        encoding: 'int16le-v1', payload, checksum: crc32(payload),
      });
      await this.store.updateChannelSummary(ch.channelId, ch.summary);
    }).catch((e) => {
      this.teardownRuntime();
      this.patch({ state: 'failed', failure: `storage: ${e instanceof Error ? e.message : String(e)}` });
    });
    return this.flushing;
  }

  private async flushAll(): Promise<void> {
    for (const ch of this.channels.values()) await this.flush(ch);
  }

  async stop(): Promise<void> {
    if (this.snap.state !== 'recording') return;
    this.patch({ state: 'stopping' });
    /* 1. stop accepting — unsubscribing before the device stops means a packet
       that arrives during the device's own shutdown is simply not ours. */
    this.teardownRuntime();
    /* With a preview running the device keeps streaming — it is switched back to the
       preview stream below instead of stopped, so the readings never blank out. */
    if (!this.preview) {
      try { await this.commands().stopStreaming(); } catch { /* device already gone — still our data to save */ }
    }
    /* 2–5: flush, close channels (summaries), close the session. */
    await this.flushAll();
    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - this.startedMs;
    await this.store.closeSession(this.snap.sessionId!, {
      endedAt, durationMs, status: 'complete',
      finalTransport: this.transport.type, transportSwitchCount: this.snap.transportSwitchCount,
      simulated: this.snap.simulated,
    });
    this.patch({ state: 'saved', elapsedMs: durationMs });
    if (this.preview) {
      this.tracker.reset();
      this.subscribePackets();
      try { await this.commands().startStreaming(this.preview.streamId, this.preview.sensors); }
      catch { /* link dropped; the transport's reconnect resumes the stream */ }
    }
  }

  /* Drop the live packet listener and the flush/tick/notify timers. `failed` must
     run this too, or a failed-then-restarted session leaks a forever-firing tickTimer
     (a re-render loop) and a stale packet listener that doubles ingest work on the
     next session — the JS-thread accumulation behind "each session laggier". */
  private teardownRuntime(): void {
    this.unsubPacket?.(); this.unsubPacket = null;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.flushTimer = this.tickTimer = null;
    if (this.notifyTimer) { clearTimeout(this.notifyTimer); this.notifyTimer = null; }
  }

  /* For tests and app teardown. Does not close the session — that is `stop`. */
  dispose(): void {
    this.unsubState?.();
    this.sampleListeners.clear();
    this.teardownRuntime();
  }
}

export const sensorLabel = (t: SensorType): string =>
  ({ ecg: 'Heart rhythm', bpm: 'Heart rate', spo2: 'Blood oxygen', temperature: 'Temperature', accel: 'Movement', ppg: 'Pulse (PPG)' })[SENSOR_CODES[t]];
