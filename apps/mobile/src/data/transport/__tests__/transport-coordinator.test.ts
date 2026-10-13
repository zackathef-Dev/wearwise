import { TransportCoordinator } from '../transport-coordinator';
import type { WifiTarget } from '@/data/wifi/wifi-sensor-transport';

/* A stand-in for the WebSocket transport: records every instance so a test can see
   which URL was dialled and can drop a live link the way a router restart does. */
const mockInstances: MockWifi[] = [];
let mockFailConnects = 0;
class MockWifi {
  readonly type = 'wifi' as const;
  private stateListener: ((s: string) => void) | null = null;
  constructor(public target: WifiTarget) { mockInstances.push(this); }
  async connect() { if (mockFailConnects > 0) { mockFailConnects--; throw new Error('unreachable'); } }
  async disconnect() {}
  onConnectionState(l: (s: string) => void) { this.stateListener = l; return () => { this.stateListener = null; }; }
  onPacket() { return () => {}; }
  drop() { this.stateListener?.('disconnected'); }
}
jest.mock('@/data/wifi/wifi-sensor-transport', () => ({ WifiSensorTransport: jest.fn((t: WifiTarget) => new MockWifi(t)) }));

const target: WifiTarget = {
  url: 'ws://192.168.1.112:80/stream', pop: 'aabbccdd',
  identity: { deviceId: 'board-1', displayName: 'WearWise-6280', address: 'ble', transport: 'bluetooth' },
  capabilities: [],
};

function setup() {
  const engine = { attachTransport: jest.fn() };
  /* The patch's Wi-Fi as Bluetooth reports it: 0 idle · 2 connected (with an IP). */
  const wifiStatus = { state: 0, ip: null as string | null };
  const ble = { readWifiStatus: jest.fn(async () => ({ ...wifiStatus })), popTokenHex: () => 'aabbccdd', tlsFingerprintHex: () => 'ab'.repeat(32) };
  const changes: [string, string | null][] = [];
  const c = new TransportCoordinator({
    engine: engine as never, ble: ble as never,
    onChange: (active, wifi) => changes.push([active, wifi]),
  });
  return { c, engine, ble, wifiStatus, changes };
}

async function tick(ms: number) {
  for (let t = 0; t < ms; t += 500) { jest.advanceTimersByTime(500); for (let i = 0; i < 6; i++) await Promise.resolve(); }
}

beforeEach(() => { jest.useFakeTimers(); mockInstances.length = 0; mockFailConnects = 0; });
afterEach(() => { jest.useRealTimers(); });

describe('TransportCoordinator Wi-Fi recovery', () => {
  test('after Wi-Fi drops it falls back to Bluetooth, then switches back on its own when Wi-Fi returns', async () => {
    const { c, engine, wifiStatus, changes } = setup();
    expect(await c.preferWifi(target)).toBe(true);
    expect(c.activeTransport()).toBe('wifi');

    mockInstances[0]!.drop();                                  // router switched off
    expect(c.activeTransport()).toBe('bluetooth');
    expect(changes.at(-1)).toEqual(['bluetooth', 'reconnecting']);

    await tick(20_000);                                    // patch still offline: keeps checking, no redial
    expect(mockInstances).toHaveLength(1);

    wifiStatus.state = 2; wifiStatus.ip = '192.168.1.140'; // router back; DHCP gave a new address
    await tick(16_000);
    expect(c.activeTransport()).toBe('wifi');
    expect(mockInstances.at(-1)!.target.url).toBe('wss://192.168.1.140:443/stream');
    expect(mockInstances.at(-1)!.target.pin).toBe('ab'.repeat(32));        // re-read pin, encrypted link
    expect(changes.at(-1)).toEqual(['wifi', 'connected_wifi']);
    expect(engine.attachTransport).toHaveBeenLastCalledWith(mockInstances.at(-1));
    await c.dispose();
  });

  test('a failed redial keeps Bluetooth and tries again later', async () => {
    const { c, wifiStatus } = setup();
    await c.preferWifi(target);
    mockInstances[0]!.drop();
    wifiStatus.state = 2; wifiStatus.ip = '192.168.1.112';
    mockFailConnects = 1;                                      // first redial fails
    await tick(4_000);
    expect(c.activeTransport()).toBe('bluetooth');
    await tick(8_000);                                     // next attempt succeeds
    expect(c.activeTransport()).toBe('wifi');
    await c.dispose();
  });

  test('no retries after the coordinator is disposed (recording stopped)', async () => {
    const { c, ble } = setup();
    await c.preferWifi(target);
    mockInstances[0]!.drop();
    await c.dispose();
    ble.readWifiStatus.mockClear();
    await tick(60_000);
    expect(ble.readWifiStatus).not.toHaveBeenCalled();
  });

  test('ending a session hands the engine back to Bluetooth and stops all Wi-Fi retries', async () => {
    const { c, engine, ble } = setup();
    await c.preferWifi(target);
    mockInstances[0]!.drop();                                  // a retry is now scheduled
    await c.release();
    expect(c.activeTransport()).toBe('bluetooth');
    ble.readWifiStatus.mockClear();
    await tick(60_000);
    expect(ble.readWifiStatus).not.toHaveBeenCalled();         // no zombie reconnects after stop
    // engine got Bluetooth back so the next session's START goes over BLE
    await c.preferWifi(target);
    await c.release();
    expect(engine.attachTransport).toHaveBeenLastCalledWith(ble);
  });
});
