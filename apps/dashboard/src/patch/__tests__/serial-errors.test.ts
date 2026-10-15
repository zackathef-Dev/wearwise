import { describe, expect, it } from 'vitest';
import { describeSerialError, isLinkError } from '../serial-link';

describe('USB link errors', () => {
  it('treats a broken transfer as a link error worth retrying more slowly', () => {
    expect(isLinkError(new Error('Serial data stream stopped: Possible serial noise or corruption.'))).toBe(true);
    expect(isLinkError(new Error('Timed out waiting for packet header'))).toBe(true);
    expect(isLinkError(new Error('MD5 of file does not match data in flash!'))).toBe(true);
    expect(isLinkError(new Error('This board is an ESP32-S3. WearWise patches use an ESP32.'))).toBe(false);
  });

  it('says the cable is the problem when data keeps getting lost, not that the patch is silent', () => {
    expect(describeSerialError(new Error('Serial data stream stopped: Possible serial noise or corruption.'))).toMatch(/dropping data/);
    expect(describeSerialError(new Error('Failed to connect with the device'))).toMatch(/didn’t answer/);
  });
});
