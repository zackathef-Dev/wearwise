# Requirements traceability

How the project brief maps to the team-defined minimum viable product (MVP) scope, what was
implemented, and what is deferred.

**Sources.** The original project proposal is not stored in this repository (it contains
project-owner contact details that are not to be published without consent). The "Original
proposal" column below summarises its focus as recorded in the README's Project Context: *a
user-friendly mobile platform for wearable devices, including secure wearable connectivity,
real-time sensor visualisation, historical data management, and scalable support for future
wearable technologies*. The "Team-defined MVP" column records the implementation and
prioritisation decisions the WearWise Project Team made during development, based on the
supplied requirements, research and technical feasibility. Evidence points to code, tests and test reports in this repository.

| # | Original proposal | Team-defined MVP | Implemented | Deferred / future | Evidence |
|---|---|---|---|---|---|
| 1 | Secure wearable connectivity (BLE and NFC) | **BLE prioritised; NFC deferred** | Bluetooth LE with LE Secure Connections, a 6-digit passkey on the patch label, bonding, lock-out after failed pairings; optional Wi-Fi streaming over TLS pinned through the Bluetooth link | NFC | `firmware/wearwise-esp32/main/communication/`, `apps/mobile/src/data/ble/`, `docs/ble-protocol.md`; hardware tests H3–H6, H12–H13 |
| 2 | Real-time sensor visualisation | Live readings for the sensors the patch reports | Live ECG strip, heart rate, SpO₂, skin temperature and movement on the phone, with reference ranges; live view for a researcher on the dashboard (nothing stored) | — | `apps/mobile/src/features/monitoring/`, `apps/dashboard/src/pages/LiveView.tsx`; User Guide §6, §14, §18; H5, H8 |
| 3 | Historical data management | Recording, history and backup | Sessions recorded into an encrypted database on the phone (works offline), history with charts, cloud backup and restore, dashboard sessions, charts and CSV export | Retention and purge policy | `apps/mobile/src/domain/recording/`, `src/domain/sync/`, `supabase/migrations/`; User Guide §8, §11, §19; H4, `sync-live.mjs` |
| 4 | Scalable support for future wearable technologies | **Architecture remains scalable** | Capability discovery (the patch reports what it has), one driver interface for sensors, a versioned binary protocol with a shared fixture, documented steps to add a sensor | More sensor types; an SPI sensor on the reserved pins | `firmware/…/core/SensorManager.c`, `packages/sensor-protocol/`, `docs/firmware.md` "Adding a new sensor" |
| 5 | Several wearable devices | **One active wearable for the proof of concept** | One patch connected at a time; the app remembers several patches and switches between them; a patch remembers two phones | Several patches streaming at once | `apps/mobile/src/data/transport/`, Devices screen; H5 (switching patches) |
| 6 | User-friendly mobile platform | Usable by participants without training | Guided pairing, plain-language screens, simulated patch for trying the app, accessibility pass, light and dark themes, a user guide with screenshots | — | `docs/milestones/milestone-7-polish.md`, User Guide PDF |
| 7 | Security and privacy of health data (implied by "secure") | Participant controls who sees their data | Row Level Security on every table, participant-created one-time share codes with scoped, revocable access, encrypted local storage, HTTPS-only release builds, server-enforced consent and 18+ | Two-factor sign-in for staff, sign-up abuse protection, Secure Boot on patches | `supabase/sql-tests/` (277 checks), Security Documentation PDF |
| 8 | Product delivery | **Research proof of concept, not a commercial medical product; App Store publication not required** | Development builds for Android and iOS, documented release-build and deployment process, research-prototype disclaimers throughout | Store publication, clinical validation, regulatory approval | `docs/deployment.md`, `docs/known-limitations.md` |

## Delivered beyond the summary above

These capabilities were built during the project but are not named in the brief's summary.
Confirm with the project owner whether they count as in scope:

- the **web dashboard** for researchers and clinicians (participants, sessions, charts, CSV,
  alerts), and for participants to view their own data;
- **sharing with researchers** through one-time share codes, and researcher-requested
  recordings during live view;
- **possible-fall detection** with an alarm on the phone and alerts on the dashboard;
- **Patch setup** in the dashboard: installing firmware and writing the label PIN over USB,
  without a toolchain;
- the **local development stack** (Docker + Supabase) with synthetic demo data, and the
  administration scripts.

## Verification

Automated: 283 app unit tests, 110 dashboard and 51 legal-package tests, 277 database checks +
8 pgTAP, a two-user API isolation test, and CI on every push. Manual and hardware: the
handover dry run and hardware tests H1–H13 (`docs/testing/handover-dry-run-2026-10-14.md`),
the real-device report (`docs/testing/real-device-2026-10-13.md`) and the hardware test matrix
(`docs/testing/hardware-test-matrix.md`).
