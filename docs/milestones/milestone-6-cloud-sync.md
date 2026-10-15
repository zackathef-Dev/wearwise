# Milestone 6 — cloud sync

_26 Aug 2026. Finished sessions upload to Supabase, offline-first and resumable,
under owner-only RLS. The encrypted on-device store stays the source of truth._

## Outcome

The full sync path is implemented and unit-tested: the phone packs each finished
session's channels into CRC-verifiable blobs, uploads metadata to Postgres and
bytes to Storage under RLS, and records per-channel progress so a retry resumes
without duplicating. Home shows a backup banner and auto-syncs on focus.

**Cloud verified end to end** on the hosted project `<project-ref>`
(26 Aug 2026): migration applied, `sync-live.mjs` 7/7, and the phone uploaded 9
sessions / 27 channels / 27 Storage objects — 72 chunks re-downloaded and
CRC-verified. See `docs/testing/evidence/m6/live-2026-08-26/`.

## How it works

- **Source of truth.** Sync only ever uploads. It never mutates local data beyond
  the `session_sync` bookkeeping table.
- **What uploads.** Only `complete`/`interrupted` sessions — a `recording` session
  is never touched. Session row → Postgres; each channel's chunks → one Storage
  object; channel metadata row points at it.
- **CRC end to end.** A channel becomes a self-describing WWCH container preserving
  every chunk's boundaries, timestamps and CRC. The download re-verifies each CRC,
  so the cloud copy is provably the bytes the device recorded.
- **Idempotent + resumable.** Every remote write is an upsert by UUID or an
  overwrite by object path; `session_sync.uploaded_channels` records what's done.
  A crash or dropped network resumes exactly where it stopped.
- **Offline-first.** No backend config or no network → a quiet no-op; the banner
  says "Backup paused — will retry" and the next focus/tap retries.

## Files

- `supabase/migrations/20260826000002_recordings.sql` — tables, RLS, Storage bucket + policies
- `apps/mobile/src/data/sync/chunk-container.ts` — WWCH pack/unpack + CRC
- `apps/mobile/src/domain/repositories/sync-gateway.ts` — the port
- `apps/mobile/src/domain/sync/sync-engine.ts` — the offline-first, resumable engine
- `apps/mobile/src/data/remote/supabase-sync-gateway.ts` — supabase-js implementation
- `apps/mobile/src/features/sync/sync-store.ts` — trigger + status
- `apps/mobile/src/app/home.tsx` — backup banner, auto-sync on focus
- Local: `session_sync` table (SQLite migration v2) + store methods in both stores
- `supabase/tests/sync-live.mjs` — live round-trip + RLS test (ready)

## Tests

90/90 unit tests pass (`cd apps/mobile && npm test`), +13 for M6:
- **chunk-container** — pack/unpack round-trip, u64 timestamps exact, a flipped byte
  fails the CRC, bad magic rejected.
- **sync-engine** — only finished sessions; idempotent re-run uploads nothing; resume
  after a payload failure without re-uploading or duplicating; offline no-op; one
  failing session doesn't block others; pending count.

## Platform status

- **Logic**: ✅ complete, unit-tested, tsc clean.
- **Cloud (hosted project)**: ✅ migration applied; sync-live 7/7; phone uploaded
  9 sessions / 27 channels / 27 objects, all CRC-verified in Storage under RLS.
- **iPhone**: ⏳ not tested.

## Reproduce / operate

1. Migration applied via the Management API (also: Supabase SQL editor, `supabase
   db push`, or the Supabase MCP).
2. `SB_ANON=… SB_TEST_EMAIL=… SB_TEST_PW=… node supabase/tests/sync-live.mjs`
   (add `SB_PAT`, `SB_OTHER_EMAIL`, `SB_OTHER_PW` for the cross-user RLS check).
3. On the phone: record a session → return to Home → the banner uploads it and the
   row + object appear in the dashboard (verified 26 Aug 2026).

## Limitations (honest)

- No download/restore path yet (upload only); a lost-phone restore is a later slice.
- No delta/least-recently-used pruning of the local store after upload; sessions
  stay local. Retention policy is future work.
- Sync is triggered on Home focus + manual tap; no background sync (foreground-only,
  consistent with the BLE/Wi-Fi scope).

## Next: Milestone 7 — polish

The Apple-ring hero, animations, accessibility pass, and the settings/consent
surfaces the mockup shows — on top of a pipeline that now spans device → phone →
cloud.
