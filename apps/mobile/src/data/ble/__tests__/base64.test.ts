import { base64ToBytes, bytesToBase64 } from '../base64';
import { encodePacket, decodePacket, SensorType, FLAG_SIMULATED } from '@wearwise/sensor-protocol';

/* The BLE transport carries every packet as base64 (ble-plx's value format), so
 * these converters sit directly on the data path. A byte wrong here is a decode
 * error the phone would blame on the radio. */

describe('base64 <-> bytes', () => {
  test('round-trips arbitrary byte values including 0 and 255', () => {
    for (let len = 0; len < 300; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      const b64 = bytesToBase64(bytes);
      expect(base64ToBytes(b64)).toEqual(bytes);
    }
  });

  test('matches known vectors', () => {
    expect(bytesToBase64(new Uint8Array([0x57, 0x57]))).toBe('V1c=');
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
    expect(Array.from(base64ToBytes('AQID'))).toEqual([1, 2, 3]);
  });

  test('a real protocol packet survives encode → base64 → decode', () => {
    const bytes = encodePacket({
      deviceId: '69f69fe5-9cbb-4b3a-b002-db827b7e129d',
      bootId: 0x79652df1,
      sessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-1e2f3a4b5c6d',
      sensorType: SensorType.Ecg,
      sequenceNumber: 5,
      deviceTimestampUs: 123456n,
      sampleRateHz: 70,
      samples: [0, 0.125, -0.5, 1.2, -1.234],
      flags: FLAG_SIMULATED,
    });
    const decoded = decodePacket(base64ToBytes(bytesToBase64(bytes)));
    expect(decoded.deviceId).toBe('69f69fe5-9cbb-4b3a-b002-db827b7e129d');
    expect(decoded.sequenceNumber).toBe(5);
    expect(decoded.samples).toHaveLength(5);
    expect(decoded.flags & FLAG_SIMULATED).toBe(FLAG_SIMULATED);
  });
});
