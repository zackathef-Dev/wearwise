import { crc32 } from '@wearwise/sensor-protocol';
import { isValidPin } from './pin';

/* The factory record: the patch's label PIN, kept in the `wwcfg` flash partition
   outside the settings store, so erasing settings never changes the label.
   The byte layout is documented once, in
   firmware/wearwise-esp32/main/core/factory_config.h. */

export const RECORD_SIZE = 32;
const MAGIC = 0x46435757; // "WWCF"
const VERSION = 1;
const CRC_AT = 28;

export interface FactoryRecord {
  pin: number;
  provisionedAt: Date;
}

/** The record, padded with 0xFF (erased flash) to fill the partition's sector. */
export function encodeFactoryRecord(record: FactoryRecord, sectorSize = 0x1000): Uint8Array {
  if (!isValidPin(record.pin)) throw new RangeError('The PIN must be six digits');
  const out = new Uint8Array(sectorSize).fill(0xff);
  out.fill(0, 0, RECORD_SIZE);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint16(4, VERSION, true);
  dv.setUint32(8, record.pin, true);
  dv.setUint32(12, Math.floor(record.provisionedAt.getTime() / 1000), true);
  dv.setUint32(CRC_AT, crc32(out, 0, CRC_AT), true);
  return out;
}

/** null for a blank sector, a corrupt record, or one this page doesn't understand. */
export function decodeFactoryRecord(bytes: Uint8Array): FactoryRecord | null {
  if (bytes.length < RECORD_SIZE) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, RECORD_SIZE);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint16(4, true) !== VERSION) return null;
  if (crc32(bytes, 0, CRC_AT) !== dv.getUint32(CRC_AT, true)) return null;
  const pin = dv.getUint32(8, true);
  if (!isValidPin(pin)) return null;
  return { pin, provisionedAt: new Date(dv.getUint32(12, true) * 1000) };
}
