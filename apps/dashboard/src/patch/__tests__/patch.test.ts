import { describe, expect, it } from 'vitest';
import { readAppDescription } from '../app-image';
import { deviceNameFromMac } from '../device';
import { RECORD_SIZE, decodeFactoryRecord, encodeFactoryRecord } from '../factory-record';
import { findApp, findFactoryConfig, findNvs, parsePartitionTable, sameLayout } from '../partition-table';
import { formatPin, generatePin, isGuessablePin } from '../pin';
import { planWrites, type FirmwarePart } from '../plan';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/* Shared with firmware/wearwise-esp32/test/host/test_factory_config.c: PIN 123456,
   provisioned 2025-10-09T08:53:20Z. If this changes, the firmware stops reading labels. */
const VECTOR = '575743460100000040e201000078e76800000000000000000000000036cbc013';

/* The partition table ESP-IDF 5.4 generated from partitions.csv (first 192 bytes). */
const TABLE = hex(
  'aa50010200900000006000006e76730000000000000000000000000000000000'
  + 'aa50010100f00000001000007068795f696e6974000000000000000000000000'
  + 'aa5000000000010000701700666163746f727900000000000000000000000000'
  + 'aa50014000f03f00001000007777636667000000000000000000000000000000'
  + 'ebebffffffffffffffffffffffffffff892bab17e8bb987bd293244eeb32bdad'
  + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
);

describe('PIN', () => {
  it('formats in two groups, keeping leading zeros', () => {
    expect(formatPin(42917)).toBe('042 917');
    expect(formatPin(0)).toBe('000 000');
  });

  it('spots the PINs someone would guess', () => {
    for (const p of [0, 111111, 999999, 123456, 654321, 345678, 12345]) expect(isGuessablePin(p)).toBe(true);
    for (const p of [123457, 482915, 100000]) expect(isGuessablePin(p)).toBe(false);
  });

  it('rejects the biased top of the range, guessable PINs and the PIN being replaced', () => {
    const limit = Math.floor(2 ** 32 / 1e6) * 1e6;
    const seq = [limit, limit + 5, 123456, 111111, 482915, 777001];
    const next = () => seq.shift()!;
    expect(generatePin(482915, next)).toBe(777001);
  });

  it('draws six-digit PINs from the secure random source', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePin();
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(999_999);
      expect(isGuessablePin(p)).toBe(false);
    }
  });
});

describe('factory record', () => {
  const record = { pin: 123456, provisionedAt: new Date(1_760_000_000_000) };

  it('matches the byte vector the firmware is tested with', () => {
    expect(toHex(encodeFactoryRecord(record, RECORD_SIZE))).toBe(VECTOR);
  });

  it('fills the rest of the sector like erased flash', () => {
    const sector = encodeFactoryRecord(record);
    expect(sector.length).toBe(4096);
    expect(sector.subarray(RECORD_SIZE).every((b) => b === 0xff)).toBe(true);
  });

  it('round-trips', () => {
    expect(decodeFactoryRecord(encodeFactoryRecord(record))).toEqual(record);
  });

  it('reads a blank or corrupt sector as no record', () => {
    expect(decodeFactoryRecord(new Uint8Array(4096).fill(0xff))).toBeNull();
    const bad = hex(VECTOR);
    bad[9]! ^= 1;
    expect(decodeFactoryRecord(bad)).toBeNull();
    expect(decodeFactoryRecord(hex(VECTOR).subarray(0, 31))).toBeNull();
  });

  it('refuses to write a PIN that is not six digits', () => {
    expect(() => encodeFactoryRecord({ ...record, pin: 1_000_000 })).toThrow(RangeError);
  });
});

