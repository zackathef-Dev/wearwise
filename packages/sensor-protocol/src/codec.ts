import { crc32 } from './crc32.ts';
import {
  PROTOCOL_VERSION, SensorType, SampleEncoding, SAMPLE_SCALE, SENSOR_CODES,
  HEADER_BYTES, CHECKSUM_BYTES, MAX_SAMPLES_PER_PACKET, MAX_PACKET_BYTES,
  DecodeError, type SensorPacket, type SensorPacketInput,
} from './types.ts';

/* Byte layout, protocol v1. All multi-byte integers LITTLE-ENDIAN (the ESP32 is
 * little-endian; choosing its native order means the firmware can memcpy a
 * struct).
 *
 *   offset  size  field
 *        0     2  magic           'W' 'W'  (0x57 0x57)
 *        2     1  protocolVersion 1
 *        3     1  sensorType      SensorType
 *        4     1  encoding        SampleEncoding
 *        5     1  flags           FLAG_*
 *        6    16  deviceId        UUID, raw bytes
 *       22     4  bootId          u32
 *       26    16  sessionId       UUID, raw bytes
 *       42     4  sequenceNumber  u32
 *       46     8  deviceTimestamp u64, microseconds since boot
 *       54     2  sampleRateHz    u16
 *       56     2  sampleCount     u16  (1..MAX_SAMPLES_PER_PACKET)
 *       58   2*n  samples         int16 LE × sampleCount
 *   58+2n     4  checksum        CRC-32 of bytes [0, 58+2n)
 *
 * Header is 58 bytes; a full 200-sample packet is 462 bytes.
 */

const MAGIC0 = 0x57, MAGIC1 = 0x57;

/* ---------- UUID <-> 16 bytes ---------- */
const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidToBytes(uuid: string): Uint8Array {
  if (!HEX.test(uuid)) throw new Error(`not a UUID: ${uuid}`);
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToUuid(b: Uint8Array, offset = 0): string {
  const h: string[] = [];
  for (let i = 0; i < 16; i++) h.push(b[offset + i]!.toString(16).padStart(2, '0'));
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/* ---------- encode ---------- */
export function encodePacket(input: SensorPacketInput): Uint8Array {
  const n = input.samples.length;
  if (n < 1 || n > MAX_SAMPLES_PER_PACKET) {
    throw new RangeError(`sampleCount ${n} outside 1..${MAX_SAMPLES_PER_PACKET}`);
  }
  const scale = SAMPLE_SCALE[input.sensorType];
  if (!scale) throw new RangeError(`unknown sensor type ${input.sensorType}`);

  const total = HEADER_BYTES + n * 2 + CHECKSUM_BYTES;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);

  buf[0] = MAGIC0; buf[1] = MAGIC1;
  buf[2] = PROTOCOL_VERSION;
  buf[3] = input.sensorType;
  buf[4] = SampleEncoding.Int16LE;
  buf[5] = input.flags ?? 0;
  buf.set(uuidToBytes(input.deviceId), 6);
  dv.setUint32(22, input.bootId >>> 0, true);
  buf.set(uuidToBytes(input.sessionId), 26);
  dv.setUint32(42, input.sequenceNumber >>> 0, true);
  dv.setBigUint64(46, BigInt.asUintN(64, input.deviceTimestampUs), true);
  dv.setUint16(54, input.sampleRateHz, true);
  dv.setUint16(56, n, true);

  /* Quantize to the wire scale. Values beyond int16 clamp rather than wrap — a
     wrapped ECG spike would invert, which is worse than a flat top. */
  for (let i = 0; i < n; i++) {
    const q = Math.round(input.samples[i]! / scale.scale);
    dv.setInt16(HEADER_BYTES + i * 2, Math.max(-32768, Math.min(32767, q)), true);
  }

  dv.setUint32(total - CHECKSUM_BYTES, crc32(buf, 0, total - CHECKSUM_BYTES), true);
  return buf;
}

/* ---------- decode ---------- */
export function decodePacket(bytes: Uint8Array): SensorPacket {
  if (bytes.length < HEADER_BYTES + 2 + CHECKSUM_BYTES) throw new DecodeError('too-short', `${bytes.length} bytes`);
  if (bytes.length > MAX_PACKET_BYTES) throw new DecodeError('too-long', `${bytes.length} bytes`);
  if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) throw new DecodeError('bad-magic');

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[2]!;
  if (version !== PROTOCOL_VERSION) throw new DecodeError('unsupported-version', `got ${version}`);

  const sensorType = bytes[3] as SensorType;
  if (!(sensorType in SENSOR_CODES)) throw new DecodeError('unknown-sensor', `code ${sensorType}`);

  const encoding = bytes[4] as SampleEncoding;
  if (encoding !== SampleEncoding.Int16LE) throw new DecodeError('unknown-encoding', `code ${encoding}`);

  const sampleCount = dv.getUint16(56, true);
  if (sampleCount < 1 || sampleCount > MAX_SAMPLES_PER_PACKET) {
    throw new DecodeError('sample-count-out-of-range', `${sampleCount}`);
  }
  const expected = HEADER_BYTES + sampleCount * 2 + CHECKSUM_BYTES;
  if (bytes.length !== expected) throw new DecodeError('length-mismatch', `have ${bytes.length}, header says ${expected}`);

  /* Checksum LAST among structural checks, but before trusting any payload: a
     corrupted length would already have failed above, so the CRC covers exactly
     the bytes the header claims. */
  const claimed = dv.getUint32(expected - CHECKSUM_BYTES, true);
  const actual = crc32(bytes, 0, expected - CHECKSUM_BYTES);
  if (claimed !== actual) throw new DecodeError('bad-checksum', `claimed ${claimed.toString(16)}, computed ${actual.toString(16)}`);

  const scale = SAMPLE_SCALE[sensorType].scale;
  const samples = new Array<number>(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = dv.getInt16(HEADER_BYTES + i * 2, true) * scale;
  }

  return {
    protocolVersion: version,
    deviceId: bytesToUuid(bytes, 6),
    bootId: dv.getUint32(22, true),
    sessionId: bytesToUuid(bytes, 26),
    sensorType,
    sequenceNumber: dv.getUint32(42, true),
    deviceTimestampUs: dv.getBigUint64(46, true),
    sampleRateHz: dv.getUint16(54, true),
    encoding,
    flags: bytes[5]!,
    samples,
  };
}

/* Cheap pre-check for stream framing: does this buffer START a plausible packet,
   and how long would it be? Lets a WebSocket/BLE reassembler size its read
   without decoding. Returns null if the first bytes cannot be a v1 header. */
export function peekPacketLength(bytes: Uint8Array): number | null {
  if (bytes.length < HEADER_BYTES) return null;
  if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1 || bytes[2] !== PROTOCOL_VERSION) return null;
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(56, true);
  if (n < 1 || n > MAX_SAMPLES_PER_PACKET) return null;
  return HEADER_BYTES + n * 2 + CHECKSUM_BYTES;
}
