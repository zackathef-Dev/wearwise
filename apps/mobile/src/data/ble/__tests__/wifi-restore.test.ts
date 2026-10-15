import { BleSensorTransport } from '../ble-sensor-transport';
import { bytesToBase64, base64ToBytes } from '../base64';
import { WW_CHAR_WIFI, WW_CHAR_CONTROL } from '../ble-uuids';

/* jest hoists this above the imports, so the transport never loads the native module. */
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn(), State: { PoweredOn: 'PoweredOn' } }));

/* Firmware ≥ 0.9.1 keeps Wi-Fi credentials in RAM only; the phone re-sends them. */
function setup(wifiState: number, saved: { ssid: string; password: string } | null) {
  const writes: Uint8Array[] = [];
  const device = {
    id: 'AA:BB',
    readCharacteristicForService: jest.fn(async (_svc: string, chr: string) => {
      if (chr !== WW_CHAR_WIFI) throw new Error('unexpected read');
      return { value: bytesToBase64(new Uint8Array([wifiState, 0, 0, 0, 0])) };
    }),
    writeCharacteristicWithResponseForService: jest.fn(async (_svc: string, chr: string, value: string) => {
      if (chr === WW_CHAR_CONTROL) writes.push(base64ToBytes(value));
      return {};
    }),
  };
  const t = new BleSensorTransport({} as never);
  Object.assign(t as unknown as Record<string, unknown>, {
    device,
    identityCache: { deviceId: 'dev-1', displayName: 'WearWise-6280', address: 'AA:BB', transport: 'bluetooth' },
  });
  const lookups: string[] = [];
  t.setWifiCredentialSource(async (id) => { lookups.push(id); return saved; });
  return { t, writes, lookups };
}

describe('Wi-Fi restore after connect', () => {
  test('a freshly booted sensor (no network) gets the saved credentials', async () => {
    const { t, writes, lookups } = setup(0, { ssid: 'Home', password: 'pw123456' });
    await expect(t.restoreWifi()).resolves.toBe(true);
    expect(lookups).toEqual(['dev-1']);
    expect(writes).toHaveLength(1);
    const w = writes[0]!;
    expect(w[0]).toBe(0x10);                                     // PROVISION
    expect(new TextDecoder().decode(w.slice(2, 2 + w[1]!))).toBe('Home');
  });

  test.each([1, 2, 3])('a sensor already in Wi-Fi state %i is left alone', async (state) => {
    const { t, writes } = setup(state, { ssid: 'Home', password: 'pw123456' });
    await expect(t.restoreWifi()).resolves.toBe(false);
    expect(writes).toHaveLength(0);
  });

  test('nothing is sent when this phone has no saved network', async () => {
    const { t, writes } = setup(0, null);
    await expect(t.restoreWifi()).resolves.toBe(false);
    expect(writes).toHaveLength(0);
  });
});
