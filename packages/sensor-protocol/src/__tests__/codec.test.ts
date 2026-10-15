import {
  encodePacket, decodePacket, peekPacketLength, crc32, uuidToBytes, bytesToUuid,
  SensorType, SampleEncoding, PROTOCOL_VERSION, FLAG_SIMULATED,
  HEADER_BYTES, MAX_SAMPLES_PER_PACKET, MAX_PACKET_BYTES, DecodeError,
} from '../index';

const DEVICE = '0f2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SESSION = 'a1b2c3d4-e5f6-4a7b-8c9d-1e2f3a4b5c6d';

const base = {
  deviceId: DEVICE, bootId: 7, sessionId: SESSION, sensorType: SensorType.Ecg,
  sequenceNumber: 42, deviceTimestampUs: 1_234_567_890n, sampleRateHz: 70,
  samples: [0.0, 0.125, -0.5, 1.2, -1.234], flags: FLAG_SIMULATED,
};

describe('crc32', () => {
  test('matches the IEEE reference vector', () => {
    /* "123456789" → 0xCBF43926 is the canonical check value for CRC-32/IEEE. */
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  test('empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('uuid bytes', () => {
  test('round-trips', () => {
    expect(bytesToUuid(uuidToBytes(DEVICE))).toBe(DEVICE);
  });
  test('rejects a non-UUID', () => {
    expect(() => uuidToBytes('not-a-uuid')).toThrow();
  });
});

describe('encode / decode', () => {
  test('round-trips every header field', () => {
    const bytes = encodePacket(base);
    const p = decodePacket(bytes);
    expect(p.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(p.deviceId).toBe(DEVICE);
    expect(p.bootId).toBe(7);
    expect(p.sessionId).toBe(SESSION);
    expect(p.sensorType).toBe(SensorType.Ecg);
    expect(p.sequenceNumber).toBe(42);
    expect(p.deviceTimestampUs).toBe(1_234_567_890n);
    expect(p.sampleRateHz).toBe(70);
    expect(p.encoding).toBe(SampleEncoding.Int16LE);
    expect(p.flags & FLAG_SIMULATED).toBe(FLAG_SIMULATED);
  });

  test('samples survive quantisation to the sensor scale (ECG: 1 µV)', () => {
    const p = decodePacket(encodePacket(base));
    expect(p.samples).toHaveLength(5);
    p.samples.forEach((v, i) => expect(Math.abs(v - base.samples[i]!)).toBeLessThan(0.001));
  });

  test('SpO₂ and temperature use their own scales', () => {
    const spo2 = decodePacket(encodePacket({ ...base, sensorType: SensorType.SpO2, samples: [97.84] }));
    expect(spo2.samples[0]).toBeCloseTo(97.84, 2);
    const temp = decodePacket(encodePacket({ ...base, sensorType: SensorType.Temperature, samples: [36.73] }));
    expect(temp.samples[0]).toBeCloseTo(36.73, 2);
  });

  test('out-of-range samples clamp rather than wrap', () => {
    const p = decodePacket(encodePacket({ ...base, samples: [100, -100] })); // ±100 mV, beyond int16 at 1 µV
    expect(p.samples[0]).toBeCloseTo(32.767, 3);
    expect(p.samples[1]).toBeCloseTo(-32.768, 3);
  });

  test('packet length is header + 2n + checksum, and the max is 462', () => {
    expect(encodePacket(base).length).toBe(HEADER_BYTES + 5 * 2 + 4);
    const full = encodePacket({ ...base, samples: new Array(MAX_SAMPLES_PER_PACKET).fill(0) });
    expect(full.length).toBe(MAX_PACKET_BYTES);
    expect(MAX_PACKET_BYTES).toBe(462);
  });

  test('64-bit timestamps beyond 2^53 are preserved exactly', () => {
    const big = 0x1234_5678_9abc_def0n;
    expect(decodePacket(encodePacket({ ...base, deviceTimestampUs: big })).deviceTimestampUs).toBe(big);
  });

  test('peekPacketLength sizes a frame from its header alone', () => {
    const bytes = encodePacket(base);
    expect(peekPacketLength(bytes.subarray(0, HEADER_BYTES))).toBe(bytes.length);
    expect(peekPacketLength(new Uint8Array(10))).toBeNull();
  });
});

describe('decode rejects', () => {
  const good = () => encodePacket(base);
  const code = (bytes: Uint8Array) => {
    try { decodePacket(bytes); return 'ok'; } catch (e) { return (e as DecodeError).code; }
  };

  test('a flipped payload bit → bad-checksum', () => {
    const b = good(); b[HEADER_BYTES + 1]! ^= 0x01;
    expect(code(b)).toBe('bad-checksum');
  });
  test('a flipped header bit → bad-checksum', () => {
    const b = good(); b[22]! ^= 0x80; // bootId
    expect(code(b)).toBe('bad-checksum');
  });
  test('wrong magic', () => {
    const b = good(); b[0] = 0x00;
    expect(code(b)).toBe('bad-magic');
  });
  test('future protocol version', () => {
    const b = good(); b[2] = 2;
    expect(code(b)).toBe('unsupported-version');
  });
  test('unknown sensor code', () => {
    const b = good(); b[3] = 99;
    expect(code(b)).toBe('unknown-sensor');
  });
  test('truncated packet → length-mismatch', () => {
    expect(code(good().subarray(0, 66))).toBe('length-mismatch');
  });
  test('too short to be any packet', () => {
    expect(code(new Uint8Array(20))).toBe('too-short');
  });
  test('oversized buffer', () => {
    expect(code(new Uint8Array(MAX_PACKET_BYTES + 1))).toBe('too-long');
  });
  test('encoder refuses zero samples and too many', () => {
    expect(() => encodePacket({ ...base, samples: [] })).toThrow(RangeError);
    expect(() => encodePacket({ ...base, samples: new Array(201).fill(0) })).toThrow(RangeError);
  });
});
