# WearWise knowledge transfer

The practical handover guide for the project owner and future developers. It explains how
WearWise works and why, how to run and change it, and what to watch out for. Each section
points to the detailed document. The root [README](../README.md) has the step-by-step setup.
The same handover, with what is handed over, its verification and the owner's first steps, is
also a PDF: [`guides/WearWise-Handover-Documentation.pdf`](guides/WearWise-Handover-Documentation.pdf).
Index of all documents: [README.md](README.md). Exactly what is handed over:
[HANDOVER-MANIFEST.md](HANDOVER-MANIFEST.md).

**Status at handover (October 2026):** firmware 0.9.6, mobile app 0.1.0 (Expo SDK 57), web
dashboard 0.1.0, 11 database migrations. WearWise is a **capstone research prototype**: not
a medical device, measurements not clinically validated, and fall detection reports a
*possible fall* only.

**Project context:** La Trobe University CSE3CAP Capstone Project. **Project Owner:** Shanmuga
Sundar Dhanabalan, Deputy Director, CTI, La Trobe University, who provided the original project brief and
initial project context. The WearWise Project Team made the implementation and prioritisation
decisions during development.

**Designed and implemented by the WearWise Project Team**, the student development team ([TEAM.md](../TEAM.md)): Zakiul Atheef (Project Lead,
Scrum Master, Technical, Security Engineering and Integration Lead), Hari Bethelli (Cloud &
Data Engineer), Siri Bethelli (UI/UX & Data Visualisation Engineer) and Thevindu Kodagoda
Munasinghage (Security Engineer, Documentation Lead, QA & Testing Lead). Licensed under the
PolyForm Noncommercial License 1.0.0 ([LICENSE](../LICENSE)): free for noncommercial use, not for
sale.

---

## A. System overview

![WearWise system architecture](images/architecture.svg)

A participant wears an ESP32 **patch** with up to four sensor modules: MAX30102 (heart
rate, SpO₂, pulse wave), MAX30205 (skin temperature), MMA8452Q (movement, used for
possible-fall detection) and AD8232 (ECG). The **phone app** pairs with it over Bluetooth
using the PIN on the patch's label. It shows live readings and records sessions into an
encrypted database on the phone. When online, it uploads finished sessions to a
**Supabase** backend. A participant can create a one-time **share code**. A researcher
redeems it in the **web dashboard** and from then on can read the shared signals, see alerts
and falls, and, while the participant allows it, watch **live view**. Either side can end
the sharing.

Read: [architecture.md](architecture.md).

## B. Major architectural decisions

1. **Offline-first, phone as source of truth.** Recording must never depend on the network.
   The cloud is an upload-only mirror, plus a restore path for a new phone.
2. **The patch has no backend knowledge.** It speaks only to the phone, so the backend can
   move without touching firmware.
3. **One binary protocol with a shared fixture.** Firmware and app test against the same
   `packages/sensor-protocol/fixtures/v1.json`.
4. **Capability discovery.** The firmware reports what it detected; nothing assumes a sensor
   is there.
5. **Security in Postgres (RLS), not in the clients.** The publishable key is public by
   design.
6. **No custom server code.** RPCs, triggers and policies replace an API server; there are no
   Edge Functions and no server secrets of our own.
