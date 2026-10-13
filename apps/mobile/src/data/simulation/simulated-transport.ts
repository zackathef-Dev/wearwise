import {
  encodePacket, decodePacket, FLAG_SIMULATED, FLAG_LEADS_OFF, SensorType, SAMPLE_SCALE,
  type SensorPacket,
} from '@wearwise/sensor-protocol';
import type {
  SensorTransport, DeviceIdentity, SensorCapability, TransportConnectionState,
} from '@/domain/repositories/sensor-transport';
import { generatorFor, prng, defaultRate, type SignalGenerator } from './signals';

/* SimulatedSensorTransport — an ESP32 that does not exist yet.
 *
 * It behaves like the real device at the protocol level: it ENCODES packets to
 * bytes and the app DECODES them, so the simulation exercises the exact codec,
 * sequence numbers, bootId, and FLAG_SIMULATED path the BLE transport will. When
 * the firmware arrives in Milestone 4 the only thing that changes is which class
 * produces the bytes.
 *
 * Faults are configurable and deterministic (seeded): packet loss, a dropout
 * window, a restart mid-session. A test that says "gap detected at sequence 40"
 * can rely on it happening at sequence 40 every time.
 */

export interface SimulationOptions {
  seed?: number;
  /* Probability that any given packet is silently not delivered. */
  packetLoss?: number;
  /* Deliver nothing during [fromMs, toMs) of streaming — models a BLE dropout. */
  dropoutMs?: { from: number; to: number };
  /* Simulate the device rebooting at this many ms into the stream: new bootId,
     sequences AND the device clock restart at 0, and `restartGapMs` of samples are
     lost while it boots — exactly what the real patch does. */
  restartAtMs?: number;
  restartGapMs?: number;
  /* Flag every ECG packet leads-off, as the patch does with electrodes detached. */
  ecgLeadsOff?: boolean;
  /* Packet cadence. Smaller = more, smaller packets. */
  packetIntervalMs?: number;
  deviceId?: string;
  deviceName?: string;
}

const SIM_DEVICE_ID = '51ae1a7e-0000-4000-8000-000000000001';

export class SimulatedSensorTransport implements SensorTransport {
  readonly type = 'simulation' as const;

  private stateListeners = new Set<(s: TransportConnectionState) => void>();
  private packetListeners = new Set<(p: SensorPacket) => void>();
  private state: TransportConnectionState = 'disconnected';
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: Required<Omit<SimulationOptions, 'dropoutMs' | 'restartAtMs' | 'restartGapMs' | 'ecgLeadsOff'>> & Pick<SimulationOptions, 'dropoutMs' | 'restartAtMs' | 'restartGapMs' | 'ecgLeadsOff'>;
  private bootId: number;
  private rand: () => number;

  /* Per-sensor streaming state. */
  private streams = new Map<SensorType, { gen: SignalGenerator; nextIndex: number; seq: number; clockOrigin: number }>();
  private sessionId: string | null = null;
  private streamStartMs = 0;
  private restarted = false;

  constructor(options: SimulationOptions = {}) {
    this.opts = {
      seed: options.seed ?? 20260826,
      packetLoss: options.packetLoss ?? 0,
      packetIntervalMs: options.packetIntervalMs ?? 200,
      deviceId: options.deviceId ?? SIM_DEVICE_ID,
      deviceName: options.deviceName ?? 'Simulated Patch',
      dropoutMs: options.dropoutMs,
      restartAtMs: options.restartAtMs,
      restartGapMs: options.restartGapMs,
      ecgLeadsOff: options.ecgLeadsOff,
    };
    this.rand = prng(this.opts.seed);
    this.bootId = 1 + Math.floor(this.rand() * 1000);
  }

  identity(): DeviceIdentity {
    return { deviceId: this.opts.deviceId, displayName: this.opts.deviceName, address: 'sim://local', transport: 'simulation' };
  }

  private setState(s: TransportConnectionState) {
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    await new Promise((r) => setTimeout(r, 120));
    this.setState('connected_ble'); // the simulation pretends to be the BLE path
  }

  async disconnect(): Promise<void> {
    await this.stopStreaming();
    this.setState('disconnected');
  }

