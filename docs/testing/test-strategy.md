# Test strategy

Four tiers, each honest about what it can and cannot prove. The vocabulary from
the build instruction is used verbatim in every report:

```
automated test passed          ran in CI / on a dev machine, no device
simulator test passed          ran in an emulator or simulator
physical Android test passed   ran on a real phone, with evidence
physical iPhone test passed    ran on a real iPhone, with evidence
not yet physically tested      the default until evidence exists
```

## Tier 1 — unit (jest, hardware-free)

`cd apps/mobile && npm test` — 90 tests as of Milestone 6.

| Area | Where | What it proves |
|---|---|---|
| Packet codec | `packages/sensor-protocol/.../codec.test.ts` | round-trip every field, per-sensor scale, clamping, all 9 decode-error codes |
| CRC-32 | same | IEEE check vector `123456789 → 0xCBF43926` |
| Sequence tracking | `sequence.test.ts` | gaps counted, duplicates dropped, restart accepted, stale rejected |
| **Firmware contract** | `fixtures.test.ts` | every fixture decodes to its recorded fields and re-encodes byte-for-byte |
| Signal generators | `recording-engine.test.ts` | deterministic per seed, plausible ranges, ECG beats at ~72 bpm |
| Recording engine | same | session-before-packet, chunk/summary agreement, stop/close, dropout gaps, chunk-never-spans-gap, device restart, storage failure → failed, crash leaves `recording` |
| Recovery | `recover-sessions.test.ts` | corrupt chunk counted not deleted, summary from verified only, idempotent, user-scoped |
| Auth store | `auth-store.test.ts` | unconfigured, restore, sign-in/out, remote sign-out |
| Form validation | `auth-schemas.test.ts` | email, 10-char password, consent literal `true` |
| BLE base64 codec | `data/ble/__tests__/base64.test.ts` | round-trips every byte value; a real packet survives encode → base64 → decode |
| Chunk container | `data/sync/__tests__/chunk-container.test.ts` | pack/unpack round-trip, u64 timestamps, CRC catches a flipped byte |
| Sync engine | `domain/sync/__tests__/sync-engine.test.ts` | only finished sessions, idempotent re-run, resume after payload failure, offline no-op, one failure doesn't block others |

The engine tests run against `MemorySessionStore`, which mirrors the SQLite
store's semantics. The SQLite store itself needs a device (Tier 3).

## Tier 2 — integration (live backend, no hardware)

`supabase/tests/rls-live.mjs` — 15 assertions against the hosted project through
the public REST/Auth API. **Passed 26 Aug 2026.** Needs `SB_PAT`, `SB_ANON`,
`SB_TEST_MAILBOX` in the environment; creates and deletes its own users.

`supabase/tests/rls_profiles.test.sql` — the pgTAP twin for a local Docker stack.

## Tier 3 — on-device, automated where possible

Not yet built. Planned: Detox or Maestro flows for sign-in → record → restart →
history on a physical Android device, run from the controlled manual checklist,
not ordinary CI.

## Tier 4 — physical hardware

`docs/testing/hardware-test-matrix.md`. Nothing in that matrix is claimed until a
row carries evidence (screenshot, log excerpt, or recording file) and a date.

## What is deliberately NOT unit-tested

- Screens. They are thin over stores; their correctness is checked by looking at
  them on a device. A snapshot test of a Skia canvas proves nothing.
- Native module wiring (SQLCipher, Skia). Only a real build proves it — see the
  Android build gate in each milestone report.
