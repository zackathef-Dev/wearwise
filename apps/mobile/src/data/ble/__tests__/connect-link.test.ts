import { BleSensorTransport } from '../ble-sensor-transport';

/* jest hoists this above the import, so the transport never loads the native module. */
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn(), State: { PoweredOn: 'PoweredOn' } }));

/* A fake BLE manager: tracks the radio link the way Android does, so the test can
   catch the app cancelling its own good connection. */
function fakeManager(opts: { discoverFailures?: number } = {}) {
  let connected = false;
  let discoverFailures = opts.discoverFailures ?? 0;
  interface FakeDevice { id: string; mtu: number; discoverAllServicesAndCharacteristics: () => Promise<FakeDevice> }
  const device: FakeDevice = {
    id: 'AA:BB', mtu: 517,
    discoverAllServicesAndCharacteristics: jest.fn(async (): Promise<FakeDevice> => {
      await new Promise((r) => setTimeout(r, 50));             // discovery takes a moment
      if (discoverFailures > 0) { discoverFailures--; throw new Error('Operation was cancelled'); }
      return device;
    }),
  };
  const m = {
    connectToDevice: jest.fn(async () => { await new Promise((r) => setTimeout(r, 20)); connected = true; return device; }),
    isDeviceConnected: jest.fn(async () => connected),
    devices: jest.fn(async () => (connected ? [device] : [])),
    cancelDeviceConnection: jest.fn(async () => { connected = false; return device; }),
    isConnected: () => connected,
  };
  return m;
}

const linkOf = (t: BleSensorTransport) => (t as unknown as { connectLink(a: string): Promise<unknown> }).connectLink.bind(t);

beforeEach(() => jest.useRealTimers());

describe('BLE link establishment', () => {
  test('overlapping connect requests share ONE attempt instead of fighting', async () => {
    const m = fakeManager();
    const t = new BleSensorTransport(m as never);
    const [a, b] = await Promise.all([linkOf(t)('AA:BB'), linkOf(t)('AA:BB')]);
    expect(a).toBe(b);
    expect(m.connectToDevice).toHaveBeenCalledTimes(1);
    expect(m.cancelDeviceConnection).not.toHaveBeenCalled();
    expect(m.isConnected()).toBe(true);
  });

  test('a failed discovery is retried on the SAME link, never by cancelling it', async () => {
    const m = fakeManager({ discoverFailures: 1 });
    const t = new BleSensorTransport(m as never);
    await linkOf(t)('AA:BB');
    expect(m.cancelDeviceConnection).not.toHaveBeenCalled();
    expect(m.connectToDevice).toHaveBeenCalledTimes(1);       // second try reused the open link
    expect(m.isConnected()).toBe(true);
  });

  test('after the attempt settles, a new request starts a fresh one', async () => {
    const m = fakeManager();
    const t = new BleSensorTransport(m as never);
    await linkOf(t)('AA:BB');
    m.cancelDeviceConnection();                                // link lost
    await linkOf(t)('AA:BB');
    expect(m.connectToDevice).toHaveBeenCalledTimes(2);
  });
});
