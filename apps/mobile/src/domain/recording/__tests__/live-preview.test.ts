import { SensorType } from '@wearwise/sensor-protocol';
import { RecordingEngine } from '../recording-engine';
import { SimulatedSensorTransport } from '@/data/simulation/simulated-transport';
import { MemorySessionStore } from '@/data/local/memory-session-store';

/* Live preview: readings on screen from the moment the sensor connects, nothing saved
 * until a recording starts — and then only the signals chosen for it. */

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const ALL = [SensorType.Ecg, SensorType.SpO2, SensorType.Temperature];
const CONFIG = {
  deviceName: 'Simulated Patch', firmwareVersion: null, protocolVersion: 1,
  channels: [
    { sensorType: SensorType.Ecg, sampleRateHz: 250 },
    { sensorType: SensorType.SpO2, sampleRateHz: 1 },
    { sensorType: SensorType.Temperature, sampleRateHz: 2 },
  ],
};

async function flushMicrotasks(n = 8) { for (let i = 0; i < n; i++) await Promise.resolve(); }
async function advance(ms: number) {
  for (let t = 0; t < ms; t += 50) { jest.advanceTimersByTime(50); await flushMicrotasks(); }
}

beforeEach(() => { jest.useFakeTimers(); counter = 0; });
afterEach(() => { jest.useRealTimers(); });

async function previewing() {
  const transport = new SimulatedSensorTransport({ seed: 1, packetIntervalMs: 200 });
  const store = new MemorySessionStore();
  const engine = new RecordingEngine(transport, store);
  const connect = transport.connect();
  await advance(200);
  await connect;
  const p = engine.startPreview('11111111-2222-4333-8444-555555555555', ALL);
  await flushMicrotasks(20);
  await p;
  return { transport, store, engine };
}

describe('live preview', () => {
  test('shows every streamed reading and saves nothing', async () => {
    const { store, engine } = await previewing();
    await advance(3000);
    const snap = engine.snapshot();
    expect(snap.previewing).toBe(true);
    expect(snap.state).toBe('idle');
    for (const s of ALL) expect(snap.channels[s]?.lastAtMs).toBeGreaterThan(0);
    expect(snap.channels[SensorType.Ecg]!.recent.length).toBeGreaterThan(100);
    expect(store.sessions.size).toBe(0);
    expect(store.chunks).toHaveLength(0);
    engine.dispose();
  });

  test('recording saves only the chosen signals while all of them stay live', async () => {
    const { store, engine } = await previewing();
    await advance(1000);
    const start = engine.start({ userId: 'u', sensors: [SensorType.Ecg], configuration: CONFIG, deviceId: 'dev', newId });
    await flushMicrotasks(20);
    await start;
    const tempBefore = engine.snapshot().channels[SensorType.Temperature]!.lastAtMs;
    await advance(3000);

    const snap = engine.snapshot();
    expect(snap.state).toBe('recording');
    expect(snap.channels[SensorType.Temperature]!.lastAtMs).toBeGreaterThan(tempBefore);   // still live
    const sessionId = snap.sessionId!;
    const channels = [...store.channels.values()].filter((c) => c.sessionId === sessionId);
    expect(channels.map((c) => c.sensorType)).toEqual([SensorType.Ecg]);                     // only ECG saved
    expect(store.chunks.every((c) => c.channelId === channels[0]!.id)).toBe(true);
    expect(snap.channels[SensorType.Ecg]!.summary.sampleCount).toBeGreaterThan(0);

    await engine.stop();
    engine.dispose();
  });

  test('after the recording stops, the preview carries on and nothing more is saved', async () => {
    const { store, engine } = await previewing();
    const start = engine.start({ userId: 'u', sensors: [SensorType.SpO2], configuration: CONFIG, deviceId: 'dev', newId });
    await flushMicrotasks(20);
    await start;
    await advance(2000);
    const stop = engine.stop();
    await advance(400);
    await stop;
    await advance(400);
    const chunksAtStop = store.chunks.length;
    const ecgAt = engine.snapshot().channels[SensorType.Ecg]!.lastAtMs;

    await advance(3000);
    const snap = engine.snapshot();
    expect(snap.state).toBe('saved');
    expect(snap.previewing).toBe(true);
    expect(snap.channels[SensorType.Ecg]!.lastAtMs).toBeGreaterThan(ecgAt);
    expect(store.chunks.length).toBe(chunksAtStop);
    expect([...store.sessions.values()][0]!.status).toBe('complete');
    engine.dispose();
  });

  test('stopping the preview clears the readings', async () => {
    const { engine } = await previewing();
    await advance(1000);
    await engine.stopPreview();
    expect(engine.snapshot().previewing).toBe(false);
    expect(engine.snapshot().channels).toEqual({});
    await advance(1000);
    expect(engine.snapshot().channels).toEqual({});
    engine.dispose();
  });
});
