import { crc32 } from '@wearwise/sensor-protocol';
import { packChannelChunks, unpackChannelChunks, ContainerError } from '../chunk-container';
import type { SampleChunk } from '@/domain/entities/session';

function chunk(n: number, payload: number[]): SampleChunk {
  const p = new Uint8Array(payload);
  return {
    id: `c-${n}`, sessionId: 's', channelId: 'ch', chunkNumber: n,
    firstSequence: n * 10, lastSequence: n * 10 + 4,
    startedAtUs: BigInt(n) * 1_000_000n, endedAtUs: BigInt(n) * 1_000_000n + 999_999n,
    sampleCount: payload.length / 2, encoding: 'int16le-v1', payload: p, checksum: crc32(p),
    createdAt: '2026-08-26T00:00:00Z',
  };
}

describe('chunk container', () => {
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

  test('rejects a chunk whose sample count disagrees with its payload', () => {
    const c = chunk(0, [1, 2, 3, 4]);
    c.sampleCount = 1000; // the CRC covers only the payload, so it would still pass
    expect(() => unpackChannelChunks(packChannelChunks([c]))).toThrow(/sample count/);
  });
});