describe('partition table', () => {
  const table = parsePartitionTable(TABLE);

  it('parses what ESP-IDF generated, stopping at the MD5 entry', () => {
    expect(table.map((p) => p.label)).toEqual(['nvs', 'phy_init', 'factory', 'wwcfg']);
    expect(findNvs(table)).toMatchObject({ offset: 0x9000, size: 0x6000 });
    expect(findApp(table)).toMatchObject({ offset: 0x10000, size: 1500 * 1024 });
    expect(findFactoryConfig(table)).toMatchObject({ offset: 0x3ff000, size: 0x1000 });
  });

  it('reads erased flash as no table', () => {
    expect(parsePartitionTable(new Uint8Array(0xc00).fill(0xff))).toEqual([]);
  });

  it('compares layouts', () => {
    expect(sameLayout(table, parsePartitionTable(TABLE))).toBe(true);
    expect(sameLayout(table, table.slice(0, 3))).toBe(false);
    expect(sameLayout(table, table.map((p) => (p.label === 'nvs' ? { ...p, size: 0x4000 } : p)))).toBe(false);
  });
});

describe('app image', () => {
  it('reads the version ESP-IDF stamps into the image', () => {
    const img = new Uint8Array(0x100);
    const dv = new DataView(img.buffer);
    img[0] = 0xe9;
    dv.setUint32(0x20, 0xabcd5432, true);
    img.set(new TextEncoder().encode('0.9.2'), 0x30);
    img.set(new TextEncoder().encode('wearwise-esp32'), 0x50);
    img.set(new TextEncoder().encode('13:49:15'), 0x70);
    img.set(new TextEncoder().encode('Oct 13 2026'), 0x80);
    expect(readAppDescription(img)).toEqual({ version: '0.9.2', project: 'wearwise-esp32', builtAt: 'Oct 13 2026 13:49:15' });
  });

  it('reads an empty app partition as nothing installed', () => {
    expect(readAppDescription(new Uint8Array(0x100).fill(0xff))).toBeNull();
  });
});

describe('device name', () => {
  it('is what the firmware advertises: the last two bytes of the base MAC', () => {
    expect(deviceNameFromMac('02:00:00:00:62:80')).toBe('WearWise-6280');
    expect(() => deviceNameFromMac('02:00')).toThrow();
  });
});

describe('planWrites', () => {
  const layout = parsePartitionTable(TABLE);
  const parts: FirmwarePart[] = [
    { offset: 0x10000, data: new Uint8Array(1000), role: 'app' },
    { offset: 0x1000, data: new Uint8Array(100), role: 'bootloader' },
    { offset: 0x8000, data: TABLE, role: 'partition-table' },
  ];
  const firmware = { parts, layout };
  const record = { pin: 482915, provisionedAt: new Date(1_760_000_000_000) };

  it('set-up: firmware, the label PIN and empty settings, in address order', () => {
    const w = planWrites({ action: 'set-up', firmware, record });
    expect(w.map((x) => [x.address, x.what])).toEqual([
      [0x1000, 'Preparing the patch'], [0x8000, 'Preparing the patch'], [0x9000, 'Clearing paired phones and Wi-Fi'],
      [0x10000, 'Installing firmware'], [0x3ff000, 'Writing the Bluetooth PIN'],
    ]);
    const nvs = w.find((x) => x.address === 0x9000)!;
    expect(nvs.data.length).toBe(0x6000);
    expect(nvs.data.every((b) => b === 0xff)).toBe(true);
    expect(decodeFactoryRecord(w.at(-1)!.data)).toEqual(record);
  });

  it('update: firmware only, so the PIN, phones and Wi-Fi survive', () => {
    expect(planWrites({ action: 'update', firmware }).map((x) => x.address)).toEqual([0x1000, 0x8000, 0x10000]);
  });

  it('new-pin: the label and empty settings at the patch’s own layout', () => {
    const w = planWrites({ action: 'new-pin', deviceLayout: layout, record });
    expect(w.map((x) => x.address)).toEqual([0x9000, 0x3ff000]);
  });

  it('refuses a layout with nowhere to keep the PIN', () => {
    const old = layout.filter((p) => p.label !== 'wwcfg');
    expect(() => planWrites({ action: 'new-pin', deviceLayout: old, record })).toThrow(/no place for a label PIN/);
    expect(() => planWrites({ action: 'set-up', firmware: { parts, layout: old }, record })).toThrow(/no place/);
  });

  it('refuses writes that overlap', () => {
    const clash = [...parts, { offset: 0x10100, data: new Uint8Array(10), role: 'app' as const }];
    expect(() => planWrites({ action: 'update', firmware: { parts: clash, layout } })).toThrow(/overlaps/);
  });
});
