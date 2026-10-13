/* Random access into a recorded channel without decoding it.
 *
 * A session's samples are stored as int16 chunks. A chart never draws more than a
 * few hundred points, so instead of decoding every sample (a two-hour ECG is ~1.8 M
 * of them — seconds of JS-thread work) this keeps the raw bytes and reads only the
 * samples a view needs. Opening, zooming and panning cost the same for a five-
 * minute or a five-hour recording.
 */

export interface ChunkBytes { payload: Uint8Array; sampleCount: number }

export interface ChannelSamples {
  readonly length: number;
  /** Up to maxPoints samples, evenly strided, from [from, to) in sample indices. */
  strided(from: number, to: number, maxPoints: number): number[];
}

export function channelSamples(chunks: readonly ChunkBytes[], scale: number): ChannelSamples {
  const views = chunks.map((c) => new DataView(c.payload.buffer, c.payload.byteOffset, c.payload.byteLength));
  /* starts[k] = index of chunk k's first sample */
  const starts: number[] = [];
  let total = 0;
  /* Never past a chunk's bytes, whatever its stored count says. */
  for (const c of chunks) { starts.push(total); total += Math.max(0, Math.min(c.sampleCount, c.payload.byteLength >> 1)); }

  const at = (i: number, hint: { k: number }): number => {
    let k = hint.k;
    /* Strided reads move forward, so walk from the last chunk instead of searching. */
    while (k + 1 < starts.length && starts[k + 1]! <= i) k += 1;
    while (k > 0 && starts[k]! > i) k -= 1;
    hint.k = k;
    return views[k]!.getInt16((i - starts[k]!) * 2, true) * scale;
  };

  return {
    length: total,
    strided(from, to, maxPoints) {
      const lo = Math.max(0, Math.floor(from));
      const hi = Math.min(total, Math.ceil(to));
      if (hi <= lo) return [];
      const stride = Math.max(1, Math.ceil((hi - lo) / maxPoints));
      const out: number[] = [];
      const hint = { k: 0 };
      for (let i = lo; i < hi; i += stride) out.push(at(i, hint));
      return out;
    },
  };
}