7. **Configuration selects the environment** (local, owner's cloud, self-hosted). Release
   builds are HTTPS-only.

Read: [architecture.md](architecture.md#key-design-decisions), `docs/architecture/offline-first.md`.

## C. Mobile application

React Native 0.86 + Expo SDK 57, TypeScript, expo-router, zustand. Layers: `app/`
(screens), `features/` (state per feature), `domain/` (pure logic: recording engine, sync
engine, fall detector, vitals), `data/` (BLE, Wi-Fi, SQLCipher store, Supabase), `platform/`
(secure storage, notifications). Runs as a development build (`npx expo run:android|ios`),
never Expo Go. A simulated patch exercises everything without hardware.

Read: [mobile-app.md](mobile-app.md).

## D. Firmware

ESP-IDF 5.4 C project, `firmware/wearwise-esp32/`. `SensorManager` scans I²C and verifies
chip IDs. Drivers implement one vtable (`WearWiseSensor.h`). `gatt.c` is the Bluetooth
service, `ble_pairing.c` the PIN and pairing rules, `ws_server.c` the optional Wi-Fi stream.
Version in `FirmwareConfig.h`. Installed without a toolchain from the dashboard's Patch setup
page, which also writes the label PIN.

Read: [firmware.md](firmware.md).

## E. Sensors

| Sensor | Signals | Notes |
|---|---|---|
| MAX30102 | heart rate (1 Hz), SpO₂ (1 Hz), PPG (100 Hz) | on-device HR pipeline; SpO₂ uncalibrated |
| MAX30205 | skin temperature (2 Hz) | |
| MMA8452Q | movement magnitude (50 Hz) | the phone detects possible falls from it |
| AD8232 | ECG (250 Hz) | education only; battery power only with electrodes on a person |

Pins: I²C SDA 21 / SCL 22; AD8232 34 / 32 / 33; MMA8452Q INT1 27 (reserved); SPI 18/19/23
reserved. Read: [hardware.md](hardware.md).

## F. BLE protocol

One GATT service (`57570000-5757-4b57-8000-574541525753`) with INFO, CAPS, CONTROL, DATA,
WIFI and TLS characteristics, all requiring an encrypted, PIN-authenticated link. Data
packets are a 58-byte header plus int16 samples plus a CRC-32, at most 462 bytes. Wire codes
1–6 never change meaning.

Read: [ble-protocol.md](ble-protocol.md).

## G. Local database (on the phone)

op-sqlite with SQLCipher, key in the OS secure store. Inline schema migrations v1–v9 in
`apps/mobile/src/data/local/sqlite-session-store.ts`. Sample chunks are stored exactly as
received, with CRC. Changing the local schema means adding a migration step there (never
editing an old one) and a test in `src/data/local/__tests__/`.

Read: [mobile-app.md](mobile-app.md#local-storage), `docs/database/local-schema.md`.

## H. Supabase backend

Postgres 17 with RLS, Auth (email and password), a private Storage bucket `recordings`, and
Realtime (postgres changes for alerts and falls; private broadcast for live view). Nine
tables, around 15 RPCs, a sign-up trigger. Everything is created by `supabase/migrations/`,
and `supabase/seed.sql` + `supabase/seed/` add synthetic local demo data.

Read: [database.md](database.md).

## I. Authentication

Email and password via Supabase Auth, with a 10-character minimum on the server. Sign-up
metadata must declare consent, 18+ and a known terms version, or the server's trigger
refuses it. Email confirmation is on for hosted projects and off locally. Links come back
through `wearwise://auth/*` (PKCE). Researchers and clinicians are created by an
administrator (`supabase/admin/create-viewer.sql`); there's no self-service role change.

## J. RLS and security

Every table has RLS and least-privilege grants. `anon` can do nothing. Participants own
their rows. Viewers read only what a live grant covers. Writes require an active,
18+-confirmed account. Storage paths must be `<uid>/<session>/<channel>.wwch`. Verified by
277 SQL checks plus pgTAP on a real local stack, and by the API-level sync test.

Read: [database.md](database.md#row-level-security), [security.md](security.md).

## K. Local development

```bash
npm install
supabase start                 # Docker running
npm run backend:local          # point both apps at it
npm run dev -w dashboard       # http://localhost:5192 (demo.researcher@example.invalid / wearwise-demo-only)
cd apps/mobile && npx expo run:android
```

Day to day: `supabase db reset` rebuilds the database; `npm run backend:status` shows what
each app talks to; `npx expo start -c` restarts the bundler after a config change.

Read: [README](../README.md) sections 4–9.

## L. Cloud deployment

Create a project under the organisation's Supabase account, `supabase link` +
`supabase db push`, apply the settings (email confirmation, SMTP, redirect URLs, Realtime
private-only), create the first researcher with the admin SQL, and point the apps at it.
Self-hosted Supabase works the same way over HTTPS. Never push the demo seed, and never run
`supabase config push` with the local config.

Read: [deployment.md](deployment.md).

## M. Building Android

JDK 17 and Android SDK 36. Development: `npx expo run:android`. Release:
`.env.production` (https), your own keystore (`node scripts/create-release-signing.cjs`,
then back it up), `npx expo prebuild --platform android`, then
`NODE_ENV=production ./gradlew assembleRelease` (or `bundleRelease`). The build refuses a
non-HTTPS backend or a missing key.

Read: [deployment.md](deployment.md#android-windows-macos-or-linux).

## N. Building iOS

macOS, Xcode and CocoaPods. Development: `npx expo run:ios`. Release:
`npx expo prebuild --platform ios`, open `ios/WearWise.xcworkspace`, choose your team (change
the bundle identifier if it's taken), and Archive. Check `.env.production` with
`node scripts/check-release-config.cjs` first.

Read: [deployment.md](deployment.md#ios-macos-with-xcode).

## O. Adding a new sensor

1. Firmware: a driver implementing `WearWiseSensor.h`, registered in `SensorManager.c`
   behind a `WW_ENABLE_*` flag ([firmware.md](firmware.md#adding-a-new-sensor)).
2. If it's a **new kind of measurement**: the next free wire code (7 or 8) with scale and
   unit in both `communication/protocol.{c,h}` and `packages/sensor-protocol/src/types.ts`,
   then regenerate fixtures (`npm run fixtures -w @wearwise/sensor-protocol`).
3. App and dashboard: labels, units, ranges (`apps/mobile/src/domain/vitals/`), charts.
4. Backend: widen the sensor-code checks in a **new migration**
   (`vital_alerts.sensor_type between 1 and 6`, `private.valid_sensor_types`).
5. Tests: firmware boot self-test, `npm test -w mobile`, the SQL suites, and a
   hardware-matrix row.

## P. Adding a database field or table

1. `supabase migration new <name>`; write the SQL. A new table needs RLS, explicit grants to
   `authenticated` (default privileges are closed), policies for each operation, and indexes
   on foreign keys.
2. `supabase db reset`; add checks to a `supabase/sql-tests/*.local.sql` suite; run
   `bash supabase/sql-tests/run-on-local-stack.sh`.
3. Update the app's sync gateway / types and the dashboard's queries (`apps/dashboard/src/data/`).
4. Document it in [database.md](database.md). Hosted: `supabase db push`.
5. Never edit an applied migration. Add a new one.

## Q. Troubleshooting

[troubleshooting.md](troubleshooting.md) covers the backend, app↔backend connectivity
(phones and `localhost`), the dashboard, Patch setup, pairing, readings, and builds. The
real-device test reports in `docs/testing/` record what was tested on hardware and what
failed.

## R. Security responsibilities

The owner creates and keeps all secrets: the Supabase project and database password,
service keys, access tokens, SMTP credentials, the Android keystore, and Apple signing.
None are in the repository. Before real participants: ethics approval, the organisation's
own Supabase project and settings, organisation details in `packages/legal/src/org.ts`,
backups, account management, and an independent security review.

Read: [security.md](security.md).

## S. Known limitations

The authoritative, current list is [known-limitations.md](known-limitations.md). In short: a
research prototype with measurements that are not clinically validated (SpO₂ uncalibrated,
heart rate slow to settle), a threshold-based possible-fall heuristic, BLE only (NFC deferred
by the team), one active wearable at a time (a team decision for the proof of concept), unencrypted
patch flash, no staff MFA or sign-up abuse protection, no retention or purge, and less iOS
device testing than Android.

## T. Future improvements

- Calibrate SpO₂ against a reference pulse oximeter, and validate heart rate against a
  reference (the AD8232 on the same board is a good start: `docs/HRValidation.md`).
- Hold back heart rate until the estimate has settled.
- Emergency-contact notification for falls, and interrupt-driven motion (MMA8452Q INT1 on GPIO27).
- NFC connectivity and several patches streaming at once (deferred by the team for the
  proof of concept).
- More sensors through the driver interface; an SPI sensor on the reserved pins.
- MFA for staff accounts; a column-limited view for viewers; read audit logging.
- Retention controls and data export for participants.
- Over-the-air firmware updates.
- CI runs the app, dashboard, database and firmware checks and a secret scan on every push
  (added at handover); extend it with an iOS build and on-device tests if a device farm is available.
- An independent security review before any wider use.

## Maintenance checklist

| How often | Do |
|---|---|
| Every change | Unit tests (mobile, dashboard); database suites if SQL changed |
| Every release | Bump versions (app `version`/`versionCode`, `WW_FW_VERSION`); run the hardware matrix rows touched; `npm run firmware:export -w dashboard` if firmware changed |
| Every few months | Update Expo SDK, React Native, Supabase CLI and images, ESP-IDF; check `npm audit`; rerun everything, including the handover dry run (`docs/testing/handover-dry-run-2026-10-14.md`) |
| When terms change | New `ACCEPTANCE_VERSION` in `packages/legal` plus a migration adding it to `private.terms_versions`, applied before the apps ship |
| When people leave | Suspend or delete their accounts; rotate any credential they held |
