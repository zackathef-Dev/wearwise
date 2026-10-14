# Handover manifest

The authoritative record of what is handed over. Every value was read from the repository or
a build on 14 October 2026; nothing here is estimated.

## Release

| Item | Value |
|---|---|
| Handover version | `v1.0.0-handover` |
| Final Git commit | The commit tagged **`v1.0.0-handover`**: `git rev-list -n 1 v1.0.0-handover` prints its hash. (A commit can't contain its own hash, so the tag is the authoritative pointer.) It includes the handover-readiness additions listed in `CHANGELOG.md`. |
| Repository | `main` branch. Published as a fresh history (no personal data or secrets in any commit; audited with gitleaks and custom scans on 14 October 2026). |
| Licence | PolyForm Noncommercial License 1.0.0, © 2026 WearWise Project Team (`LICENSE`, `NOTICE`) |
| Project | La Trobe University CSE3CAP Capstone Project. Project Owner: Shanmuga Sundar Dhanabalan, Deputy Director, CTI, La Trobe University. Development: the WearWise Project Team (`TEAM.md`). |

## Components

| Component | Version | Source of truth |
|---|---|---|
| Phone app (Android, iOS) | **0.1.0**, versionCode **1** | `apps/mobile/app.config.ts` (`apps/mobile/package.json` says 1.0.0: that is the npm workspace label and is not shipped) |
| App identifier | `io.wearwise.participant` (Android package and iOS bundle identifier) | `apps/mobile/app.config.ts` |
| Web dashboard | **0.1.0** | `apps/dashboard/package.json` |
| Patch firmware | **0.9.6** | `WW_FW_VERSION` in `firmware/wearwise-esp32/main/config/FirmwareConfig.h` |
| Database | **11 migrations**, `20260826000001_profiles` … `20261017000011_terms_2026_10_17` | `supabase/migrations/` |
| Toolchain tested | Node 24.19 / npm 11, Expo SDK 57, React Native 0.86, Supabase CLI 2.120.0, Docker 29.8, ESP-IDF 5.4.2, JDK 17, Android SDK 36 | `README.md` §3 |

## Firmware images (bundled for Patch setup)

Built from a clean checkout of commit `52e94d8`; the firmware source is unchanged from that
commit to `5130aa0`. A rebuild from the same source produces identical code: only the build
timestamp and the hashes computed over it differ (checked from a fresh clone on 14 October).

| File | Offset | Size (bytes) | SHA-256 |
|---|---|---|---|
| `bootloader.bin` | 0x1000 | 25,968 | `69a3fd659ae09263ae076a865927f2b3e3010843bdc7d1d7f12681cdc7308e54` |
| `partition-table.bin` | 0x8000 | 3,072 | `7e47893573c17340f684e5e610b3e6f6499fee4bfc5ccb7fdedc8d7dc1a97106` |
| `wearwise-esp32.bin` | 0x10000 | 1,146,016 | `a7da56146d0a24e8d6a2d1712c048de70df5eced9f5a3a4c45a5846a66f7b7d1` |

Record: `apps/dashboard/public/firmware/manifest.json` (version, build time, commit).

## Mobile app binaries

**No release APK or iOS build is part of the handover.** Release builds must be signed with
the owner's own keys (`docs/deployment.md`); the developers' signing keys are not handed over.

| Build | Status |
|---|---|
| Debug build from a fresh clone of `5130aa0` (same app code as the final commit) | Built successfully on 14 October 2026 (`expo prebuild` + `gradlew assembleDebug`); not distributed |
| Last signed release candidate | `WearWise-0.1.0-release.apk`, SHA-256 `A2A7A9BB516E968EF34EF134EA314E9B93D9871E79807BB19D6709767DCB65F4`, package `io.wearwise.participant`, 0.1.0 (1), min SDK 24, target SDK 36, arm64-v8a + x86_64, built **20 September 2026** from an earlier code state and signed with a developer key (`docs/security/release-artifact.json`). **Historical only**: it predates the October fixes; do not distribute it. Build a new release from the final commit with your own keystore. |

## Hardware

The prototype patch hardware is **not** handed over; it stays with the team. Everything needed
to build patches is in the repository.

| Item | Supported | Tested in the handover tests (14 October 2026) |
|---|---|---|
| Controller | Classic ESP32 (ESP-WROOM-32, 4 MB flash; not S2/S3/C3) | Chip revision v3.1 boards |
| MAX30102 | Heart rate, SpO₂, pulse wave (I²C) | Yes: live and recorded with a fingertip (H11) |
| MAX30205 | Skin temperature (I²C) | Yes: live reading (H5) |
| MMA8452Q | Movement; possible-fall detection on the phone (I²C) | Yes: live reading (H5); fall alarm path tested on 13 October |
| AD8232 | ECG, education only (analog) | Detected; lead-off state shown (H5). **Not tested with electrodes on a person.** |
| Wiring and parts | `docs/hardware.md`, Setup Guide Part 5 | — |

## Documentation

Handover release v1.0.0, October 2026. Start at `README.md` and `docs/README.md`. PDFs (built
from `docs/guides/source/`):

| PDF | Path |
|---|---|
| Handover Documentation | `docs/guides/WearWise-Handover-Documentation.pdf` |
| User Guide | `docs/guides/WearWise-User-Guide.pdf` |
| Setup Guide | `docs/guides/WearWise-Setup-Guide.pdf` |
| Adding a Researcher or Clinician | `docs/guides/WearWise-Adding-a-Researcher.pdf` |
| Security Documentation | `docs/security/WearWise-Security-Documentation.pdf` |

## Verification (14 October 2026)

| Check | Result |
|---|---|
| Fresh clone from GitHub → `npm ci` → type checks, lint, unit tests, dashboard production build | Pass: app 283 tests, dashboard 110, legal package 51 |
| Fresh clone → Android native debug build | Pass |
| Fresh clone → firmware build (ESP-IDF 5.4.2) | Pass, 0 warnings |
| Local Supabase: start, reset (11 migrations + demo seed), database suites | Pass: 277 SQL checks + 8 pgTAP; two-user API isolation 7/7 |
| Hardware tests H1–H13 (Samsung phone, three patches) | Pass |
| Hosted database compared with the migrations (schema fingerprint) | Match in everything that affects behaviour |
| Secret scan of the published history and working tree (gitleaks 8.21.2 + custom) | No secrets (one false positive: the name of a Keystore slot) |
| Dependency audit | 0 critical; 5 underlying advisories, assessed in `docs/security/dependency-advisories.md` |

Not tested: an iOS release build on a device, ECG with electrodes on a person, real falls.
Known limitations: [known-limitations.md](known-limitations.md).
