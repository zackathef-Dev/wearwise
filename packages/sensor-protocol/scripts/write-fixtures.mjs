/* Emit the shared protocol fixtures: known packets as hex, plus the decoded
 * fields they must produce. The TypeScript tests and the ESP32 firmware tests both
 * read fixtures/v1.json, so a disagreement between phone and device shows up as a
 * failing test on whichever side is wrong — not as corrupt recordings in a study.
 *
 *   npm run fixtures     (node --experimental-transform-types scripts/write-fixtures.mjs)
 *
 * Deterministic: same inputs → byte-identical file, so a diff in git means the
 * protocol actually changed.
 */
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
/* The codec is TypeScript. Node ≥ 23.6 strips types natively; `enum` needs the
   transform flag, which is why package.json runs this with
   --experimental-transform-types. No Babel, no build step. */
import { encodePacket, decodePacket, SensorType, FLAG_SIMULATED, MAX_SAMPLES_PER_PACKET } from '../src/index.ts';

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const DEVICE = '0f2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SESSION = 'a1b2c3d4-e5f6-4a7b-8c9d-1e2f3a4b5c6d';

const cases = [];
const add = (name, input, expectError) => {
  const bytes = encodePacket(input);
  const entry = { name, hex: hex(bytes), bytes: bytes.length };
  if (!expectError) {
    const d = decodePacket(bytes);
    entry.expect = { ...d, deviceTimestampUs: d.deviceTimestampUs.toString() };
  }
  cases.push(entry);
  return bytes;
};

add('ecg-5-samples', {
  deviceId: DEVICE, bootId: 7, sessionId: SESSION, sensorType: SensorType.Ecg,
  sequenceNumber: 42, deviceTimestampUs: 1234567890n, sampleRateHz: 70,
  samples: [0, 0.125, -0.5, 1.2, -1.234], flags: FLAG_SIMULATED,
});
add('spo2-1-sample', {
  deviceId: DEVICE, bootId: 7, sessionId: SESSION, sensorType: SensorType.SpO2,
  sequenceNumber: 0, deviceTimestampUs: 0n, sampleRateHz: 25, samples: [97.84],
});
add('temp-1-sample', {
  deviceId: DEVICE, bootId: 7, sessionId: SESSION, sensorType: SensorType.Temperature,
  sequenceNumber: 1, deviceTimestampUs: 1000000n, sampleRateHz: 1, samples: [36.73],
});
add('ecg-max-200-samples', {
  deviceId: DEVICE, bootId: 1, sessionId: SESSION, sensorType: SensorType.Ecg,
  sequenceNumber: 4294967295, deviceTimestampUs: 0xffffffffffffffffn, sampleRateHz: 250,
  samples: Array.from({ length: MAX_SAMPLES_PER_PACKET }, (_, i) => Math.sin(i / 7) * 2),
});

/* Negative cases: the SAME good packet, damaged one way each. Firmware must
   reject each with the matching reason. */
const good = encodePacket({
  deviceId: DEVICE, bootId: 7, sessionId: SESSION, sensorType: SensorType.Ecg,
  sequenceNumber: 42, deviceTimestampUs: 1234567890n, sampleRateHz: 70, samples: [0, 0.125, -0.5],
});
const damaged = (mutate) => { const b = new Uint8Array(good); mutate(b); return b; };
const negatives = [
  { name: 'bad-checksum-payload', hex: hex(damaged((b) => { b[59] ^= 1; })), expectError: 'bad-checksum' },
  { name: 'bad-checksum-header', hex: hex(damaged((b) => { b[22] ^= 0x80; })), expectError: 'bad-checksum' },
  { name: 'bad-magic', hex: hex(damaged((b) => { b[0] = 0; })), expectError: 'bad-magic' },
  { name: 'unsupported-version', hex: hex(damaged((b) => { b[2] = 2; })), expectError: 'unsupported-version' },
  { name: 'unknown-sensor', hex: hex(damaged((b) => { b[3] = 99; })), expectError: 'unknown-sensor' },
  { name: 'length-mismatch-truncated', hex: hex(good.subarray(0, good.length - 3)), expectError: 'length-mismatch' },
];

const out = {
  protocolVersion: 1,
  generated: 'node scripts/write-fixtures.mjs — do not hand-edit',
  layout: 'see src/codec.ts header comment; all integers little-endian',
  valid: cases,
  invalid: negatives,
};
mkdirSync(path.resolve(import.meta.dirname, '..', 'fixtures'), { recursive: true });
const file = path.resolve(import.meta.dirname, '..', 'fixtures', 'v1.json');
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`${cases.length} valid + ${negatives.length} invalid fixtures -> fixtures/v1.json`);
