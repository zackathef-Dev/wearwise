# Contributing to WearWise

Thanks for helping to maintain WearWise. This page is the short version of the rules; the
detail lives in the linked documents. WearWise is licensed for noncommercial use only (see
[LICENSE](LICENSE)).

## Setting up

Follow the [README](README.md) (or the Setup Guide PDF in `docs/guides/`): Git, Node.js 22+,
Docker, the Supabase CLI (standalone, not `npx supabase`), and Android Studio / Xcode for the
app. ESP-IDF 5.4.2 only if you change the firmware.

## Branches and commits

- `main` is always releasable. Work on a short-lived branch (`fix/…`, `docs/…`, `feat/…`) and
  open a pull request to `main`.
- Keep commits focused, with a message that says what changed and why.
- Never rewrite published history on `main`. Releases are tagged (`vX.Y.Z…`).

## Before you open a pull request

Run what your change touches (all from the repository root); CI runs the same checks:

```bash
npm ci
npm run typecheck -w mobile && npm run lint -w mobile && npm test -w mobile
npm run typecheck -w dashboard && npm test -w dashboard
bash supabase/sql-tests/run-on-local-stack.sh     # if you changed anything in supabase/ (resets your local DB)
```

Hardware behaviour can't be tested in CI: if you changed Bluetooth, Wi-Fi, sensors or firmware,
run the relevant rows of [docs/testing/hardware-test-matrix.md](docs/testing/hardware-test-matrix.md)
on a real patch and phone, and say which in the pull request.

## Code conventions

- TypeScript strict mode; match the surrounding code's style, naming and comment density.
- The phone app keeps pure logic in `apps/mobile/src/domain/` (unit-tested without devices);
  device and network code in `data/` and `platform/`.
- User-facing text: plain English, no medical claims. WearWise reports *measurements* and a
  *possible fall*; it never diagnoses.

## Rules that protect data and compatibility

- **Database:** every change is a **new** migration (`supabase migration new <name>`); never
  edit an applied one. New tables need RLS, explicit grants and policies, plus checks in
  `supabase/sql-tests/`. Never load the demo seed into a hosted project. See
  [docs/database.md](docs/database.md).
- **Bluetooth protocol:** wire codes 1–6 never change meaning. A change to the packet format
  updates both `firmware/…/communication/protocol.{c,h}` and `packages/sensor-protocol`, and
  regenerates the shared fixtures. See [docs/ble-protocol.md](docs/ble-protocol.md).
- **Firmware:** bump `WW_FW_VERSION`, build from a clean checkout, and publish with
  `npm run firmware:export -w dashboard` so the manifest records the commit. See
  [docs/firmware.md](docs/firmware.md).
- **Terms:** a change to `ACCEPTANCE_VERSION` in `packages/legal` needs a migration adding the
  version to `private.terms_versions`, applied before the apps ship.

## Security

- **Never commit secrets**: `.env` files, keystores, `key.properties`, Apple signing material,
  service-role keys, access tokens or database passwords. They are gitignored; keep it that
  way. The project URL and publishable key are public by design.
- Never commit real participants' data or screenshots that show personal information.
- CI runs a secret scan (gitleaks) on every push. To scan locally before you push:
  `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.21.2 detect --source /repo --redact`.
- Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Documentation

Update the docs in the same pull request as the change: the README if setup changes, the
relevant `docs/*.md`, `docs/known-limitations.md` if a limitation changes, and `CHANGELOG.md`.
The PDF guides are built from `docs/guides/source/` (see the README there).
