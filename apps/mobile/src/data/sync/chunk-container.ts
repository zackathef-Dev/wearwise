import { crc32 } from '@wearwise/sensor-protocol';
import type { SampleChunk } from '@/domain/entities/session';

/* Chunk container — one channel's sample chunks packed into a single binary blob
 * for cloud Storage, and unpacked + CRC-verified on the way back.
 *
 * Uploading each chunk as its own Storage object would be thousands of requests
 * per session. Instead a channel becomes ONE object: a self-describing container
 * that preserves every chunk's boundaries, timestamps and CRC, so the download is
 * verifiable against exactly what the device sent — the same guarantee the local
 * store gives. Nothing is re-encoded; the int16 payload bytes are copied verbatim.
 *
 * Layout (little-endian):
 *   0   4   magic  'W' 'W' 'C' 'H'
 *   4   1   version = 1
 *   5   3   reserved (0)
 *   8   4   chunkCount u32
 *   then per chunk:
 *     4   chunkNumber u32
 *     4   firstSequence u32
 *     4   lastSequence u32
 *     8   startedAtUs u64
 *     8   endedAtUs u64
 *     4   sampleCount u32
 *     4   checksum u32   (CRC-32 of payload)
 *     4   payloadLen u32
 *     n   payload bytes
 */

const MAGIC = [0x57, 0x57, 0x43, 0x48]; // 'WWCH'
const VERSION = 1;
const HEADER = 12;
const CHUNK_META = 40; // 4+4+4+8+8+4+4+4

export interface ContainerChunk {
  chunkNumber: number;
  firstSequence: number;
  lastSequence: number;
  startedAtUs: bigint;
  endedAtUs: bigint;
  sampleCount: number;
  checksum: number;
  payload: Uint8Array;
}

export function packChannelChunks(chunks: SampleChunk[]): Uint8Array {
  const ordered = [...chunks].sort((a, b) => a.chunkNumber - b.chunkNumber);
  let total = HEADER;
  for (const c of ordered) total += CHUNK_META + c.payload.length;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = MAGIC[0]!; out[1] = MAGIC[1]!; out[2] = MAGIC[2]!; out[3] = MAGIC[3]!;
  out[4] = VERSION;
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

export class ContainerError extends Error {}

export function unpackChannelChunks(bytes: Uint8Array): ContainerChunk[] {
  if (bytes.length < HEADER) throw new ContainerError('container too short');
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) {
    throw new ContainerError('bad container magic');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[4] !== VERSION) throw new ContainerError(`unsupported container version ${bytes[4]}`);
  const count = dv.getUint32(8, true);

  const chunks: ContainerChunk[] = [];
  let o = HEADER;
  for (let i = 0; i < count; i++) {
    if (o + CHUNK_META > bytes.length) throw new ContainerError('truncated chunk header');
    const chunkNumber = dv.getUint32(o, true); o += 4;
    const firstSequence = dv.getUint32(o, true); o += 4;
    const lastSequence = dv.getUint32(o, true); o += 4;
    const startedAtUs = dv.getBigUint64(o, true); o += 8;
    const endedAtUs = dv.getBigUint64(o, true); o += 8;
    const sampleCount = dv.getUint32(o, true); o += 4;
    const checksum = dv.getUint32(o, true); o += 4;
    const payloadLen = dv.getUint32(o, true); o += 4;
    if (o + payloadLen > bytes.length) throw new ContainerError('truncated chunk payload');
    /* int16 samples: two bytes each. The CRC covers only the payload, so a count that
       disagrees with it would send readers past the end. */
    if (payloadLen !== sampleCount * 2) throw new ContainerError(`chunk ${chunkNumber} sample count does not match its payload`);
    const payload = bytes.slice(o, o + payloadLen); o += payloadLen;

    /* The whole point of keeping the CRC: verify the bytes survived the round trip. */
    const actual = crc32(payload);
    if (actual !== checksum) {
      throw new ContainerError(`chunk ${chunkNumber} CRC mismatch: stored ${checksum.toString(16)}, computed ${actual.toString(16)}`);
    }
    chunks.push({ chunkNumber, firstSequence, lastSequence, startedAtUs, endedAtUs, sampleCount, checksum, payload });
  }
  return chunks;
}
