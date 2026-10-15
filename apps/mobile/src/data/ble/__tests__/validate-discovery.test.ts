import { parseCapabilities, validateInfo } from '../validate-discovery';

test('rejects short and unsupported device info instead of trusting the advertised name', () => {
  expect(() => validateInfo(new Uint8Array(10))).toThrow();
  const bytes = new Uint8Array(27); bytes[0] = 1; bytes[20] = 1;
  expect(() => validateInfo(bytes)).not.toThrow();
  bytes[20] = 2;
  expect(() => validateInfo(bytes)).toThrow();
});
test('validates capability framing, sensor codes, duplicates, flags, and rates', () => {
  expect(parseCapabilities(new Uint8Array([1, 1, 250, 0]))[0]?.sampleRateHz).toBe(250);
  for (const data of [[1], [99, 1, 1, 0], [1, 2, 1, 0], [1, 1, 0, 0], [1, 1, 1, 0, 1, 1, 1, 0]]) {
    expect(() => parseCapabilities(new Uint8Array(data))).toThrow();
  }
});
test('accepts a patch that reports no sensors (nothing fitted), so the app can say so plainly', () => {
  expect(parseCapabilities(new Uint8Array(0))).toEqual([]);
});
