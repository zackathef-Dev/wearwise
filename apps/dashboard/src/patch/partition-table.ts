/* The ESP-IDF partition table: 0xC00 bytes at flash 0x8000. Each 32-byte entry is
   magic AA 50, type u8, subtype u8, offset u32, size u32, label[16], flags u32 (LE).
   An MD5 entry (magic EB EB) or erased flash (FF FF) ends the list. */

export const PARTITION_TABLE_OFFSET = 0x8000;
export const PARTITION_TABLE_SIZE = 0xc00;

export const TYPE_APP = 0x00;
export const TYPE_DATA = 0x01;
export const SUBTYPE_NVS = 0x02;
export const SUBTYPE_FACTORY_CONFIG = 0x40; // `wwcfg`, see partitions.csv

export interface Partition {
  label: string;
  type: number;
  subtype: number;
  offset: number;
  size: number;
}

const ENTRY = 32;

export function parsePartitionTable(bytes: Uint8Array): Partition[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Partition[] = [];
  for (let at = 0; at + ENTRY <= bytes.length; at += ENTRY) {
    if (bytes[at] !== 0xaa || bytes[at + 1] !== 0x50) break;
    const raw = bytes.subarray(at + 12, at + 28);
    const end = raw.indexOf(0);
    out.push({
      label: String.fromCharCode(...raw.subarray(0, end < 0 ? raw.length : end)),
      type: bytes[at + 2]!,
      subtype: bytes[at + 3]!,
      offset: dv.getUint32(at + 4, true),
      size: dv.getUint32(at + 8, true),
    });
  }
  return out;
}

export const findNvs = (table: Partition[]): Partition | undefined =>
  table.find((p) => p.type === TYPE_DATA && p.subtype === SUBTYPE_NVS);

export const findFactoryConfig = (table: Partition[]): Partition | undefined =>
  table.find((p) => p.type === TYPE_DATA && p.subtype === SUBTYPE_FACTORY_CONFIG && p.label === 'wwcfg');

/** The partition the bootloader runs: factory, else the first OTA slot. */
export const findApp = (table: Partition[]): Partition | undefined =>
  table.find((p) => p.type === TYPE_APP && p.subtype === 0x00) ?? table.find((p) => p.type === TYPE_APP);

/** Same partitions at the same places: a firmware update keeps the settings valid. */
export function sameLayout(a: Partition[], b: Partition[]): boolean {
  const key = (p: Partition) => `${p.label}/${p.type}/${p.subtype}/${p.offset}/${p.size}`;
  return a.length === b.length && a.every((p, i) => key(p) === key(b[i]!));
}
