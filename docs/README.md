# WearWise documentation

The index of everything in `docs/`. New here? Read the root [README](../README.md), then the
**Handover Documentation** PDF. For the exact contents of the release, see
[HANDOVER-MANIFEST.md](HANDOVER-MANIFEST.md).

## Start here

| Topic | Document |
|---|---|
| Handover overview | [guides/WearWise-Handover-Documentation.pdf](guides/WearWise-Handover-Documentation.pdf) (PDF) · [knowledge-transfer.md](knowledge-transfer.md) (text) |
| What is handed over | [HANDOVER-MANIFEST.md](HANDOVER-MANIFEST.md) |
| Owner actions outside Git | [OWNER-HANDOVER-CHECKLIST.md](OWNER-HANDOVER-CHECKLIST.md) |
| Requirements and scope | [requirements-traceability.md](requirements-traceability.md) |
| Known limitations | [known-limitations.md](known-limitations.md) |
| Future development | [knowledge-transfer.md § T](knowledge-transfer.md#t-future-improvements) |

## For people using WearWise

| Topic | Document |
|---|---|
| User manual (phone app and dashboard) | [guides/WearWise-User-Guide.pdf](guides/WearWise-User-Guide.pdf) |
| Adding researchers and clinicians | [guides/WearWise-Adding-a-Researcher.pdf](guides/WearWise-Adding-a-Researcher.pdf) · [operations/researcher-access.md](operations/researcher-access.md) |
| Compliance documents (terms, privacy) | [compliance/README.md](compliance/README.md) |

## For the project owner and maintainers

| Topic | Document |
|---|---|
| Project-owner runbook: set up and run everything locally | [guides/WearWise-Setup-Guide.pdf](guides/WearWise-Setup-Guide.pdf) (beginners) · [README](../README.md) §3–9 (developers) |
| Deployment (cloud, self-hosted, release builds) | [deployment.md](deployment.md) |
| Maintenance schedule and responsibilities | [knowledge-transfer.md, "Maintenance checklist"](knowledge-transfer.md#maintenance-checklist) |
| Troubleshooting | [troubleshooting.md](troubleshooting.md) |
| Contributing rules | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| Changes | [../CHANGELOG.md](../CHANGELOG.md) |

## Design and implementation

| Topic | Document |
|---|---|
| Architecture and key decisions | [architecture.md](architecture.md) |
| Phone app internals | [mobile-app.md](mobile-app.md) (current) · [architecture/mobile-architecture.md](architecture/mobile-architecture.md) (design notes) |
| Offline-first design; live view and alerts | [architecture/offline-first.md](architecture/offline-first.md) · [architecture/live-view-and-alerts.md](architecture/live-view-and-alerts.md) |
| Firmware | [firmware.md](firmware.md) |
| Hardware, wiring, pin map | [hardware.md](hardware.md) |
| Bluetooth protocol (current) | [ble-protocol.md](ble-protocol.md) |
| Database, RLS, migrations, seed | [database.md](database.md) · [database/local-schema.md](database/local-schema.md) · [database/cloud-schema.md](database/cloud-schema.md) (history) |
| Dependencies, licences, advisories | [dependencies.md](dependencies.md) |

## Security

| Topic | Document |
|---|---|
| **Current, authoritative security documentation** | [security/WearWise-Security-Documentation.pdf](security/WearWise-Security-Documentation.pdf) |
| Security notes: controls, secrets, responsibilities | [security.md](security.md) |
| Reporting a vulnerability | [../SECURITY.md](../SECURITY.md) |
| Dependency advisories | [security/dependency-advisories.md](security/dependency-advisories.md) |
| Historical reviews (superseded in part) | [security/audit-2026-10-13.md](security/audit-2026-10-13.md) · [security/WearWise-release-security-report.md](security/WearWise-release-security-report.md) |

## Testing

| Topic | Document |
|---|---|
| Test strategy | [testing/test-strategy.md](testing/test-strategy.md) |
| Hardware test matrix | [testing/hardware-test-matrix.md](testing/hardware-test-matrix.md) |
| Handover dry run and hardware tests H1–H13 | [testing/handover-dry-run-2026-10-14.md](testing/handover-dry-run-2026-10-14.md) |
| Real-device test report | [testing/real-device-2026-10-13.md](testing/real-device-2026-10-13.md) |
| Heart-rate validation procedure | [HRValidation.md](HRValidation.md) |
| Test evidence (screenshots, logs; identifiers redacted) | [testing/evidence/](testing/evidence/) |
| Automated checks on every push | [../.github/workflows/ci.yml](../.github/workflows/ci.yml) |

## History and background

Kept for context; where they differ from the documents above, the documents above are right.
[milestones/](milestones/) (development milestones, August–October 2026) ·
[SESSION-HANDOFF.md](SESSION-HANDOFF.md) · [WearWiseProtocol.md](WearWiseProtocol.md) and
[firmware/ble-gatt.md](firmware/ble-gatt.md) (superseded protocol notes) ·
[setup/android-development.md](setup/android-development.md) (August toolchain notes) ·
[DECISION-001-palette.md](DECISION-001-palette.md) (design decision).

## PDF sources

The PDFs are built from [guides/source/](guides/source/) (see the README there).
