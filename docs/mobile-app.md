# WearWise mobile app

The participant app: `apps/mobile/`. React Native 0.86 (New Architecture, Hermes) on
**Expo SDK 57**, TypeScript (strict), Android and iOS from one codebase. It is a
**research prototype** that shows prototype sensor measurements. It doesn't diagnose.

## Running it

See the root [README](../README.md) for the full first-time setup. In short:

```bash
npm install                       # repository root (npm workspaces)
npm run backend:local             # or keep apps/mobile/.env for a hosted backend
cd apps/mobile
npx expo run:android              # first time: builds and installs a development build
npx expo start -c                 # afterwards: just the JS bundler (Metro)
```

`expo run:ios` builds for the iOS simulator or a connected iPhone (macOS with Xcode only).
There is no Expo Go support: the app uses native modules (Bluetooth, SQLCipher, Skia, a
pinned WebSocket), so it always runs as its own development build.

| Script (`apps/mobile`) | Command | What |
|---|---|---|
| `npm start` | `expo start` | Metro bundler for an installed development build |
| `npm run android` / `ios` | `expo run:android` / `expo run:ios` | Build, install and start a development build |
| `npm run typecheck` | `tsc --noEmit` | Strict type check |
| `npm run lint` | `expo lint` | ESLint |
| `npm test` | `jest` | Unit tests (also runs `packages/sensor-protocol`'s tests) |

## Configuration (which backend)

The app reads exactly two values, both at bundle time:

| Variable | Example | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co`, `https://supabase.example.org`, or `http://192.168.1.20:54321` (local) | `http://` is accepted **only in development builds** and only for loopback, `10.0.2.2`, private LAN ranges or `*.local` hosts |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the project's publishable / anon key | A `service_role` or `sb_secret_` key is refused |

They come from env files that Expo loads in this order (first match wins):

| File | Used by | Written by |
|---|---|---|
| `.env.development.local` | development builds only | `npm run backend:local` (deleted by `npm run backend:cloud`) |
| `.env.production` | release builds (`NODE_ENV=production`) | you; checked by `scripts/check-release-config.cjs` on every Android release build |
| `.env` | everything else | you, from `.env.example` |

All of them are gitignored. With no configuration, the app runs and says the backend isn't
configured on the sign-in screen. It never silently uses another backend. Values are
baked in when Metro bundles, so restart Metro with `-c` after changing them.

Validation: `src/data/remote/public-config.ts` (runtime) and
`scripts/check-release-config.cjs` (release builds: HTTPS on a public host only).

## Structure (`apps/mobile/src`)

```
app/            screens (expo-router, file-based routes)
  sign-in, register, reset-password, auth/[action] (email-link landing), confirm-account (18+/terms),
  legal/, (tabs)/{home, alerts, devices, history, profile}, pair, wifi, session/[id], health,
  notifications, privacy
features/       state + UI logic per feature (zustand stores): authentication, monitoring, sync,
                live-view, alerts, fall, notifications, profile, legal, splash
domain/         pure logic, no React Native: entities, recording engine, sync engine,
                fall detector, vitals (ranges, alert text), repository interfaces
data/           adapters: ble/ (react-native-ble-plx), wifi/, transport/ (BLE ↔ Wi-Fi coordinator),
                local/ (SQLCipher store + migrations), remote/ (supabase-js), sync/ (chunk container),
                simulation/ (simulated patch), repositories/
platform/       secure storage, crypto, notifications, alarm sound, key-value prefs (MMKV)
shared/         components, charts (Skia), icons, theme, validation (zod)
modules/        local native module: pinned-websocket (Android Kotlin, iOS Swift)
plugins/        Expo config plugins: release hardening, local notifications, iOS scene lifecycle
```

The domain layer has no React Native or Supabase imports. It talks to ports
(`domain/repositories/*`) that `data/` implements, so it is unit-tested without devices.

## Authentication and accounts

- **Supabase Auth, email and password.** Sign-up sends the display name plus the consent,
  18+ and terms declarations as user metadata. The server's sign-up trigger refuses an
  account without them (see [database.md](database.md)).
- **Email confirmation:** if sign-up returns no session, the app shows "Check your email".
  Confirmation and password-reset links open the app through `wearwise://auth/confirmed` and
  `wearwise://auth/reset` (PKCE code exchange in `app/auth/[action].tsx`). These URLs must be
  on the backend's redirect allow-list.
- **Session:** stored by supabase-js in the OS secure store (`expo-secure-store`, Keychain /
  Keystore, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). It's restored at launch with
  `auth.getUser()`. Sign-out is local and wipes stored keys even when offline.
- **Accounts that predate a rule** (18+, a newer terms version) are sent to
  `confirm-account` once, which calls the `confirm_adult` / `accept_terms` RPCs.
- The app is for **participants**. Researchers and clinicians use the web dashboard.

## Bluetooth (BLE)

`src/data/ble/ble-sensor-transport.ts` with **react-native-ble-plx**:

- Scans filtered by the WearWise service UUID (12 s), connects, requests MTU 517.
- Pairing is done by the operating system with the patch's 6-digit **label PIN**. The app
  keeps retrying its first read for up to 60 s while the person types, and explains a
  refused pairing step by step (`pairing-help.ts`).
- Reads INFO (identity, firmware) and CAPS (capabilities), validated in
  `validate-discovery.ts`, then writes START with a session ID and the chosen signals.
- Reconnects up to 8 times with backoff, resuming the same session.
- **Wi-Fi path:** the phone gives the patch Wi-Fi details over BLE, then streams from
  `wss://<patch-ip>/stream` with the patch's certificate pinned (native `pinned-websocket`
  module). It falls back to BLE if Wi-Fi drops. Details: [ble-protocol.md](ble-protocol.md).
