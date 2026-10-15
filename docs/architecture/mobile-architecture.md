# WearWise mobile architecture

> **Design notes from Milestone 3.** For the current structure of the phone app, read
> [`docs/mobile-app.md`](../mobile-app.md); where they differ, `mobile-app.md` is right.

_Milestone 3 state. This document grows with the code; it is not a plan for code
that does not exist yet._

## Shape

Monorepo by npm workspaces:

```
Dss Wearable/
├── apps/mobile          Expo SDK 57 app (React Native 0.86, New Architecture)
├── packages/design-tokens   generated from design-system/tokens/*.css
├── packages/sensor-protocol packet envelope, codec, CRC, sequence tracking, firmware fixtures
└── design-system/tokens  canonical brand tokens (CSS)
```

> Handover note: the React web mockup (`app/`) and the rest of the design system (components,
> UI kits, guidelines) were the visual/behavioural reference during development. They are design
> material kept by the project team and are not part of the handover repository.

## The token pipeline

```
design-system/tokens/*.css  ──node packages/design-tokens/scripts/generate.mjs──▶
packages/design-tokens/src/generated/{colors,layout,motion}.ts
```

- One source of truth. The web mockup reads the CSS; the mobile app reads the
  generated TS. A palette change lands on both by regenerating.
- The generator strips CSS comments before parsing (a comment that *mentions* a
  token once swallowed the real declaration that followed it), resolves `var()`
  chains, and emits complete light + dark palettes so the app never merges layers at
  runtime.
- `layout.ts` carries px as numbers; em-tracking stays a string and is converted per
  font size by `tracking()` at the call site, because RN letterSpacing is px.

## Theme

`data-theme` on the web becomes `ThemeProvider` here — the same three-state model
the mockup proved: explicit `light`/`dark` choice (persistence lands with MMKV), or
follow the OS live until a choice is made. Dark is the tie-break default: the night
canvas is the participant app's shipping look.

## Screens (Milestone 1 slice)

Expo Router, file-based:

```
src/app/_layout.tsx    fonts (bundled Poppins TTFs), ThemeProvider, Stack
src/app/index.tsx      splash → replace to /sign-in (timer; session restore in M2)
src/app/sign-in.tsx    brand + actions; form and Supabase Auth in M2
src/app/home.tsx       greeting + latest-readings strip from tokens; simulated,
                       and labelled as simulated on screen
```

Rules already in force (from §8 of the build instruction):

- Screens take colour/spacing/type from `@wearwise/design-tokens` — no literals.
- Screens compose `Typo`/`Button` from `src/shared/components` — no raw styled Text.
- `Typo`'s variant prop is named `variant`, **not** `role` — RN's `Text` already has
  an accessibility `role` prop and shadowing it would break screen-reader semantics.

## Decisions of record (Milestone 1)

| Decision | Why | Rejected |
|---|---|---|
| Expo SDK 57 + prebuild + dev-client | Native modules (BLE, SQLCipher) rule out Expo Go; prebuild keeps android/ios generated and reviewable | Bare RN CLI (loses config-plugin ecosystem) |
| `react-native-ble-plx` 3.5.x (M4) | Ships its own Expo config plugin — verified in the tarball | `@config-plugins/react-native-ble-plx` — deprecated, 3+ years stale |
| `@op-engineering/op-sqlite` (M3) | SQLCipher via `OP_SQLITE_USE_SQLCIPHER`, verified in its build.gradle; actively maintained | `react-native-quick-sqlite` — 600+ days stale |
| `@expo-google-fonts/poppins` | TTFs bundled into the binary; no runtime font fetch (offline rule) | runtime Google Fonts fetch |
| Tokens generated, not hand-typed | §7's hand-typed list already disagreed with the design system on one hex (`#F7F9FC` vs canonical `#F8FAFC`) — which is the drift the generator exists to prevent | copying §7's literals |
| `react-native-zeroconf` (M5) — **provisional** | Only maintained mDNS option; 238d stale, no config plugin | — flagged for the M5 spike; SoftAP-first is the fallback |

## Environment (this machine)

- JDK 17 (Temurin) at `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot`
- Android SDK at `C:\Android\Sdk` (platform 36, build-tools 36, platform-tools 37)
- `JAVA_HOME`/`ANDROID_HOME`/PATH persisted as user environment variables
- No macOS: iOS compiles via EAS cloud builds; physical iPhone testing is manual
- Git: initialized 26 Aug 2026 (local only; nothing published)

## Layers (build instruction §8), as actually laid out after Milestone 3

```
src/app/                 Expo Router screens — thin; read stores, call actions
src/features/            zustand stores: authentication, monitoring
src/domain/              entities, ports (AuthGateway, SensorTransport, SessionStore),
                         recording engine, recovery — NO React Native imports
src/data/                port implementations: Supabase auth, SQLite store (SQLCipher),
                         simulated transport, memory store
src/platform/            secure storage (session tokens, DB key)
src/shared/              theme, Typo/Button/Card/FormField, Skia SignalTrace, validation
```

Enforced boundaries, and where they bite:
- A screen never sees a packet, a SQL string, or supabase-js. `monitoring-store`
  is the only owner of a transport and the engine.
- `domain/` compiles without `react-native` on the import path. The engine tests
  run on plain Node timers for that reason.
