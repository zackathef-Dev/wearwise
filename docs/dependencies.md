# Dependencies, licences and advisories

What WearWise depends on, why, under which licence, and how to keep it current. Versions are
those installed from `package-lock.json` at the handover release (14 October 2026). The
full dependency tree is in `package-lock.json`; this page lists the direct dependencies and
the toolchain.

## Phone app (`apps/mobile`)

| Dependency | Version | Purpose | Licence |
|---|---|---|---|
| expo | 57.0.16 | App framework (SDK 57) and build tooling | MIT |
| react-native | 0.86.2 | Native UI runtime | MIT |
| react | 19.2.8 | UI library | MIT |
| expo-router | 57.0.16 | Screen navigation and deep links | MIT |
| react-native-ble-plx | 3.5.1 | Bluetooth LE to the patch | MIT |
| @op-engineering/op-sqlite | 18.1.4 | Local database with SQLCipher encryption | MIT |
| expo-secure-store | 57.0.1 | Keychain / Keystore: database key, session | MIT |
| expo-crypto | 57.0.2 | Secure random numbers, SHA-256 | MIT |
| @supabase/supabase-js | 2.112.4 | Backend: auth, database, Storage, Realtime | MIT |
| @tanstack/react-query | 5.102.3 | Server-state caching | MIT |
| zustand | 5.0.15 | App state | MIT |
| react-hook-form · @hookform/resolvers · zod | 7.86.0 · 5.9.1 · 3.25.76 | Forms and validation | MIT |
| @shopify/react-native-skia | 2.11.1 | Live charts (ECG strip, signals) | MIT |
| react-native-reanimated · react-native-worklets · react-native-gesture-handler | 4.5.1 · 0.10.1 · 2.32.0 | Animation and gestures | MIT |
| react-native-mmkv | 4.3.2 | Non-sensitive preferences | MIT |
| expo-notifications · expo-audio | 57.0.22 · 57.0.5 | Alert notifications, fall-alarm sound | MIT |
| react-native-screens · react-native-safe-area-context | 4.26.2 · 5.7.0 | Native screen containers, safe areas | MIT |
| expo-constants · -device · -file-system · -font · -image-picker · -linking · -splash-screen · -status-bar · -system-ui | 57.0.x | Platform integration | MIT |
| react-native-url-polyfill | 4.0.0 | URL support for supabase-js | MIT |
| @expo-google-fonts/poppins | 0.4.1 | Brand typeface | MIT (code), OFL-1.1 (font) |
| Development: typescript · jest · jest-expo · eslint · eslint-config-expo | 6.0.3 · 29.7.0 · 57.0.4 · 9.39.5 · 57.0.1 | Type checking, tests, lint | Apache-2.0 (TypeScript), MIT |

Two local native modules, `apps/mobile/modules/pinned-websocket` (certificate-pinned Wi-Fi
stream) and the release-security config plugin, are WearWise's own code.

## Web dashboard (`apps/dashboard`)

| Dependency | Version | Purpose | Licence |
|---|---|---|---|
| react · react-dom | 19.2.8 | UI library | MIT |
| react-router | 7.18.4 | Routing | MIT |
| @supabase/supabase-js | 2.112.4 | Backend | MIT |
| esptool-js | 0.7.0 (pinned) | Patch setup: flashing the ESP32 over Web Serial | Apache-2.0 |
| spark-md5 | 3.0.2 | MD5 verification of flashed images | WTFPL or MIT |
| Development: vite · @vitejs/plugin-react · vitest · typescript | 8.3.4 · 6.1.2 · 4.1.11 · 6.0.3 | Build, tests, types | MIT, Apache-2.0 (TypeScript) |

## Shared packages (`packages/`)

`@wearwise/sensor-protocol`, `@wearwise/legal`, `@wearwise/password` and
`@wearwise/design-tokens` (all 0.1.0) are WearWise's own TypeScript source with no runtime
dependencies.