- **Simulated patch:** `data/simulation/simulated-transport.ts`. **Use Simulation** on the
  Devices tab (or **Use simulated data instead** on the Pair screen) runs the whole app
  without hardware. Simulated data is always
  labelled as simulated on screen and in the database (`simulated = true`). The simulated
  movement signal contains a textbook fall about 12 s after each stream start and then
  every 3 minutes, so the possible-fall alarm can be tested. The stream starts again from
  the beginning whenever streaming (re)starts: on connecting, when a recording starts, and
  when it stops and the live preview resumes. So expect the alarm about 12 s into every
  recording and again just after it. Answer **I'm OK**, or let it time out.

Android asks for *Nearby devices* (Bluetooth scan/connect, with `neverForLocation`); iOS asks
for Bluetooth and, for the Wi-Fi stream, Local Network. Emulators and simulators have no
Bluetooth: use the simulated patch there.

## Sensor data processing

Every packet is CRC-checked and decoded by `@wearwise/sensor-protocol`. Sequence numbers are
tracked per session and signal (gaps and duplicates are counted, never hidden). The
recording engine writes chunks to the local database as they arrive, and live charts are
drawn with Skia on the UI thread. Vital ranges and alert text live in `domain/vitals/`. High
and low alerts open, update their peak, and close.

**Possible-fall detection** runs on the phone (`domain/fall/fall-detector.ts`) on the
movement stream: free fall, then impact, then stillness. It raises a full-screen alarm with
sound and vibration and a 30 s countdown. "I'm OK" cancels it; otherwise it becomes an
emergency. It is a prototype heuristic and can miss falls or raise false alarms. Nothing is
sent outside WearWise: there are no SMS, calls or emergency-service alerts. Researchers see
each step live while live view is on, and later as a fall event on an uploaded recording
if the participant shares falls.

## Local storage

- **op-sqlite with SQLCipher.** The database key is 32 random bytes kept in the secure store
  (`platform/secure-storage/database-key.ts`). If the store can't open, the app runs
  memory-only and says so.
- Schema migrations are inline in `src/data/local/sqlite-session-store.ts` (versions v1–v9,
  version kept in `app_metadata`).