- Transport swap = `engine.attachTransport(next)`; the session and the sequence
  tracker survive it. That is the mechanism behind §9's "do not restart or
  duplicate an active session".

## Decisions of record (Milestone 3)

| Decision | Why | Rejected |
|---|---|---|
| Simulation produces **bytes**, not objects | the codec, CRC and sequence path run today; M4 only swaps the byte source | a fake that emits `SensorPacket` objects directly (would leave the codec untested until hardware) |
| Chunk = raw wire int16, CRC per chunk | verifiable against exactly what the device sent; uploadable as-is | re-encoding to float32 / JSON |
| Flush at 512 samples **or** 1 s | bounds crash loss to ~1 s/channel; 1 s is the binding limit at every rate we ship | flush per packet (write amplification), flush per 10 s (too much to lose) |
| Chunk closes at every gap and restart | a chunk is internally contiguous by construction; no chunk hides a gap | one chunk per minute regardless |
| u64 timestamps as TEXT in SQLite | SQLite INTEGER is signed i64; TEXT round-trips BigInt exactly | INTEGER (silent corruption of the top bit) |
| Memory-only is a visible **mode**, not a fallback | §25 forbids silent plaintext; memory-only is loud and loses only unsaved data | plaintext SQLite fallback |
| Skia for the live trace | 70 Hz × 6 s redraw at ~5 fps; SVG path re-render stutters on mid-range Android | react-native-svg |
| Interrupted stays interrupted after "Keep" | the session's truth; the user is choosing to retain it, not to relabel it | promoting to `complete` |

## Decisions of record (Milestone 4)

| Decision | Why | Rejected |
|---|---|---|
| Firmware ports the codec + generators to C | one protocol, two implementations kept honest by the shared `fixtures/v1.json`; the ESP32 runs a boot self-test and refuses to advertise if it disagrees | hand-writing bytes on the device (drifts silently from the app) |
| NimBLE, BLE-only, peripheral role only | smallest RAM footprint; the phone is always the central | Bluedroid (heavier), dual-mode (no need for Classic) |
| deviceId = SHA-256(MAC), not the BLE address | the BLE peripheral id differs per phone and can rotate; the protocol id is stable, so a reconnect is the same device | keying on the peripheral id (would fork sessions across phones) |
| BLE keeps streaming state across disconnect | reconnect + same sessionId continues sequence numbers → the phone counts the outage as a gap, one session | resetting on disconnect (new session, lost continuity) |
| `BleSensorTransport` implements the same port as the simulation | the recording engine can't tell them apart; M3's whole pipeline is reused unchanged | a BLE-specific recording path |
| Own base64 codec on the packet path | ble-plx values are base64; avoids a Buffer polyfill on a hot path (~15 notifs/s) | `Buffer`/`react-native-quick-base64` |
| `react-native-ble-plx`'s bundled config plugin | ships in the tarball, adds the Android 12 permission split (`BLUETOOTH_SCAN neverForLocation`) | `@config-plugins/react-native-ble-plx` (deprecated) |

## Decisions of record (Milestone 5 — Wi-Fi)

| Decision | Why | Rejected |
|---|---|---|
| Provision Wi-Fi over the BLE link | credentials ride the already-trusted pairing; never on the air in the clear, never logged (only SSID length) | Wi-Fi SoftAP provisioning portal (more moving parts, exposes an open AP) |
| Firmware fans one packet out to BLE **and** Wi-Fi | the phone's SequenceTracker dedups, so an overlapping handoff has no duplicate packets; each transport is a pipe | phone re-requests the stream per transport (racy, drops/dupes) |
| Recording starts on BLE, then hands off to Wi-Fi | the device only streams after a BLE START; BLE is the control + fallback baseline | starting on Wi-Fi (no control channel; nothing tells the device to stream) |
| BLE-reported IP for discovery | reliable, no managed-component download; the device already has a trusted BLE channel to report on | mDNS `_wearwise._tcp` (needs the `espressif/mdns` managed component; deferred) |
| Per-boot PoP token, readable only over BLE, gates the WebSocket | only a BLE-paired phone can open the Wi-Fi stream; cheap to verify | open WebSocket (any LAN device could read the stream) |
| Built-in RN `WebSocket`, no native module | keeps the Wi-Fi path a pure-JS change — no extra prebuild/rebuild | a native WS/socket module |
| `TransportCoordinator` swaps via `engine.attachTransport` | the engine holds one transport; swapping the read path keeps the session + tracker, satisfying "no duplicate session" | a second engine/session per transport |


## Decisions of record (Milestone 7 — polish)

| Decision | Why | Rejected |
|---|---|---|
| Activity rings show weekly **activity**, not physiology | honest with simulated data; ties recording to sync | SpO₂/temp/HR rings (misleading) |
| Ring sweep = one-shot RAF → plain number | avoids the Skia 2 + Reanimated 4 "state update before mount" warning | reanimated SharedValue bound into Skia |
| Theme persisted in MMKV, restored synchronously | not a secret; no Keychain round-trip; no wrong-palette flash | expo-secure-store (async) |
| `ActivityRings`, `Reveal` live in `src/shared` | reusable presentation, no domain/data deps | per-screen bespoke animation |
