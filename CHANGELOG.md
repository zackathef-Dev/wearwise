# Changelog

All notable changes to WearWise are recorded here. Versions are git tags. WearWise was
developed in an internal repository during 2026; this public history starts at the handover
release, so earlier development is summarised in the documentation (`docs/milestones/`,
`docs/testing/`, `docs/security/`) rather than listed as versions.

## [Unreleased]

Nothing yet.

## [v1.0.0-handover] — 2026-10-14

The capstone handover release.

Final handover-readiness additions (the last changes before the tag):

- `SECURITY.md`, `CONTRIBUTING.md`, this changelog.
- `docs/README.md` (documentation index), `docs/HANDOVER-MANIFEST.md`,
  `docs/OWNER-HANDOVER-CHECKLIST.md`, `docs/requirements-traceability.md`,
  `docs/known-limitations.md`, `docs/dependencies.md`.
- GitHub Actions CI (type checks, lint, unit tests, dashboard build, database suites, firmware
  build, secret scan) and Dependabot configuration.
- The security documentation's classification changed from "Internal" to public (it contains
  no secrets or personal data); the user guide gained a FAQ; the handover documentation lists
  the team-defined implementation scope (BLE first, NFC deferred, one active wearable) and the new documents.
- `.gitleaksignore` for one verified false positive; README restructured around a
  Documentation index; historical documents marked as such, pointing to the current ones.

| Component | Version |
|---|---|
| Phone app (Android, iOS) | 0.1.0, versionCode 1 (`apps/mobile/app.config.ts`) |
| Web dashboard | 0.1.0 |
| Patch firmware | 0.9.6, bundled for Patch setup, built from commit `52e94d8` |
| Database | 11 migrations (Supabase, Postgres 17) |

Included: the phone app, web dashboard, patch firmware, Supabase migrations, synthetic demo
seed, database and unit tests, and the documentation, including five PDFs (Handover
Documentation, User Guide, Setup Guide, Adding a Researcher or Clinician, Security
Documentation).

Changes made during the handover, in order (all on 14 October 2026):

- Architecture and pin diagrams added to the documentation.
- PDF guides added (User Guide, Setup Guide, Adding a Researcher or Clinician), with their
  sources in `docs/guides/source/`.
- Full security documentation added; the 13 October audit marked as superseded in part.
- Pre-publication review: 8 of 13 dependency alerts fixed by lockfile updates (`shell-quote`,
  `compression`, `brace-expansion`); prototype patch MAC addresses and derived device IDs
  redacted from test evidence, screenshots and fixtures; bundled firmware rebuilt from a clean
  checkout so its manifest records the commit; a stale September change list removed.
- Unused Expo starter-template images removed.
- Licence: PolyForm Noncommercial 1.0.0, © 2026 WearWise Project Team, with `NOTICE` and the
  third-party licence texts for the bundled font and firmware.
- WearWise Project Team credits in the README, `TEAM.md`, the app and the dashboard.
- Handover Documentation PDF; project owner acknowledged (Project Context, Acknowledgements),
  with owner and development team kept distinct.

[Unreleased]: https://github.com/zackathef-Dev/wearwise/compare/v1.0.0-handover...main
[v1.0.0-handover]: https://github.com/zackathef-Dev/wearwise/releases/tag/v1.0.0-handover
