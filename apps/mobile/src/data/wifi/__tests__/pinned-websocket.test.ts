/* The JS side of the pinned socket, against a stand-in for the native module (the
 * Kotlin/Swift halves do the actual TLS pinning; this checks the contract around it). */
import { PinnedWebSocket } from '../../../../modules/pinned-websocket';

type Listener = (e: Record<string, unknown>) => void;
const mockListeners: Record<string, Listener[]> = {};
const mockNative = {
  connect: jest.fn(),
  send: jest.fn(() => true),
  close: jest.fn(),
  addListener: jest.fn((event: string, l: Listener) => { (mockListeners[event] ??= []).push(l); return { remove() {} }; }),
};
const mockEmit = (event: string, body: Record<string, unknown>) => (mockListeners[event] ?? []).forEach((l) => l(body));
/* jest hoists this above the import. Only the PinnedWebSocket lookup is replaced —
   Expo's own modules still get the real expo-modules-core. */
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core');
  return { ...actual, requireOptionalNativeModule: (name: string) => (name === 'PinnedWebSocket' ? mockNative : actual.requireOptionalNativeModule(name)) };
});

const PIN = '03259ca19143fa6e8a1ae7fab91e6b666767fd6467d2f15918ac3d2068094959';
const URL_OK = 'wss://192.168.1.104:443/stream';

describe('PinnedWebSocket', () => {
  test('only ever dials an encrypted wss:// address', () => {
    expect(() => new PinnedWebSocket('ws://192.168.1.104:80/stream', PIN)).toThrow(/wss/);
  });

  test('refuses a malformed fingerprint instead of connecting unpinned', () => {
    expect(() => new PinnedWebSocket(URL_OK, 'not-a-sha256')).toThrow(/fingerprint/);
    expect(() => new PinnedWebSocket(URL_OK, '')).toThrow(/fingerprint/);
  });

  test('passes the pin to native and routes events to the right socket', () => {
    const a = new PinnedWebSocket(URL_OK, PIN);
    const b = new PinnedWebSocket(URL_OK, PIN);
    const [idA, , pinA] = mockNative.connect.mock.calls.at(-2) as unknown as [string, string, string];
    const [idB] = mockNative.connect.mock.calls.at(-1) as unknown as [string];
    expect(pinA).toBe(PIN);
    const gotA: string[] = []; const gotB: string[] = [];
    a.onmessage = (ev) => gotA.push(ev.data);
    b.onmessage = (ev) => gotB.push(ev.data);
    mockEmit('onMessage', { id: idA, data: 'AAEC' });
    mockEmit('onMessage', { id: idB, data: 'AwQF' });
    expect(gotA).toEqual(['AAEC']);
    expect(gotB).toEqual(['AwQF']);
    a.close(); b.close();
  });

  test('a certificate that does not match the pin surfaces as an error and a close', () => {
    const s = new PinnedWebSocket(URL_OK, PIN);
    const [id] = mockNative.connect.mock.calls.at(-1) as unknown as [string];
    const errors: { pinMismatch: boolean }[] = []; let closed = false;
    s.onerror = (e) => errors.push(e);
    s.onclose = () => { closed = true; };
    mockEmit('onError', { id, message: 'certificate does not match', pinMismatch: true });
    expect(errors).toEqual([{ message: 'certificate does not match', pinMismatch: true }]);
    expect(closed).toBe(true);
  });
});