- Tables: `devices`, `device_capabilities`, `sessions`, `session_channels`, `sample_chunks`,
  `sync_queue`, `session_sync`, `connection_events`, `fall_events`, `alerts`,
  `health_profile`, `notifications`, `app_metadata`.
- Android backup is off (`allowBackup=false`). Release builds also block screenshots
  (`FLAG_SECURE`), and the iOS app switcher shows a privacy cover.
- There's no automatic retention or purge. Participants delete sessions themselves
  (History).

## History and sync

- **History** lists local sessions. A session's detail screen draws every channel from the
  local chunks.
- **Sync** (`domain/sync/sync-engine.ts`, scheduled by `features/sync/auto-sync.ts`) uploads
  finished sessions: the session row, each channel's file
  (`recordings/<user>/<session>/<channel>.wwch`, a CRC-checked container of the raw
  samples), the channel row, and fall events. Vital alerts go up on their own within a few
  seconds of changing.
- Triggers: sign-in and app start, return to the foreground, a recording being saved.
  While uploads are pending it retries with backoff in the foreground. Every write is an
  upsert by UUID, and progress is recorded per channel, so a retry after a crash or a
  network drop resumes and never duplicates.
- **Offline:** recording, live charts, alerts and the fall alarm need no network. Sessions
  queue and go up when the backend is reachable again.
- **Restore:** on a phone with no local copy (new phone, reinstall), sessions in the cloud
  are downloaded, verified and added. Nothing local is ever overwritten.

Supabase calls: `data/remote/supabase-sync-gateway.ts` (tables `recorded_sessions`,
`recorded_channels`, `fall_events`, `vital_alerts`; bucket `recordings`),
`data/remote/sharing.ts` (share-code RPCs), `data/repositories/supabase-auth-gateway.ts`
(auth, `profiles`), `data/remote/live-channel.ts` (Realtime).

## Sharing and live view

- **Privacy & access** (Profile): create a one-time share code with chosen signals (24 h,
  single use), see who has access, change their scope, or revoke it.
- **Live view:** the participant starts it on Home for a chosen time (30 min to 8 h). The
  phone broadcasts readings, status, falls and recording state on the private channel
  `live:<grant id>`. A researcher can ask for a recording (the phone asks the participant)
  and can stop live view. Nothing is stored. Contract: `docs/architecture/live-view-and-alerts.md`.

## Android and iOS differences

| | Android | iOS |
|---|---|---|
| Build on | Windows, macOS, Linux (JDK 17, Android SDK 36) | macOS with Xcode only |
| Bluetooth permission | Nearby devices (Android 12+); location only on Android ≤ 11 | Bluetooth always-usage |
| Wi-Fi stream permission | none | Local Network prompt (iOS 14+) |
| Pairing prompt | "Pair with WearWise-…?" then a PIN box (can suggest 0000/1234: ignore it, use the label PIN) | PIN box |
| Plain http to a local backend | debug builds only (`usesCleartextTraffic` true only in the debug manifest; the release manifest forces false) | allowed to local-network addresses (`NSAllowsLocalNetworking`, the Expo default); the app itself refuses http in release builds |
| Screenshots in release | blocked (`FLAG_SECURE`) | app-switcher privacy cover |
| Release signing | your own keystore (`node scripts/create-release-signing.cjs`) | your Apple team in Xcode |

Building releases: [deployment.md](deployment.md#mobile-app-release-builds).

## Tests

`npm test` in `apps/mobile` runs 39 Jest suites (282 tests at handover): the domain
(recording, sync, fall detection, vitals), the BLE and Wi-Fi transports against fakes, the
local store, auth flows, live view, and `packages/sensor-protocol` (codec, fixtures,
sequence tracking). Bluetooth pairing, real sensors and phone notifications need a physical
device. See `docs/testing/hardware-test-matrix.md` and `docs/testing/real-device-2026-10-13.md`.
