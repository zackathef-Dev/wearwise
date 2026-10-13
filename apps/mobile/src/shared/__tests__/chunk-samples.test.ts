import { channelSamples, type ChunkBytes } from '../chunk-samples';

/* int16 little-endian chunks holding 0, 1, 2, … so values equal their index. */
function chunksOf(sizes: number[]): ChunkBytes[] {
  let n = 0;
  return sizes.map((size) => {
    const payload = new Uint8Array(size * 2);
    const dv = new DataView(payload.buffer);
    for (let i = 0; i < size; i++) dv.setInt16(i * 2, n++, true);
    return { payload, sampleCount: size };
  });
}

describe('channelSamples', () => {
  const ch = channelSamples(chunksOf([5, 3, 7]), 1);

  it('knows the total length across chunks', () => {
    expect(ch.length).toBe(15);
  });

  it('reads across chunk boundaries without decoding everything', () => {
    expect(ch.strided(0, 15, 100)).toEqual(Array.from({ length: 15 }, (_, i) => i));
    expect(ch.strided(4, 9, 100)).toEqual([4, 5, 6, 7, 8]);
  });

  it('strides down to at most maxPoints', () => {
    const out = ch.strided(0, 15, 4);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out).toEqual([0, 4, 8, 12]);
  });

  it('applies the sample scale and clamps the range', () => {
    expect(channelSamples(chunksOf([4]), 0.5).strided(-10, 99, 10)).toEqual([0, 0.5, 1, 1.5]);
    expect(ch.strided(10, 10, 5)).toEqual([]);
  });

  it('handles an empty channel', () => {
    const empty = channelSamples([], 1);
    expect(empty.length).toBe(0);
    expect(empty.strided(0, 10, 5)).toEqual([]);
  });
});

describe('channelSamples with a lying sample count', () => {
  it('never reads past a chunk’s bytes', () => {
    const [c] = chunksOf([3]);
    const ch = channelSamples([{ payload: c!.payload, sampleCount: 1_000 }], 1);
    expect(ch.length).toBe(3);
    expect(() => ch.strided(0, 1_000, 100)).not.toThrow();
  });
});
