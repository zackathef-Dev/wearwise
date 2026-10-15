import { crc32 } from '@wearwise/sensor-protocol';

/* TEST-ONLY copy of the phone's packer (apps/mobile/src/data/sync/chunk-container.ts,
 * packChannelChunks), so the dashboard's decoder can be exercised the same way the
 * mobile tests exercise theirs. The dashboard itself never writes containers.
 * Byte-compatibility with the real phone code is pinned separately by the golden
 * bytes in chunk-container.test.ts, which were produced by the mobile packer.
 */

export interface TestChunk {
  chunkNumber: number;
  firstSequence: number;
  lastSequence: number;
  startedAtUs: bigint;
  endedAtUs: bigint;
  sampleCount: number;
  payload: Uint8Array;
  checksum: number;
}

const MAGIC = [0x57, 0x57, 0x43, 0x48];
const HEADER = 12;
const CHUNK_META = 40;

export function packChannelChunks(chunks: TestChunk[]): Uint8Array {
  const ordered = [...chunks].sort((a, b) => a.chunkNumber - b.chunkNumber);
  let total = HEADER;
  for (const c of ordered) total += CHUNK_META + c.payload.length;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = 1;
  dv.setUint32(8, ordered.length, true);

  let o = HEADER;
  for (const c of ordered) {
    dv.setUint32(o, c.chunkNumber >>> 0, true); o += 4;
    dv.setUint32(o, c.firstSequence >>> 0, true); o += 4;
    dv.setUint32(o, c.lastSequence >>> 0, true); o += 4;
    dv.setBigUint64(o, BigInt.asUintN(64, c.startedAtUs), true); o += 8;
    dv.setBigUint64(o, BigInt.asUintN(64, c.endedAtUs), true); o += 8;
    dv.setUint32(o, c.sampleCount >>> 0, true); o += 4;
    dv.setUint32(o, c.checksum >>> 0, true); o += 4;
    dv.setUint32(o, c.payload.length >>> 0, true); o += 4;
    out.set(c.payload, o); o += c.payload.length;
  }
  return out;
}

/** The mobile test's fixture builder: chunk n spans n s .. n s + 999 999 µs. */
export function chunk(n: number, payload: number[]): TestChunk {
  const p = new Uint8Array(payload);
  return {
    chunkNumber: n, firstSequence: n * 10, lastSequence: n * 10 + 4,
    startedAtUs: BigInt(n) * 1_000_000n, endedAtUs: BigInt(n) * 1_000_000n + 999_999n,
    sampleCount: payload.length / 2, payload: p, checksum: crc32(p),
  };
}

/** A chunk built from int16 sample values with explicit timestamps. */
export function samplesChunk(n: number, values: number[], startedAtUs: bigint, endedAtUs: bigint): TestChunk {
  const p = new Uint8Array(values.length * 2);
  const dv = new DataView(p.buffer);
  values.forEach((v, i) => dv.setInt16(i * 2, v, true));
  return {
    chunkNumber: n, firstSequence: n, lastSequence: n, startedAtUs, endedAtUs,
    sampleCount: values.length, payload: p, checksum: crc32(p),
  };
}
