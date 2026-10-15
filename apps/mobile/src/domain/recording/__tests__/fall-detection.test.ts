import { SensorType } from '@wearwise/sensor-protocol';
import { RecordingEngine } from '../recording-engine';
import { SimulatedSensorTransport } from '@/data/simulation/simulated-transport';
import { MemorySessionStore } from '@/data/local/memory-session-store';

/* Fall detection end to end: the simulated accelerometer injects a textbook fall
 * ~12 s into every stream, so a recording that includes the Accelerometer channel
 * must surface it on the engine snapshot — the same path the Live alarm reads. Fake
 * timers, no radio. */

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

async function flushMicrotasks(n = 8) { for (let i = 0; i < n; i++) await Promise.resolve(); }
async function advance(ms: number) {
  const step = 50;
  for (let t = 0; t < ms; t += step) { jest.advanceTimersByTime(step); await flushMicrotasks(); }
}

async function startAccelEngine() {
  const transport = new SimulatedSensorTransport({ seed: 1, packetIntervalMs: 200 });
  const store = new MemorySessionStore();
  const engine = new RecordingEngine(transport, store);
  const connect = transport.connect();
  await advance(200);
  await connect;
  const start = engine.start({
    userId: 'user-1', sensors: [SensorType.Accelerometer],
    configuration: {
      deviceName: 'Simulated Patch', firmwareVersion: null, protocolVersion: 1,
      channels: [{ sensorType: SensorType.Accelerometer, sampleRateHz: 50 }],
    },
    deviceId: transport.identity().deviceId, newId,
  });
  await flushMicrotasks(20);
  await start;
  return { transport, store, engine };
}

beforeEach(() => { jest.useFakeTimers(); counter = 0; });
afterEach(() => { jest.useRealTimers(); });

describe('fall detection during a live recording', () => {
  test('no fall on the snapshot before the simulated fall lands', async () => {
    const { engine } = await startAccelEngine();
    expect(engine.snapshot().state).toBe('recording');
    expect(engine.snapshot().fall).toBeNull();
    await advance(8_000); // the injected fall is ~12 s in
    expect(engine.snapshot().fall).toBeNull();
  });

  test('the simulated fall raises engine.fall with impact + free-fall detail', async () => {
    const { engine } = await startAccelEngine();
    await advance(15_000);
    const fall = engine.snapshot().fall;
    expect(fall).not.toBeNull();
    expect(fall!.impactPeakG).toBeGreaterThanOrEqual(2.5);
    expect(fall!.freefallMinG).toBeLessThan(0.6);
    expect(fall!.atMs).toBeGreaterThan(11_000);
  });

  test('clearFall dismisses the alarm', async () => {
    const { engine } = await startAccelEngine();
    await advance(15_000);
    expect(engine.snapshot().fall).not.toBeNull();
    engine.clearFall();
    expect(engine.snapshot().fall).toBeNull();
  });

  test('a recording with no accelerometer channel never raises a fall', async () => {
    const transport = new SimulatedSensorTransport({ seed: 1, packetIntervalMs: 200 });
    const store = new MemorySessionStore();
    const engine = new RecordingEngine(transport, store);
    const connect = transport.connect();
    await advance(200);
    await connect;
    const start = engine.start({
      userId: 'user-1', sensors: [SensorType.Ecg],
      configuration: { deviceName: 'Simulated Patch', firmwareVersion: null, protocolVersion: 1,
        channels: [{ sensorType: SensorType.Ecg, sampleRateHz: 70 }] },
      deviceId: transport.identity().deviceId, newId,
    });
    await flushMicrotasks(20);
    await start;
    await advance(15_000);
    expect(engine.snapshot().fall).toBeNull();
  });
});

describe('fall detection whenever the sensor streams', () => {
  const PREVIEW_ID = '22222222-3333-4444-8555-666666666666';
  async function previewEngine(sensors: SensorType[]) {
    const transport = new SimulatedSensorTransport({ seed: 1, packetIntervalMs: 200 });
    const store = new MemorySessionStore();
    const engine = new RecordingEngine(transport, store);
    const connect = transport.connect();
    await advance(200);
    await connect;
    const p = engine.startPreview(PREVIEW_ID, sensors);
    await flushMicrotasks(20);
    await p;
    return { store, engine };
  }

  test('a fall during live preview (nothing recording) raises the alarm, tied to no session', async () => {
    const { store, engine } = await previewEngine([SensorType.Accelerometer, SensorType.Ecg]);
    await advance(15_000);
    const fall = engine.snapshot().fall;
    expect(fall).not.toBeNull();
    expect(fall!.sessionId).toBeNull();
    expect(Date.parse(fall!.atIso)).not.toBeNaN();
    expect(store.sessions.size).toBe(0);
    engine.dispose();
  });

  test('recording ECG only still catches a fall from the streamed accelerometer, and ties it to the recording', async () => {
    const { engine } = await previewEngine([SensorType.Accelerometer, SensorType.Ecg]);
    const start = engine.start({
      userId: 'user-1', sensors: [SensorType.Ecg],
      configuration: { deviceName: 'Simulated Patch', firmwareVersion: null, protocolVersion: 1,
        channels: [{ sensorType: SensorType.Ecg, sampleRateHz: 250 }] },
      deviceId: 'dev', newId,
    });
    await flushMicrotasks(20);
    await start;
    await advance(15_000);
    const fall = engine.snapshot().fall;
    expect(fall).not.toBeNull();
    expect(fall!.sessionId).toBe(engine.snapshot().sessionId);
    expect(fall!.atMs).toBeGreaterThan(0);
    await engine.stop();
    engine.dispose();
  });
});
