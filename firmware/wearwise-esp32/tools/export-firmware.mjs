#!/usr/bin/env node
/* Copies an ESP-IDF build into the researcher dashboard's patch-setup page.
 *
 *   idf.py build
 *   npm run firmware:export -w dashboard              # from the repo root
 *   npm run firmware:export -w dashboard -- --build <dir> --out <dir>
 *
 * Reads build/flasher_args.json (which ESP-IDF writes next to the binaries) for
 * what goes where, and writes apps/dashboard/public/firmware/: the three images
 * plus manifest.json with each file's offset, size and SHA-256. The page refuses
 * any file that doesn't match its manifest.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');
const repo = resolve(project, '../..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback;
};
const build = arg('build', join(project, 'build'));
const out = arg('out', join(repo, 'apps/dashboard/public/firmware'));

function fail(message) {
  console.error(`firmware:export: ${message}`);
  process.exit(1);
}

let args;
try {
  args = JSON.parse(readFileSync(join(build, 'flasher_args.json'), 'utf8'));
} catch {
  fail(`no ESP-IDF build in ${build} (run \`idf.py build\` first, or pass --build <dir>)`);
}
if (args.extra_esptool_args?.chip !== 'esp32') fail(`built for ${args.extra_esptool_args?.chip}, not esp32`);

const ROLE = { bootloader: 'bootloader', 'partition-table': 'partition-table', app: 'app' };
const parts = Object.entries(ROLE).map(([key, role]) => {
  const entry = args[key];
  if (!entry) fail(`flasher_args.json has no ${key}`);
  if (entry.encrypted === 'true') fail('flash encryption is on; the patch-setup page writes plain images');
  const data = readFileSync(join(build, entry.file));
  return { role, offset: Number(entry.offset), data, file: entry.file.split('/').pop() };
});

/* The label PIN needs the `wwcfg` partition: an old sdkconfig still points at the
   stock single-app table, and a patch set up with that firmware couldn't keep its PIN. */
const table = parts.find((p) => p.role === 'partition-table').data;
let hasCfg = false;
for (let at = 0; at + 32 <= table.length && table[at] === 0xaa && table[at + 1] === 0x50; at += 32) {
  if (table[at + 2] === 0x01 && table[at + 3] === 0x40) hasCfg = true;
}
if (!hasCfg) {
  fail('this build has no `wwcfg` partition. Delete firmware/wearwise-esp32/sdkconfig (it predates partitions.csv) and run `idf.py build` again.');
}

/* esp_app_desc_t: right after the 24-byte image header and the 8-byte segment header. */
const app = parts.find((p) => p.role === 'app').data;
const cstr = (from, len) => app.subarray(from, from + len).toString('latin1').replace(/\0.*$/s, '');
if (app.readUInt32LE(0x20) !== 0xabcd5432) fail('the app image has no esp_app_desc');
const version = cstr(0x30, 32);
const projectName = cstr(0x50, 32);
const builtAt = `${cstr(0x80, 16)} ${cstr(0x70, 16)}`;

let commit = null;
try {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  commit = git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--', 'firmware/wearwise-esp32') ? '-dirty' : '');
} catch { /* not a git checkout: leave it out */ }

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.bin') || f === 'manifest.json') rmSync(join(out, f));

const manifest = {
  project: projectName,
  version,
  chip: 'esp32',
  builtAt,
  commit,
  parts: parts.map((p) => {
    writeFileSync(join(out, p.file), p.data);
    return { file: p.file, offset: p.offset, role: p.role, size: p.data.length, sha256: createHash('sha256').update(p.data).digest('hex') };
  }),
};
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`firmware:export: ${projectName} ${version} (${builtAt}${commit ? `, ${commit}` : ''}) → ${out}`);
for (const p of manifest.parts) console.log(`  0x${p.offset.toString(16).padStart(5, '0')}  ${p.file}  ${p.size} B`);
