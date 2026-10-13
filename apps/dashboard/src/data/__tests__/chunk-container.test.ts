import { describe, expect, test } from 'vitest';
import { ContainerError, unpackChannelChunks } from '../chunk-container';
import { chunk, packChannelChunks } from './pack';

/* Mirrors apps/mobile/src/data/sync/__tests__/chunk-container.test.ts, case for
   case, against the dashboard's copy of the decoder. */

const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));

describe('chunk container (decoder)', () => {
  test('round-trips chunks byte-for-byte, preserving boundaries and timestamps', () => {
    const chunks = [chunk(0, [0, 0, 125, 0]), chunk(1, [200, 4, 44, 251]), chunk(2, [1, 128, 255, 127])];
    const back = unpackChannelChunks(packChannelChunks(chunks));
    expect(back).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(back[i]!.chunkNumber).toBe(chunks[i]!.chunkNumber);
      expect(back[i]!.firstSequence).toBe(chunks[i]!.firstSequence);
      expect(back[i]!.lastSequence).toBe(chunks[i]!.lastSequence);
      expect(back[i]!.startedAtUs).toBe(chunks[i]!.startedAtUs);
      expect(back[i]!.endedAtUs).toBe(chunks[i]!.endedAtUs);
      expect(Array.from(back[i]!.payload)).toEqual(Array.from(chunks[i]!.payload));
    }
  });

  test('sorts by chunkNumber regardless of input order', () => {
    const back = unpackChannelChunks(packChannelChunks([chunk(2, [1, 0]), chunk(0, [2, 0]), chunk(1, [3, 0])]));
    expect(back.map((c) => c.chunkNumber)).toEqual([0, 1, 2]);
  });

  test('empty channel packs and unpacks to nothing', () => {
    expect(unpackChannelChunks(packChannelChunks([]))).toEqual([]);
  });

  test('preserves a large u64 timestamp exactly (no i64 clip)', () => {
    const c = chunk(0, [1, 2]);
    c.startedAtUs = 18446744073709551615n; // u64 max
    const [back] = unpackChannelChunks(packChannelChunks([c]));
    expect(back!.startedAtUs).toBe(18446744073709551615n);
  });

  test('a corrupted payload fails the CRC check on unpack', () => {
    const bytes = packChannelChunks([chunk(0, [10, 20, 30, 40])]);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff; // flip a payload byte
    expect(() => unpackChannelChunks(bytes)).toThrow(ContainerError);
  });

  test('rejects a bad magic', () => {
    const bytes = packChannelChunks([chunk(0, [1, 2])]);
    bytes[0] = 0;
    expect(() => unpackChannelChunks(bytes)).toThrow(/magic/);
  });

  /* Dashboard-specific: the decoder must read exactly what the PHONE writes. These
     bytes were produced by the mobile app's own packChannelChunks (2026-10-13) from
     the three fixture chunks above; if the phone's layout changes, this fails. */
  test('decodes bytes produced by the phone app’s packer', () => {
    const golden = fromHex(
      '575743480100000003000000' +
      '00000000000000000400000000000000000000003f420f000000000002000000a7d8d5bb04000000' + '00007d00' +
      '010000000a0000000e00000040420f00000000007f841e00000000000200000013f1ea8604000000' + 'c8042cfb' +
      '02000000140000001800000080841e0000000000bfc62d0000000000020000002632532b04000000' + '0180ff7f',
    );
    const expected = [chunk(0, [0, 0, 125, 0]), chunk(1, [200, 4, 44, 251]), chunk(2, [1, 128, 255, 127])];
    expect(Array.from(packChannelChunks(expected))).toEqual(Array.from(golden));
    const back = unpackChannelChunks(golden);
    expect(back.map((c) => [c.chunkNumber, c.startedAtUs, c.endedAtUs, c.sampleCount, Array.from(c.payload)])).toEqual(
      expected.map((c) => [c.chunkNumber, c.startedAtUs, c.endedAtUs, c.sampleCount, Array.from(c.payload)]),
    );
  });

  test('rejects truncated containers and unknown versions', () => {
    const bytes = packChannelChunks([chunk(0, [1, 2, 3, 4])]);
    expect(() => unpackChannelChunks(bytes.subarray(0, bytes.length - 1))).toThrow(/truncated chunk payload/);
    expect(() => unpackChannelChunks(bytes.subarray(0, 20))).toThrow(/truncated chunk header/);
    expect(() => unpackChannelChunks(bytes.subarray(0, 8))).toThrow(/too short/);
    const v2 = bytes.slice();
    v2[4] = 2;
    expect(() => unpackChannelChunks(v2)).toThrow(/version 2/);
  });

  test('decodes a container that sits at an odd offset inside a larger buffer', () => {
    const bytes = packChannelChunks([chunk(0, [1, 2, 3, 4]), chunk(1, [5, 6])]);
    const host = new Uint8Array(bytes.length + 1);
    host.set(bytes, 1);
    const back = unpackChannelChunks(host.subarray(1));
    expect(back.map((c) => Array.from(c.payload))).toEqual([[1, 2, 3, 4], [5, 6]]);
  });
});