  async discoverCapabilities(): Promise<SensorCapability[]> {
    return [SensorType.Ecg, SensorType.HeartRate, SensorType.SpO2, SensorType.Temperature, SensorType.Accelerometer, SensorType.Ppg].map((sensorType) => ({
      sensorType, sampleRateHz: defaultRate(sensorType), unit: SAMPLE_SCALE[sensorType].unit, reporting: true,
    }));
  }

  async startStreaming(sessionId: string, sensors: SensorType[]): Promise<void> {
    if (this.state !== 'connected_ble') throw new Error('not connected');
    await this.stopStreaming();
    this.sessionId = sessionId;
    this.streams.clear();
    for (const s of sensors) {
      this.streams.set(s, { gen: generatorFor(s, this.opts.seed ^ s), nextIndex: 0, seq: 0, clockOrigin: 0 });
    }
    this.streamStartMs = Date.now();
    this.restarted = false;
    this.timer = setInterval(() => this.tick(), this.opts.packetIntervalMs);
  }

  async stopStreaming(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sessionId = null;
  }

  private tick() {
    if (!this.sessionId) return;
    const elapsed = Date.now() - this.streamStartMs;

    if (this.opts.restartAtMs != null && !this.restarted && elapsed >= this.opts.restartAtMs) {
      /* A reboot: new bootId, every stream's sequence AND device clock back to 0,
         and the samples during the boot are lost — like the real patch. */
      this.restarted = true;
      this.bootId += 1;
      for (const st of this.streams.values()) {
        st.seq = 0;
        /* Samples generated while booting are consumed but never sent; the device
           clock restarts at the first sample AFTER the boot window. */
        st.clockOrigin = st.nextIndex + Math.round(((this.opts.restartGapMs ?? 0) * st.gen.sampleRateHz) / 1000);
      }
      this.setState('reconnecting');
      setTimeout(() => this.setState('connected_ble'), 50);
    }

    /* While "booting" the device sends nothing, like the real patch. */
    const booting = this.restarted && this.opts.restartAtMs != null
      && elapsed < this.opts.restartAtMs + (this.opts.restartGapMs ?? 0);
    const inDropout = booting || (this.opts.dropoutMs && elapsed >= this.opts.dropoutMs.from && elapsed < this.opts.dropoutMs.to);

    for (const [sensorType, st] of this.streams) {
      const full = Math.max(1, Math.round((st.gen.sampleRateHz * this.opts.packetIntervalMs) / 1000));
      /* The real patch's first packet after a reboot is a near-empty flush. */
      const n = this.restarted && !booting && st.seq === 0 ? Math.max(1, Math.round(full / 25)) : full;
      const samples: number[] = [];
      for (let k = 0; k < n; k++) samples.push(st.gen.at(st.nextIndex + k));
      const firstIndex = st.nextIndex;
      st.nextIndex += n;
      const seq = st.seq++;

      /* Faults are decided AFTER the sequence is consumed, exactly like a device
         that sent the packet and it never arrived. */
      if (inDropout) continue;
      if (this.opts.packetLoss > 0 && this.rand() < this.opts.packetLoss) continue;

      const bytes = encodePacket({
        deviceId: this.opts.deviceId,
        bootId: this.bootId,
        sessionId: this.sessionId,
        sensorType,
        sequenceNumber: seq,
        deviceTimestampUs: BigInt(Math.round(((firstIndex - st.clockOrigin) / st.gen.sampleRateHz) * 1_000_000)),
        sampleRateHz: st.gen.sampleRateHz,
        samples,
        flags: FLAG_SIMULATED | (this.opts.ecgLeadsOff && sensorType === SensorType.Ecg ? FLAG_LEADS_OFF : 0),
      });
      /* Round-trip through the codec on purpose (see class comment). */
      const packet = decodePacket(bytes);
      for (const l of this.packetListeners) l(packet);
    }
  }

  onConnectionState(listener: (s: TransportConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  onPacket(listener: (p: SensorPacket) => void): () => void {
    this.packetListeners.add(listener);
    return () => this.packetListeners.delete(listener);
  }
}
