import { ESP32_CHIP_ID, imageChipId, readAppDescription } from './app-image';
import { kb, type Firmware } from './firmware';
import { PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE, findApp, parsePartitionTable } from './partition-table';
import type { FirmwarePart } from './plan';

/* Firmware from files picked on the page. Accepts what an ESP-IDF build produces:
 *   - the app image alone (build/wearwise-esp32.bin): installs into the patch's layout
 *   - the three images from build/ (bootloader, partition table, app), any order
 *   - one merged image (`idf.py merge-bin`, or esptool merge_bin from 0x0 or 0x1000)
 * Each file is recognised by its content, never its name, and anything that isn't
 * ESP32 firmware, or doesn't fit, is refused before it can reach a patch. */

export interface PickedFile {
  name: string;
  data: Uint8Array;
}

const BOOTLOADER_OFFSET = 0x1000; // ESP32: the ROM loads the second-stage bootloader from here
const MAX_FILE = 4 * 1024 * 1024; // the patch's whole flash

const CHIP_NAMES: Record<number, string> = { 2: 'ESP32-S2', 5: 'ESP32-C3', 9: 'ESP32-S3', 12: 'ESP32-C2', 13: 'ESP32-C6', 16: 'ESP32-H2', 18: 'ESP32-P4' };

const KIND: Record<FirmwarePart['role'], string> = { bootloader: 'a bootloader', 'partition-table': 'a partition table', app: 'an app image' };

const isTable = (d: Uint8Array, at = 0) => d[at] === 0xaa && d[at + 1] === 0x50;

/** Where flash 0x0 sits in a merged image, or null if it isn't one. */
function mergedBase(d: Uint8Array): number | null {
  if (d.length > PARTITION_TABLE_OFFSET + 32 && d[BOOTLOADER_OFFSET] === 0xe9 && isTable(d, PARTITION_TABLE_OFFSET)) return 0;
  const at = PARTITION_TABLE_OFFSET - BOOTLOADER_OFFSET;
  if (d.length > at + 32 && d[0] === 0xe9 && isTable(d, at)) return BOOTLOADER_OFFSET; // starts at the bootloader
  return null;
}

function splitMerged(file: PickedFile, base: number): PickedFile[] {
  const at = (flash: number) => flash - base;
  const table = file.data.slice(at(PARTITION_TABLE_OFFSET), at(PARTITION_TABLE_OFFSET) + PARTITION_TABLE_SIZE);
  const slot = findApp(parsePartitionTable(table));
  if (!slot || at(slot.offset) >= file.data.length) throw new Error(`${file.name} is a merged image without an app in it.`);
  return [
    { name: `${file.name} (bootloader)`, data: file.data.slice(at(BOOTLOADER_OFFSET), at(PARTITION_TABLE_OFFSET)) },
    { name: `${file.name} (partition table)`, data: table },
    { name: `${file.name} (app)`, data: file.data.slice(at(slot.offset)) },
  ];
}

function checkChip(file: PickedFile): void {
  const chip = imageChipId(file.data);
  if (chip !== ESP32_CHIP_ID) {
    throw new Error(`${file.name} is built for ${CHIP_NAMES[chip!] ?? `another chip (id ${chip})`}. WearWise patches use an ESP32.`);
  }
}

export function firmwareFromFiles(picked: PickedFile[]): Firmware {
  if (!picked.length) throw new Error('No files chosen.');
  for (const f of picked) if (f.data.length > MAX_FILE) throw new Error(`${f.name} is bigger than the patch’s 4 MB flash.`);

  const base = picked.length === 1 ? mergedBase(picked[0]!.data) : null;
  const files = base === null ? picked : splitMerged(picked[0]!, base);

  const found: Partial<Record<FirmwarePart['role'], PickedFile>> = {};
  for (const f of files) {
    const role: FirmwarePart['role'] | null = isTable(f.data) ? 'partition-table'
      : readAppDescription(f.data) ? 'app'
        : imageChipId(f.data) !== null ? 'bootloader'
          : null;
    if (!role) throw new Error(`${f.name} isn’t ESP32 firmware (not an app, bootloader, partition table or merged image).`);
    if (found[role]) throw new Error(`${found[role]!.name} and ${f.name} are both ${KIND[role]}. Choose one of each.`);
    found[role] = f;
  }

  const { app, bootloader } = found;
  const table = found['partition-table'];
  if (!app) throw new Error('Choose the app image too (build/wearwise-esp32.bin).');
  if (bootloader && !table) throw new Error('A bootloader goes with its partition table: choose partition-table.bin as well.');
  checkChip(app);
  if (bootloader) checkChip(bootloader);

  const desc = readAppDescription(app.data)!;
  const parts: FirmwarePart[] = [];
  let layout = null;
  if (table) {
    if (table.data.length > PARTITION_TABLE_SIZE) throw new Error(`${table.name} is too long for a partition table.`);
    layout = parsePartitionTable(table.data);
    const slot = findApp(layout);
    if (!slot) throw new Error(`${table.name} has no app partition.`);
    if (app.data.length > slot.size) throw new Error(`${app.name} (${kb(app.data.length)}) doesn’t fit its app partition (${kb(slot.size)}).`);
    if (bootloader) {
      if (BOOTLOADER_OFFSET + bootloader.data.length > PARTITION_TABLE_OFFSET) throw new Error(`${bootloader.name} is too big for a bootloader.`);
      parts.push({ offset: BOOTLOADER_OFFSET, data: bootloader.data, role: 'bootloader' });
    }
    parts.push({ offset: PARTITION_TABLE_OFFSET, data: table.data, role: 'partition-table' });
    parts.push({ offset: slot.offset, data: app.data, role: 'app' });
  } else {
    parts.push({ offset: -1, data: app.data, role: 'app' }); // placed by forPatch
  }

  return {
    source: 'files', project: desc.project, version: desc.version, builtAt: desc.builtAt, commit: null,
    files: picked.map((f) => f.name), parts, layout,
  };
}
