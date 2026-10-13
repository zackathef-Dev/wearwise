/* What firmware a patch is running: the esp_app_desc_t every ESP-IDF app image
   carries right after its 24-byte image header and 8-byte first segment header. */

export const APP_DESC_READ_SIZE = 0x100;
const IMAGE_MAGIC = 0xe9;
const DESC_AT = 0x20;
const DESC_MAGIC = 0xabcd5432;

export interface AppDescription {
  version: string;
  project: string;
  /** Compile date and time as the toolchain wrote them, e.g. "Oct 13 2026 10:04:12". */
  builtAt: string;
}

function cString(bytes: Uint8Array, from: number, length: number): string {
  const raw = bytes.subarray(from, from + length);
  const end = raw.indexOf(0);
  return String.fromCharCode(...raw.subarray(0, end < 0 ? raw.length : end)).trim();
}

/** The start of an app partition (at least 0x100 bytes) → its description, or null if empty. */
export function readAppDescription(bytes: Uint8Array): AppDescription | null {
  if (bytes.length < DESC_AT + 112 || bytes[0] !== IMAGE_MAGIC) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(DESC_AT, true) !== DESC_MAGIC) return null;
  const d = DESC_AT;
  return {
    version: cString(bytes, d + 16, 32),
    project: cString(bytes, d + 48, 32),
    builtAt: `${cString(bytes, d + 96, 16)} ${cString(bytes, d + 80, 16)}`.trim(),
  };
}

export const ESP32_CHIP_ID = 0;

/** The chip an ESP-IDF image (app or bootloader) was built for — esp_image_header_t's
 *  chip_id at byte 12 — or null if the bytes aren't an image. */
export function imageChipId(bytes: Uint8Array): number | null {
  if (bytes.length < 24 || bytes[0] !== IMAGE_MAGIC) return null;
  return bytes[12]! | (bytes[13]! << 8);
}
