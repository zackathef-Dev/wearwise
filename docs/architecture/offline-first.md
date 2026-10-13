# Offline-first recording

_Milestone 3 state. Describes what is built; the sync half arrives in Milestone 6._

## The rule

**Internet and sensor connectivity are separate concepts.** Recording depends only
on the sensor link. Wi-Fi or mobile data dropping mid-session changes nothing about
the recording; it only delays the upload that comes later.

## Pipeline

```
SensorTransport ──packet──▶ RecordingEngine ──chunk──▶ SessionStore (SQLCipher)
   (BLE | Wi-Fi | simulation)      │                          │
                                   └── snapshot ──▶ screens   └── recovery at launch
```

- The engine is the **only** consumer of packets during a session.
- `SequenceTracker` drops duplicates (BLE retry, Wi-Fi→BLE overlap), counts gaps,
  and recognises a device restart by `bootId`. A transport swap keeps the tracker,
  which is what makes "fall back without duplicating the session" true.
- Chunks are raw int16 LE samples, exactly as received, with a CRC-32 each.

## How much can a crash lose?

A chunk is flushed when its buffer reaches **512 samples or 1 000 ms**, whichever
first. On a crash the loss is bounded by the unflushed buffer: **at most ~1 s per
channel**. The session row and its channel rows are written *before* the first
packet, so a crash during start-up leaves an empty-but-honest session, never an
orphaned chunk.

A chunk also closes at every sequence gap and at every device restart, so a chunk
is always internally contiguous — no chunk pretends a gap did not happen.

## Recovery at launch

`recoverUnfinishedSessions` runs at startup for the signed-in user:

1. Find sessions still marked `recording` (the crash signature).
2. Verify every chunk against its checksum. Corrupt chunks are counted, not deleted.
3. Rebuild each channel's summary from verified chunks only.
4. Mark the session `interrupted`, close its clock at the last good moment.
5. Show it in History with a keep / delete choice. **Nothing is discarded silently.**

Verified in `src/domain/recording/__tests__/recover-sessions.test.ts` with a torn
chunk in the middle of a session.

## Storage modes

| Mode | When | What the person sees |
|---|---|---|
| `encrypted` | SQLCipher database opened with the Keystore/Keychain key | nothing — it's normal |
| `memory-only` | the encrypted DB could not be opened | a plain notice that recordings will not survive closing the app |

There is no plaintext-on-disk mode. The DB key is 32 random bytes generated once
per install and kept only in Keychain/Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`,
so it does not travel in a backup to another device).

## Recording states (build instruction §22)

`idle → preparing → recording → stopping → saved`, with `failed` reachable from
`preparing` (device would not stream) or `recording` (storage write failed), and
`interrupted` assigned by recovery, never by the live engine.

## Not yet

- Foreground service (Android) / background modes (iOS) — Milestone 7, needs
  physical-device evidence before any claim.
- The sync queue table exists in the schema but nothing writes to it — Milestone 6.
