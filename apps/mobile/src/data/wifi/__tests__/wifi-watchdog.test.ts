import { encodePacket, SensorType } from '@wearwise/sensor-protocol';
import { WifiSensorTransport } from '../wifi-sensor-transport';

/* A WebSocket whose far end can go silent without ever closing — exactly what the
   phone sees when the patch loses power mid-stream. */
class SilentSocket {
  static last: SilentSocket | null = null;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { SilentSocket.last = this; setTimeout(() => this.onopen?.(), 10); }
  send() {}
  close() { this.closed = true; }        // a half-open socket: close() never fires onclose
  push() {
    const bytes = encodePacket({
      deviceId: '69f69fe5-9cbb-4b3a-b002-db827b7e129d', bootId: 1, sessionId: '00000000-0000-4000-8000-000000000001',
      sensorType: SensorType.Temperature, sequenceNumber: 0, deviceTimestampUs: 0n, sampleRateHz: 2, samples: [30], flags: 0,
    });
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }
}

const target = {
  url: 'ws://192.168.1.104:80/stream', pop: 'aabbccdd',
  identity: { deviceId: 'board-1', displayName: 'WearWise-6280', address: 'ble', transport: 'bluetooth' as const },
  capabilities: [],
};

let realWs: unknown;
beforeEach(() => { jest.useFakeTimers(); realWs = globalThis.WebSocket; (globalThis as { WebSocket: unknown }).WebSocket = SilentSocket; });
afterEach(() => { jest.useRealTimers(); (globalThis as { WebSocket: unknown }).WebSocket = realWs; });

async function open(t: WifiSensorTransport) {
  const p = t.connect();
  jest.advanceTimersByTime(20);
  await p;
}

describe('Wi-Fi liveness watchdog', () => {
  test('a link that keeps delivering packets stays connected', async () => {
    const t = new WifiSensorTransport(target);
    const states: string[] = [];
    t.onConnectionState((s) => states.push(s));
    await open(t);
    for (let i = 0; i < 50; i++) { SilentSocket.last!.push(); jest.advanceTimersByTime(200); }   // 10 s of data
    expect(states.at(-1)).toBe('connected_wifi');
    await t.disconnect();
  });

  test('a link that goes silent is declared dead within ~3 s, even though the socket never closes', async () => {
    const t = new WifiSensorTransport(target);
    const states: string[] = [];
    t.onConnectionState((s) => states.push(s));
    await open(t);
    for (let i = 0; i < 10; i++) { SilentSocket.last!.push(); jest.advanceTimersByTime(200); }
    jest.advanceTimersByTime(2500);
    expect(states.at(-1)).toBe('connected_wifi');            // not yet: a brief hiccup is fine
    jest.advanceTimersByTime(1500);
    expect(states.at(-1)).toBe('reconnecting');              // patch lost power → fall back
    expect(SilentSocket.last!.closed).toBe(true);
  });

  test('a link that never delivers its first packet is dropped after the start-up grace', async () => {
    const t = new WifiSensorTransport(target);
    const states: string[] = [];
    t.onConnectionState((s) => states.push(s));
    await open(t);
    jest.advanceTimersByTime(5000);
    expect(states.at(-1)).toBe('connected_wifi');
    jest.advanceTimersByTime(2000);
    expect(states.at(-1)).toBe('reconnecting');
  });
});
