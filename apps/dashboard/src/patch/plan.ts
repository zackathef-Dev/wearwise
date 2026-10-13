import { encodeFactoryRecord, type FactoryRecord } from './factory-record';
import { findFactoryConfig, findNvs, type Partition } from './partition-table';

/* What each action writes to the patch's flash. Pure, so it is unit-tested; the
   esptool-js plumbing in serial-link.ts just executes the list. */

export type PatchAction =
  /** Firmware + a new label PIN + empty settings: a patch as if new. */
  | 'set-up'
  /** Firmware only: PIN, paired phones and Wi-Fi are kept. */
  | 'update'
  /** A new label PIN + empty settings, firmware untouched: before a new participant. */
  | 'new-pin';

export interface FirmwarePart {
  offset: number;
  data: Uint8Array;
  role: 'bootloader' | 'partition-table' | 'app';
}

export interface FlashWrite {
  address: number;
  data: Uint8Array;
  what: string;
}

export interface PlanInput {
  action: PatchAction;
  /** The firmware to install (set-up, update). */
  firmware?: { parts: FirmwarePart[]; layout: Partition[] };
  /** The layout on the patch now (new-pin). */
  deviceLayout?: Partition[] | null;
  /** The new label (set-up, new-pin). */
  record?: FactoryRecord;
}

export function planWrites({ action, firmware, deviceLayout, record }: PlanInput): FlashWrite[] {
  const writes: FlashWrite[] = [];
  if (action === 'set-up' || action === 'update') {
    if (!firmware) throw new Error('No firmware to install');
    for (const p of firmware.parts) writes.push({ address: p.offset, data: p.data, what: firmwareLabel(p.role) });
  }
  if (action === 'set-up' || action === 'new-pin') {
    /* The layout that will be on the patch once this finishes. */
    const layout = action === 'set-up' ? firmware!.layout : deviceLayout;
    const cfg = layout && findFactoryConfig(layout);
    const nvs = layout && findNvs(layout);
    if (!cfg || !nvs) throw new Error('This firmware has no place for a label PIN. Install the current firmware with “Set up”.');
    if (!record) throw new Error('No PIN to write');
    writes.push({ address: cfg.offset, data: encodeFactoryRecord(record, cfg.size), what: 'Writing the Bluetooth PIN' });
    /* Erased flash reads 0xFF; the firmware formats an empty settings store on boot.
       This is what unpairs every phone and forgets the Wi-Fi. */
    writes.push({ address: nvs.offset, data: new Uint8Array(nvs.size).fill(0xff), what: 'Clearing paired phones and Wi-Fi' });
  }
  writes.sort((a, b) => a.address - b.address);
  for (let i = 1; i < writes.length; i++) {
    const prev = writes[i - 1]!;
    if (prev.address + prev.data.length > writes[i]!.address) throw new Error(`${prev.what} overlaps ${writes[i]!.what}`);
  }
  return writes;
}

function firmwareLabel(role: FirmwarePart['role']): string {
  return role === 'app' ? 'Installing firmware' : 'Preparing the patch';
}