## Backend, firmware and toolchain

| Component | Version | Purpose | Licence |
|---|---|---|---|
| Supabase CLI | 2.120.0 | Local stack, migrations, tests | MIT |
| Supabase services (Docker images) | as pulled by the CLI | Postgres 17, Auth, Storage, Realtime, PostgREST, Studio | PostgreSQL License, Apache-2.0, MIT (per service) |
| Docker | 29.8 | Runs the local stack | Apache-2.0 (Engine); Docker Desktop has its own terms |
| ESP-IDF | 5.4.2 | Firmware framework; includes NimBLE (Bluetooth) and Mbed TLS (Wi-Fi TLS) | Apache-2.0 (text: `apps/dashboard/public/firmware/LICENSE-Apache-2.0.txt`) |
| Node.js / npm | 24.19 / 11 (22+ supported) | Tooling | MIT / Artistic-2.0 |
| Poppins (dashboard and PDFs) | — | Typeface, copied into `apps/dashboard/src/assets/fonts/` | OFL-1.1 (text: `OFL.txt` there) |

## Licence overview

Of the 710 packages that ship with the apps (production dependencies, from the lockfile),
598 are MIT and nearly all others are permissive (ISC, BSD-2/3-Clause, Apache-2.0,
BlueOak-1.0.0, 0BSD, Unlicense, CC0, Python-2.0). Notable exceptions:

- **MPL-2.0**, file-level copyleft: `lightningcss` and its platform builds, a build-time CSS
  tool used unmodified.
- **CC-BY-4.0**: the `caniuse-lite` browser data, which needs attribution.
- **Dual-licensed**: `node-forge` (BSD-3-Clause or GPL-2.0, usable under BSD-3-Clause).

No GPL or AGPL code ships in the apps. WearWise itself is licensed under the PolyForm
Noncommercial License 1.0.0 (`LICENSE`); third-party components keep their own licences
(`NOTICE`).

**SBOM.** `npm sbom --sbom-format cyclonedx` currently refuses to run because of an optional
peer-version mismatch (`@hookform/resolvers` declares `ajv@^8` for its AJV resolver, which
WearWise doesn't use; the installed `ajv` is 6). It doesn't affect the app. After the next
dependency upgrade, generate a CycloneDX SBOM with
`npm sbom --sbom-format cyclonedx --omit dev > sbom.cdx.json`.

## Security advisories

Current state (14 October 2026): GitHub Dependabot raised 13 alerts; 8 were fixed. `npm audit`
reports 65 entries across the workspace (0 critical, 49 high, 16 moderate), or 43 without
development-only packages; they come from 5 underlying packages, none of which is exploitable
as WearWise uses it:

| Package | Classification | Why |
|---|---|---|
| braces | Build/development; blocked by framework version | File matching in Metro and Jest; no patched version |
| node-forge | Build/development; blocked by framework version | Expo CLI tooling; no patched version; not in the app bundle |
| sprintf-js | Development | Test-coverage tooling; no patched version |
| uuid | Build; not affected | iOS prebuild tooling, only `v4()` is used |
| decode-uri-component | **Runtime, mitigated**; update blocked by framework version | Expo Router URL parsing; malformed links are refused before it runs; fixed in Expo Router 58 |

Details: [security/dependency-advisories.md](security/dependency-advisories.md).

## Keeping dependencies current

- Upgrade the Expo SDK as a unit: `npx expo install expo@latest`, then `npx expo install --fix`,
  rebuild the native apps, and run every test and the hardware checks.
- **Never run `npm audit fix --force`**: it installs much older Expo versions and breaks the app.
- Dependabot (`.github/dependabot.yml`) proposes monthly minor and patch updates and GitHub
  Actions updates; it never proposes major versions. Run `npx expo install --check` before
  merging an Expo-related update.
- `.npmrc` sets `ignore-scripts=true`: dependencies can't run install scripts.
