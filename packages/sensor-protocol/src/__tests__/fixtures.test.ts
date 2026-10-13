import { decodePacket, encodePacket, DecodeError, type SensorType } from '../index';
import fixtures from '../../fixtures/v1.json';

/* The fixtures are the contract with the firmware. If this test fails after a
 * codec change, the wire format changed — regenerate the fixtures ONLY if that
 * change was intended and the firmware is being updated in step.
 */

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

describe('protocol v1 fixtures', () => {
  test('file declares protocol version 1', () => {
    expect(fixtures.protocolVersion).toBe(1);
  });

  for (const c of fixtures.valid) {
    test(`decodes "${c.name}" (${c.bytes} bytes) to the recorded fields`, () => {
      const bytes = fromHex(c.hex);
      expect(bytes.length).toBe(c.bytes);
      const p = decodePacket(bytes);
      const { deviceTimestampUs, samples, ...rest } = c.expect;
      expect(p).toMatchObject(rest);
      expect(p.deviceTimestampUs.toString()).toBe(deviceTimestampUs);
      expect(p.samples).toHaveLength(samples.length);
      p.samples.forEach((v, i) => expect(v).toBeCloseTo(samples[i]!, 6));
    });

    test(`re-encoding "${c.name}" reproduces the exact bytes (deterministic codec)`, () => {
      const p = decodePacket(fromHex(c.hex));
      const again = encodePacket({
        deviceId: p.deviceId, bootId: p.bootId, sessionId: p.sessionId,
        sensorType: p.sensorType as SensorType, sequenceNumber: p.sequenceNumber,
        deviceTimestampUs: p.deviceTimestampUs, sampleRateHz: p.sampleRateHz,
        samples: p.samples, flags: p.flags,
      });
      expect(Buffer.from(again).toString('hex')).toBe(c.hex);
    });
  }

  for (const c of fixtures.invalid) {
    test(`rejects "${c.name}" with ${c.expectError}`, () => {
      let code = 'ok';
      try { decodePacket(fromHex(c.hex)); } catch (e) { code = (e as DecodeError).code; }
      expect(code).toBe(c.expectError);
    });
  }
});
