#!/usr/bin/env node
/* Point the mobile app and the web dashboard at a backend, by configuration only.
 *
 *   npm run backend:local                     # local Supabase (`supabase start` must be running)
 *   npm run backend:local -- --host 10.0.2.2  # Android emulator only
 *   npm run backend:local -- --host 127.0.0.1 # iOS simulator, or a USB Android phone after
 *                                             #   `adb reverse tcp:54321 tcp:54321`
 *   npm run backend:cloud                     # back to the cloud values in each app's .env
 *   npm run backend:status                    # which backend each app will use
 *
 * "local" writes apps/mobile/.env.development.local and apps/dashboard/.env.development.local.
 * Expo and Vite read *.development.local only in development (expo start / expo run:* debug
 * builds, vite dev), on top of .env, so:
 *   - release builds never see the local backend (they read .env.production), and
 *   - "cloud" just deletes those two files; .env (and .env.production) are never touched.
 * Both files are gitignored. The local anon key comes from `supabase status`; it is a
 * development-only key, but this script still doesn't print it.
 *
 * Why a LAN address: on a phone, "localhost" is the phone. A physical device needs the
 * computer's address on the shared Wi-Fi (detected below; override with --host). The
 * dashboard runs in a browser on this computer, so it always gets 127.0.0.1.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MOBILE = `${root}apps/mobile/.env.development.local`;
const DASHBOARD = `${root}apps/dashboard/.env.development.local`;
const [mode, ...args] = process.argv.slice(2);

const PRIVATE = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
function lanAddress() {
  const candidates = Object.entries(networkInterfaces())
    .filter(([name]) => !/^(lo|utun|awdl|llw|bridge|docker|veth|vEthernet|br-)/i.test(name))
    .flatMap(([name, addrs]) => (addrs ?? []).filter((a) => a.family === 'IPv4' && !a.internal && PRIVATE.test(a.address)).map((a) => ({ name, address: a.address })));
  // Prefer the usual Wi-Fi / Ethernet interface names (macOS en0, Linux wlan0/eth0, Windows Wi-Fi).
  candidates.sort((a, b) => Number(/^(en0|wlan|wl|eth|Wi-?Fi|Ethernet)/i.test(b.name)) - Number(/^(en0|wlan|wl|eth|Wi-?Fi|Ethernet)/i.test(a.name)));
  return candidates[0]?.address;
}

function localStack() {
  let out;
  try {
    out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('Local Supabase is not running (or the Supabase CLI is not installed). Start it first:\n  supabase start');
    process.exit(1);
  }
  const env = Object.fromEntries(out.split(/\r?\n/).map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  const api = env.API_URL && new URL(env.API_URL);
  const key = env.PUBLISHABLE_KEY || env.ANON_KEY;
  if (!api || !key) { console.error('`supabase status -o env` did not report API_URL and a publishable/anon key.'); process.exit(1); }
  return { port: api.port || '54321', key };
}

const describe = (file, name) => {
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1) ?? null;
};

if (mode === 'local') {
  const hostFlag = args.indexOf('--host');
  const host = hostFlag >= 0 ? args[hostFlag + 1] : lanAddress();
  if (!host) { console.error('Could not find this computer\'s LAN address. Pass it: npm run backend:local -- --host <address>'); process.exit(1); }
  const { port, key } = localStack();
  const header = '# Written by `npm run backend:local` (scripts/use-backend.mjs). Development builds only.\n# Remove with `npm run backend:cloud`. Gitignored; never commit.\n';
  writeFileSync(MOBILE, `${header}EXPO_PUBLIC_SUPABASE_URL=http://${host}:${port}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${key}\n`);
  writeFileSync(DASHBOARD, `${header}VITE_SUPABASE_URL=http://127.0.0.1:${port}\nVITE_SUPABASE_ANON_KEY=${key}\n`);
  console.log(`Mobile app (development builds) → http://${host}:${port}`);
  console.log(`Dashboard (vite dev)            → http://127.0.0.1:${port}`);
  console.log('\nRestart Metro with a clean cache so the app picks it up:  cd apps/mobile && npx expo start -c');
  console.log('A phone must be on the same network as this computer, and the computer\'s firewall must allow port ' + port + '.');
} else if (mode === 'cloud') {
  for (const f of [MOBILE, DASHBOARD]) rmSync(f, { force: true });
  console.log('Local overrides removed. Development builds use each app\'s .env again; release builds use .env.production as always.');
  console.log('Restart Metro with a clean cache:  cd apps/mobile && npx expo start -c');
} else if (mode === 'status') {
  // The first file that sets the variable wins, in the order Expo/Vite load them.
  const show = (label, files, name) => {
    const hit = files.map((f) => [f, describe(`${root}${f}`, name)]).find(([, v]) => v);
    console.log(`${label} ${hit ? `${hit[1]}  (from ${hit[0]})` : 'not configured'}`);
  };
  show('Mobile app, development builds:', ['apps/mobile/.env.development.local', 'apps/mobile/.env.local', 'apps/mobile/.env.development', 'apps/mobile/.env'], 'EXPO_PUBLIC_SUPABASE_URL');
  show('Mobile app, release builds:    ', ['apps/mobile/.env.production.local', 'apps/mobile/.env.local', 'apps/mobile/.env.production', 'apps/mobile/.env'], 'EXPO_PUBLIC_SUPABASE_URL');
  show('Dashboard, vite dev:           ', ['apps/dashboard/.env.development.local', 'apps/dashboard/.env.local', 'apps/dashboard/.env.development', 'apps/dashboard/.env'], 'VITE_SUPABASE_URL');
  show('Dashboard, production build:   ', ['apps/dashboard/.env.production.local', 'apps/dashboard/.env.local', 'apps/dashboard/.env.production', 'apps/dashboard/.env'], 'VITE_SUPABASE_URL');
} else {
  console.error('usage: node scripts/use-backend.mjs local [--host <address>] | cloud | status');
  process.exit(1);
}
