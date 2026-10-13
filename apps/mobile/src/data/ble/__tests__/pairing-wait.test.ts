import { BleSensorTransport } from '../ble-sensor-transport';
import { bytesToBase64 } from '../base64';
import { WW_CHAR_INFO, WW_CHAR_TLS } from '../ble-uuids';

/* jest hoists this above the imports, so the transport never loads the native module. */
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn(), State: { PoweredOn: 'PoweredOn' } }));

/* Info characteristic as firmware 0.9.0 serves it:
   deviceId[16] · bootId u32 · protoVer u8 · fwVersion cstr · pop[4]. */
function infoValue(): string {
  const id = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const fw = new TextEncoder().encode('0.9.0\0');
  const bytes = new Uint8Array([...id, 0x1c, 0x82, 0xf7, 0x70, 1, ...fw, 0xaa, 0xbb, 0xcc, 0xdd]);
  return bytesToBase64(bytes);
}

/* A device whose secured reads fail `failures` times (the phone is showing its pairing
   dialog) and then succeed once the passkey has been typed. */
function fakeDevice(failures: number) {
  let left = failures;
  return {
    id: 'AA:BB', name: 'WearWise-6280',
    readCharacteristicForService: jest.fn(async (_svc: string, chr: string) => {
      if (left > 0) { left--; throw new Error('GATT insufficient authentication'); }
      if (chr === WW_CHAR_INFO) return { value: infoValue() };
      if (chr === WW_CHAR_TLS) return { value: bytesToBase64(new Uint8Array(32).fill(0xab)) };
      throw new Error('unexpected characteristic');
    }),
  };
}

const fallback = { deviceId: 'x', displayName: 'WearWise-6280', address: 'AA:BB', transport: 'bluetooth' as const };
const secured = (t: BleSensorTransport) =>
  (t as unknown as { readIdentitySecured(d: unknown, f: unknown): Promise<{ deviceId: string }> }).readIdentitySecured.bind(t);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function settle(p: Promise<unknown>) {
  for (let i = 0; i < 40; i++) { jest.advanceTimersByTime(1500); for (let k = 0; k < 6; k++) await Promise.resolve(); }
  return p;
}

describe('pairing wait', () => {
  test('waits through the OS pairing dialog, then reads identity and pin', async () => {
    const t = new BleSensorTransport({ isDeviceConnected: async () => true } as never);
    const prompts: boolean[] = [];
    t.onPairing((w) => prompts.push(w));
    const id = await settle(secured(t)(fakeDevice(3), fallback));
    expect((id as { deviceId: string }).deviceId).toBe('01020304-0506-0708-090a-0b0c0d0e0f10');
    expect(prompts).toEqual([true, false]);                     // prompt shown, then cleared
    expect(t.popTokenHex()).toBe('aabbccdd');
    expect(t.tlsFingerprintHex()).toBe('ab'.repeat(32));
  });

  test('a bonded phone never sees the prompt', async () => {
    const t = new BleSensorTransport({ isDeviceConnected: async () => true } as never);
    const prompts: boolean[] = [];
    t.onPairing((w) => prompts.push(w));
    await settle(secured(t)(fakeDevice(0), fallback));
    expect(prompts).toEqual([]);
  });

  test('a sensor that refuses pairing says, step by step, to press BOOT', async () => {
    const t = new BleSensorTransport({ isDeviceConnected: async () => false } as never);
    const p = secured(t)(fakeDevice(5), fallback);
    await expect(settle(p)).rejects.toThrow(/Press the BOOT button on the patch/);
  });

  test('gives up after the pairing window with a clear message', async () => {
    const t = new BleSensorTransport({ isDeviceConnected: async () => true } as never);
    const p = secured(t)(fakeDevice(1000), fallback);
    p.catch(() => {});
    for (let i = 0; i < 50; i++) { jest.advanceTimersByTime(1500); for (let k = 0; k < 6; k++) await Promise.resolve(); }
    await expect(p).rejects.toThrow(/6-digit pairing code/);
  });
});
