import { findApp, findFactoryConfig, findNvs, parsePartitionTable, type Partition } from './partition-table';
import type { FirmwarePart } from './plan';

/* Firmware to install: the build bundled with this dashboard (public/firmware/, written
   by `npm run firmware:export -w dashboard`), or files picked on the page
   (firmware-files.ts). */

export interface Firmware {
  source: 'bundled' | 'files';
  project: string;
  version: string;
  builtAt: string;
  commit: string | null;
  /** The files it came from, for the page to name them. */
  files: string[];
  parts: FirmwarePart[];
  /** The flash layout it installs; null for an app image on its own, which goes into
   *  the layout already on the patch (see forPatch). */
  layout: Partition[] | null;
}

export interface FirmwareManifest {
  project: string;
  version: string;
  chip: string;
  builtAt: string;
  commit: string | null;
  parts: { file: string; offset: number; role: FirmwarePart['role']; size: number; sha256: string }[];
}

const BASE = `${import.meta.env.BASE_URL}firmware/`;

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** null when no firmware is bundled. Every file is checked against the manifest's
 *  SHA-256, so a stale cache or a half-copied export can never reach a patch. */
export async function loadBundledFirmware(fetcher: typeof fetch = fetch): Promise<Firmware | null> {
  const res = await fetcher(`${BASE}manifest.json`, { cache: 'no-cache' });
  /* A missing file comes back as the app's index.html from an SPA host, not a 404. */
  if (res.status === 404 || !res.headers.get('content-type')?.includes('json')) return null;
  if (!res.ok) throw new Error(`The bundled firmware couldn’t be loaded (HTTP ${res.status}).`);
  const manifest = (await res.json()) as FirmwareManifest;

  const parts = await Promise.all(manifest.parts.map(async (p): Promise<FirmwarePart> => {
    const r = await fetcher(`${BASE}${p.file}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Firmware file ${p.file} is missing (HTTP ${r.status}).`);
    const data = new Uint8Array(await r.arrayBuffer());
    if (data.length !== p.size || (await sha256Hex(data)) !== p.sha256) {
      throw new Error(`Firmware file ${p.file} doesn’t match its manifest. Export the firmware again.`);
    }
    return { offset: p.offset, data, role: p.role };
  }));

  const table = parts.find((p) => p.role === 'partition-table');
  const layout = table ? parsePartitionTable(table.data) : [];
  if (!findFactoryConfig(layout) || !findNvs(layout)) {
    throw new Error('The bundled firmware has no place for a label PIN. Rebuild it from the current source and export it again.');
  }
  const { project, version, builtAt, commit } = manifest;
  return { source: 'bundled', project, version, builtAt, commit, files: manifest.parts.map((p) => p.file), parts, layout };
}

/** The firmware's writes and resulting layout on one patch, or why it can't go there.
 *  An app image on its own goes into the patch's own app partition. */
export function forPatch(fw: Firmware, deviceLayout: Partition[] | null): { parts: FirmwarePart[]; layout: Partition[] } | string {
  if (fw.layout) return { parts: fw.parts, layout: fw.layout };
  const slot = deviceLayout && findApp(deviceLayout);
  const app = fw.parts.find((p) => p.role === 'app');
  if (!deviceLayout || !slot || !app) {
    return 'This patch has no flash layout to install an app image into. Choose the bootloader and partition table too, or a merged image.';
  }
  if (app.data.length > slot.size) {
    return `The app image (${kb(app.data.length)}) is bigger than the patch’s app partition (${kb(slot.size)}).`;
  }
  return { parts: [{ ...app, offset: slot.offset }], layout: deviceLayout };
}

export const kb = (bytes: number): string => `${Math.ceil(bytes / 1024)} KB`;
