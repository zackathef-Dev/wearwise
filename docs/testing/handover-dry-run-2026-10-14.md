# Handover dry run, 13–14 October 2026

**Goal:** confirm that someone who has never seen WearWise can reproduce the system from the
repository and its documentation alone, without the original developer's accounts, keys or
machine.

**Method:** a clean copy of exactly what `git clone` would deliver: tracked and new files,
no `.env` files, no `node_modules`, no build output, no `supabase/.temp`. All local Supabase
state was deleted first (`supabase stop --no-backup`, no Docker volumes left). The README was
then followed step by step, recording every failure. Each failure was fixed in the repository,
and the run was repeated on a second clean copy (pass 2). The hosted project was not touched.

**Machine:** MacBook (Apple silicon), macOS 26.7.1, Node 24.19, Docker Desktop (engine
29.8.2), Supabase CLI 2.120.0, Android SDK 36 with an API 36 emulator, Xcode 27.0 with an
iOS 27 simulator, ESP-IDF 5.4.2. Docker images were already cached, so the multi-GB download
of a true first run wasn't timed.

## Results (pass 1, README runbook)

| Step | What | Result |
|---|---|---|
| 1 | `npm install` (1,169 packages; `ignore-scripts` on) | Pass |
| 2–3 | Docker running; `supabase --version` | Pass |
| 4–6 | `supabase start` on an empty machine: 11 migrations, `seed.sql`, `seed/demo-recordings.sql`, 9 Storage files | Pass (29 s with cached images): 3 simulated sessions, 9 objects, 3 demo accounts |
| 7 | `npm run backend:local`, `backend:status` | Pass: LAN IP for the phone, 127.0.0.1 for the dashboard, release builds "not configured" |
| 8 | Dashboard: demo researcher sign-in, Participants, session charts from Storage, Alerts | Pass: only the sharing participant visible; simulated banner; fall and high-HR alert shown; no console errors |
| 9 | `npx expo run:android --device <AVD>` (fresh install on the emulator) | Pass: sign-in screen, no "backend not configured" |
| 10 | Create an account in the app | Pass: signed straight in; profile created by the trigger (participant, terms 2026-10-17, 18+ recorded) |
| 13 | No hardware: **Use Simulation** | Pass |
| 14 | Live data on Home | Pass: ECG strip, HR, SpO₂, temperature, movement, all labelled simulated |
| 15 | Record, stop, History, session detail | Pass after finding F2 (UI blocked by simulated falls). Session saved, 0 gaps |
| 17 | Sync after stop | Pass: uploaded within seconds (session, 5 channels, 5 Storage files, 8 fall events) |
| — | Session restore (app force-stopped and reopened) | Pass: still signed in |
| 16 | Offline: `supabase stop`, record a session | Pass: recorded normally; Home showed 1/2 backed up |
| 17 | Backend back (`supabase start`), app in the foreground | Pass: the offline session uploaded by itself about 15 s later |
| — | Sign out, then sign in as the demo participant | Pass: sign-out cleared the form; restore downloaded both seeded sessions into History (CRC-checked); other account's sessions not shown |
| 18 | Share code → researcher redeems it in the dashboard | Pass: "New Developer is now sharing data with you", with exactly the chosen signals (the code was created through the same RPC the app's button calls) |
| §11 | Unit tests and typechecks | Pass: mobile 40 suites / 283 tests; dashboard 110 + 49 tests |
| §11 | Database suites on the real local stack | Pass: 277 plain-SQL checks + 8 pgTAP (after the pre-run fixes below) |
| §12 | Dashboard production build with an owner's https backend | Pass: build refused until `npm run deploy-config`, then built; CSP names only that backend |
| §12 | Android release with a local `http` backend | Correctly **refused** ("Production backend must be an HTTPS URL…") |
| §12 | Android release with an https backend + a newly generated keystore | Pass (about 7 min). APK: cleartext off, backup off, not debuggable; no local URLs, developer paths, names, demo credentials or the original project in the bundle. Keystore and `key.properties` stayed untracked |
| §10 | Firmware from source: `idf.py set-target esp32 && idf.py build` | Pass (36 s) after finding F4 (this machine's ESP-IDF install). App image 1,146,016 bytes, the same size as the bundled 0.9.6 image |
| §10 | Firmware host test; `npm run firmware:export -w dashboard` | Pass (the export records the commit when built from a git checkout) |
| iOS | `npx expo run:ios --device "<simulator>"` | Build succeeded (0 errors, 0 warnings, 2 min 36 s), installed, launched to the sign-in screen with no configuration error. **Sign-in over local http on iOS not verified**: no UI automation was available on this machine (F6) |

**Pass 2** (second clean copy with every fix, local state wiped again): `npm install`,
`supabase start`, `backend:local`, all database suites (277 + 8), `sync-live.mjs` against the
local stack (7/7), unit tests (283; 110 + 49), and the dashboard against the rebuilt backend.
All passed.

## Findings and fixes

Found while building the local backend, before the dry run:

| # | Finding | Fix |
|---|---|---|
| P1 | No `supabase/config.toml`: the hosted project's auth settings existed only in its dashboard | `supabase init` + WearWise values (password ≥ 10, redirect URLs, site URL), documented |
| P2 | The mobile app refused any backend but `https://*.supabase.co`, so neither local nor self-hosted could work | `public-config.ts`: any https host; http only in development builds and only to local/LAN hosts; release check accepts any public https host |
| P3 | The dashboard's CSP hard-coded the original project; a test failed when `.env` pointed elsewhere | Headers generated by `scripts/deploy-headers.mjs` (`npm run deploy-config`); build-time guard; placeholder host committed |
| P4 | The pgTAP file had never run (no Docker before): a double-quoted string made it fail | Fixed quoting; 8/8 |
| P5 | **A bare `supabase test db` would have run the Docker-free stub against a real stack, granting anon and authenticated full default privileges** | Plain-SQL suites and the stub moved to `supabase/sql-tests/`; `supabase/tests/` holds only pgTAP + API scripts |
| P6 | The plain-SQL suites assumed the stub: Storage's delete-protection trigger, `pg_read_file`, dblink without a password, `auth.sessions.id` without a default, counts that included seeded rows | Made portable; new runner `supabase/sql-tests/run-on-local-stack.sh`; standalone harness still passes |
| P7 | Admin/test scripts and `.mcp.json` hard-coded the original project | `SB_PROJECT_REF` / `SB_URL`; `.mcp.json` untracked |

Found during the dry run:

| # | Finding | Fix |
|---|---|---|
| F1 | README described `supabase start`'s output in one CLI output format | Wording made format-neutral |
| F2 | The simulated patch injected a fall every 25 s, shorter than the alarm's 30 s countdown: an alarm covered the screen almost permanently, and Stop recording was hard to reach | Simulated falls now at ~12 s, then every 3 min (`signals.ts`), with a unit test; documented |
| F3 | Several Android devices connected: the run command needs a device name | README: `npx expo run:android --device <name>` |
| F4 | ESP-IDF on this Mac: `export.sh` picked the system Python 3.9 while ESP-IDF was installed with 3.12; cmake/ninja came from a separate environment | Machine-specific (the documented `install.sh` installs both); troubleshooting rows added |
| F5 | Development builds on *any* device load JavaScript from the Metro on this computer, so starting the local backend's Metro moved another phone's development build to the local backend | README note + troubleshooting row (`backend:cloud`, restart Metro) |
| F6 | iOS sign-in against the local backend couldn't be automated here (headless simulator, no Screen Recording permission for automation) | Remains a manual check (below) |
| F7 | The universal release APK is ~190 MB | deployment.md: AAB, or one architecture for sideloading |
| F8 | Home's "Backed up x/y" counts an in-progress recording as backed up until it stops | Not changed (cosmetic); listed as a known issue |
| F9 | RPC parameter names (`p_…`) weren't in the docs | database.md lists the exact signatures |
| F10 | `npm audit`: 68 advisories (1 critical) in transitive build tooling (Expo CLI, Metro, Jest; `shell-quote`, `braces`, `node-forge`) | Not changed (needs an Expo SDK upgrade); maintenance item |

## Hardware tests on the local backend (14 October, Samsung SM-G977N + patches)

The Samsung's development build was pointed at the local stack (`npm run backend:local`, Metro
restarted). All three patches booted firmware 0.9.6 with passing self-tests: 6280 (all four
sensors, six capabilities), 6F84 (MAX30102 only; "AD8232 not fitted"), 6990 (no sensors).

| # | Test | Result |
|---|---|---|
| H1 | Phone reaches the local API over the LAN (macOS firewall on) | Pass (HTTP 200 from the phone) |
| H2 | Create an account on the phone against the local backend | Pass |
| H3 | Connect 6F84 over BLE (existing bond, no PIN): capability discovery | Pass: HR, SpO₂, pulse wave only; "This sensor has no ECG" |
| H4 | Record over BLE (6F84) and sync | Pass: not simulated, transport bluetooth, 4,417 PPG samples, 3 Storage files |
| H5 | Switch to 6280 (the old link is ended first) and connect | Pass: all six signals live: ECG "electrodes not attached", HR/SpO₂ waiting for a finger, skin temperature 22.8 °C, movement 1.00 g |
| H6 | Reconnect: 6280 reset mid-recording | Pass: patch rebooted (new boot ID), phone reconnected ~4 s after boot (encrypted, authenticated, bonded, 128-bit key), START re-sent, same session continued, the outage counted as 55 gaps; session uploaded (80 s, temperature 141 samples, PPG 7,106) |
| H7 | Share code redeemed by the researcher in the dashboard; phone lists the researcher | Pass |
| H8 | Live view over the local Realtime: dashboard shows the patch (WearWise-6280 · Bluetooth · Firmware 0.9.6), leads-off ECG, temperature, movement | Pass |
| H9 | Researcher asks for a recording → phone prompt → Start → researcher stops it | Pass: "Demo Researcher stopped the recording they asked for"; session uploaded |
| H10 | Researcher stops live view | Pass: "Live view switched off because everyone watching stopped" |
| H11 | Heart rate and SpO₂ with a fingertip on 6280, recorded and synced | Pass: first reading 102 BPM / 89 % (settling, as known), then 91 BPM / 100 %, both "Normal"; session uploaded with 44 HR samples (avg 91.9 BPM) and 44 SpO₂ samples (avg 97.2 %). No vital alert opened: the brief high reading didn't last its sustain time, by design |
| H12 | Wi-Fi streaming: the participant enters the network on the phone; 6280 joins and streams over pinned TLS | Pass: "Data is streaming over Wi-Fi now"; Home showed "Live · Wi-Fi"; a 32 s recording uploaded with transport wifi → wifi, 1,580 movement samples (50 Hz, none lost), 5 Storage files |
| H13 | Fresh PIN pairing: app Forget, OS bond removed, BOOT pressed, label PIN typed | Pass: Android shows a new bond for WearWise-6280; app live over Bluetooth |

Pulse-wave samples in the fingertip session reach the int16 limits during placement: the firmware
clamps out-of-range values by design (placement transients are ~25× a beat). The Samsung was
switched back to the hosted backend afterwards (`npm run backend:cloud`, Metro restarted) and
reopened signed in to its own account.

Observation: the session's `configuration_snapshot.firmwareVersion` is empty for BLE sessions
(the app fills it in the live-view status, not in the recording snapshot).

## Hosted project compared with the migrations (14 October)

`supabase/admin/schema-fingerprint.sql` was run read-only against the original hosted project
(`supabase db query --linked --project-ref …`, Postgres 17.6) and against a local build of the 11
migrations (Postgres 17.11):

| Area | Result |
|---|---|
| columns, rls, policies, triggers, grants, bucket, realtime, terms | **identical** |
| functions | 25 of 26 identical. `public.list_my_access_grants()` differs only by a two-line SQL comment that migration 9 contains and the hosted copy lacks; the SQL itself is the same |

The hosted database therefore matches the migrations in everything that affects behaviour.
No change was made to it. (The CLI creates a short-lived login role on the project to run
linked queries; that is its normal behaviour.)

## Still to verify by hand (needs hardware or a person)

- ECG with electrodes on a person (the board on battery or power-bank power only, never on a
  mains-powered computer).
- iOS: sign-in and sync against a local `http://<LAN-IP>:54321` backend on the simulator and
  on an iPhone (Local Network permission prompt), plus a TestFlight/Archive build with the
  owner's Apple team.
- Patch setup in Chrome with a USB-connected patch, from a dashboard started on the owner's
  machine.
- A true first run with nothing cached (the image download time).

