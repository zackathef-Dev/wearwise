import { describe, expect, it } from 'vitest';
import { forPatch } from '../firmware';
import { firmwareFromFiles } from '../firmware-files';
import { parsePartitionTable } from '../partition-table';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
/* ESP-IDF's table for partitions.csv: nvs 0x9000, phy_init, factory 0x10000 (1500K), wwcfg 0x3ff000. */
const TABLE = hex(
  'aa50010200900000006000006e76730000000000000000000000000000000000'
  + 'aa50010100f00000001000007068795f696e6974000000000000000000000000'
  + 'aa5000000000010000701700666163746f727900000000000000000000000000'
  + 'aa50014000f03f00001000007777636667000000000000000000000000000000'
  + 'ebebffffffffffffffffffffffffffff892bab17e8bb987bd293244eeb32bdad',
);

function image(kind: 'app' | 'bootloader', { chip = 0, size = 0x400, project = 'wearwise-esp32', version = '0.9.3' } = {}) {
  const b = new Uint8Array(size);
  b[0] = 0xe9;
  b[12] = chip & 0xff;
  b[13] = chip >> 8;
  if (kind === 'app') {
    new DataView(b.buffer).setUint32(0x20, 0xabcd5432, true);
    b.set(new TextEncoder().encode(version), 0x30);
    b.set(new TextEncoder().encode(project), 0x50);
    b.set(new TextEncoder().encode('10:00:00'), 0x70);
    b.set(new TextEncoder().encode('Oct 14 2026'), 0x80);
  } else {
    b[0x20] = 0x50; // esp_bootloader_desc_t magic byte
  }
  return b;
}
const file = (name: string, data: Uint8Array) => ({ name, data });
const layout = parsePartitionTable(TABLE);

describe('firmwareFromFiles', () => {
  it('takes the three build files in any order, recognised by content', () => {
    const fw = firmwareFromFiles([file('a.bin', image('app')), file('b.bin', TABLE), file('c.bin', image('bootloader'))]);
    expect(fw).toMatchObject({ source: 'files', project: 'wearwise-esp32', version: '0.9.3', builtAt: 'Oct 14 2026 10:00:00' });
    expect(fw.parts.map((p) => [p.role, p.offset])).toEqual([['bootloader', 0x1000], ['partition-table', 0x8000], ['app', 0x10000]]);
    expect(fw.layout?.map((p) => p.label)).toEqual(['nvs', 'phy_init', 'factory', 'wwcfg']);
  });

  it('takes an app image alone, placed into the patch’s own app partition', () => {
    const fw = firmwareFromFiles([file('wearwise-esp32.bin', image('app'))]);
    expect(fw.layout).toBeNull();
    const target = forPatch(fw, layout);
    expect(typeof target).toBe('object');
    expect((target as Exclude<typeof target, string>).parts.map((p) => p.offset)).toEqual([0x10000]);
  });

  it('refuses an app image alone for a patch with no layout, or one that doesn’t fit', () => {
    const fw = firmwareFromFiles([file('app.bin', image('app'))]);
    expect(forPatch(fw, null)).toMatch(/no flash layout/);
    const small = layout.map((p) => (p.label === 'factory' ? { ...p, size: 0x200 } : p));
    expect(forPatch(fw, small)).toMatch(/bigger than the patch’s app partition/);
  });

  it('splits a merged image from 0x0 (idf.py merge-bin) and from 0x1000', () => {
    const app = image('app', { size: 0x2000 });
    for (const base of [0, 0x1000]) {
      const merged = new Uint8Array(0x10000 + app.length - base).fill(0xff);
      merged.set(image('bootloader'), 0x1000 - base);
      merged.set(TABLE, 0x8000 - base);
      merged.set(app, 0x10000 - base);
      const fw = firmwareFromFiles([file('merged-binary.bin', merged)]);
      expect(fw.parts.map((p) => [p.role, p.offset, p.data.length])).toEqual([
        ['bootloader', 0x1000, 0x7000], ['partition-table', 0x8000, 0xc00], ['app', 0x10000, app.length],
      ]);
      expect(fw.parts[2]!.data).toEqual(app);
    }
  });

  it('refuses firmware for another chip', () => {
    expect(() => firmwareFromFiles([file('s3.bin', image('app', { chip: 9 }))])).toThrow(/ESP32-S3/);
    expect(() => firmwareFromFiles([file('app.bin', image('app')), file('t.bin', TABLE), file('bl.bin', image('bootloader', { chip: 5 }))]))
      .toThrow(/bl.bin is built for ESP32-C3/);
  });

  it('refuses files that aren’t firmware, duplicates, and incomplete sets', () => {
    expect(() => firmwareFromFiles([file('notes.txt', new TextEncoder().encode('hello'))])).toThrow(/notes.txt isn’t ESP32 firmware/);
    expect(() => firmwareFromFiles([file('a.bin', image('app')), file('b.bin', image('app'))])).toThrow(/both an app image/);
    expect(() => firmwareFromFiles([file('t.bin', TABLE)])).toThrow(/Choose the app image too/);
    expect(() => firmwareFromFiles([file('a.bin', image('app')), file('bl.bin', image('bootloader'))])).toThrow(/partition-table.bin as well/);
    expect(() => firmwareFromFiles([])).toThrow(/No files/);
  });

  it('refuses an app bigger than its partition', () => {
    const tiny = TABLE.slice();
    new DataView(tiny.buffer).setUint32(64 + 8, 0x100, true); // factory size → 256 B
    expect(() => firmwareFromFiles([file('app.bin', image('app')), file('t.bin', tiny)])).toThrow(/doesn’t fit its app partition/);
  });

  it('reports the project name so foreign firmware can be flagged', () => {
    expect(firmwareFromFiles([file('blink.bin', image('app', { project: 'blink' }))]).project).toBe('blink');
  });
});
