import { crc32 } from '@wearwise/sensor-protocol';

/* Chunk container DECODER, copied from the phone app:
 *   apps/mobile/src/data/sync/chunk-container.ts  (unpackChannelChunks)
 *
 * The phone packs one channel's sample chunks into a single Storage object; this is
 * the read half. It is a copy rather than an import because the mobile file sits
 * behind the app's `@/` path alias and owns the pack half the dashboard must never
 * need. If the layout below changes there, change it here too — the golden-bytes
 * test in __tests__/chunk-container.test.ts fails loudly when the two drift.
 *
 * One deliberate difference: payloads are `subarray` views into the downloaded
 * buffer, not `slice` copies. The dashboard never mutates them and drops them as
 * soon as the samples are copied into a series, so copying would only double the
 * peak memory of a long ECG download.
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
 *     n   payload bytes   (int16 LE samples, physical = raw × SAMPLE_SCALE[sensor])
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
    const payload = bytes.subarray(o, o + payloadLen); o += payloadLen;

    /* The whole point of keeping the CRC: verify the bytes survived the round trip. */
    const actual = crc32(payload);
    if (actual !== checksum) {
      throw new ContainerError(`chunk ${chunkNumber} CRC mismatch: stored ${checksum.toString(16)}, computed ${actual.toString(16)}`);
    }
    chunks.push({ chunkNumber, firstSequence, lastSequence, startedAtUs, endedAtUs, sampleCount, checksum, payload });
  }
  return chunks;
}
