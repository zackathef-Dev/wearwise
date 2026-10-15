# Local schema (SQLCipher, on the phone)

Owner: `apps/mobile/src/data/local/sqlite-session-store.ts`. Migrations are an
ordered array applied in a transaction; `app_metadata.schema_version` records the
last applied. **Append, never edit a shipped migration.**

## Encryption

op-sqlite built with `OP_SQLITE_USE_SQLCIPHER` (`"op-sqlite": {"sqlcipher": true}`
in the app's package.json). Key: 64 hex chars from `expo-crypto`, stored in
Keychain/Keystore, see `platform/secure-storage/database-key.ts`. The app has no
plaintext database path.

**Proof of encryption** (Milestone 3 spike, on device): the raw file must not begin
with the SQLite header bytes `53 51 4C 69 74 65` ("SQLite"). Checked by
`docs/testing/hardware-test-matrix.md` step "local database".

## Tables (v1)

| Table | Purpose |
|---|---|
| `app_metadata` | key/value; schema version |
| `devices` | paired wearables (filled from Milestone 4) |
| `device_capabilities` | (device, sensor) → rate, unit |
| `sessions` | one recording |
| `session_channels` | one per (session, sensor): summary + unit + rate |
| `sample_chunks` | raw int16 LE payload + CRC-32, contiguous run per channel |
| `sync_queue` | durable upload queue (written from Milestone 6) |
| `connection_events` | transport state changes (written from Milestone 4) |

### sessions

| column | type | notes |
|---|---|---|
| id | text PK | UUID; later the sync idempotency key |
| user_id, device_id | text | |
| started_at, ended_at | text ISO UTC | |
| duration_ms | integer | |
| status | text | `recording` \| `complete` \| `interrupted` \| `discarded` (CHECK) |
| simulated | integer 0/1 | set from `FLAG_SIMULATED` in the first packet |
| initial_transport, final_transport | text | `bluetooth` \| `wifi` \| `simulation` |
| transport_switch_count | integer | |
| configuration_snapshot | text JSON | device, firmware, protocol, channel rates at start |
| recovery_state | text JSON \| null | set by recovery |
| created_at, updated_at | text | |

Indexes: `(user_id, started_at desc)`, `(status)`.

### session_channels

`id`, `session_id` FK, `sensor_type` (protocol code), `canonical_unit`,
`sample_rate`, `sample_count`, `minimum_value`, `maximum_value`, `average_value`,
`first_timestamp`, `last_timestamp`.

### sample_chunks

`id`, `session_id` FK, `channel_id` FK, `chunk_number`, `first_sequence`,
`last_sequence`, `started_at`, `ended_at`, `sample_count`, `encoding`
(`int16le-v1`), `payload` BLOB, `checksum` (CRC-32 of payload), `created_at`.
Unique `(channel_id, chunk_number)`.

### alerts (v7, cloud columns v9)

Abnormal readings (`kind` `high` | `low`) and falls (`fall`), with or without a
recording: `id`, `user_id`, `session_id` (FK, set null when the session is deleted),
`device_id`, `sensor_type` (null for a fall), `kind`, `value` (most extreme while
open), `started_at`, `ended_at` (null while open), `seen`.

v9 adds the bookkeeping for mirroring vital alerts (high/low only) to
`public.vital_alerts` (see `docs/architecture/live-view-and-alerts.md` §1):

| column | type | notes |
|---|---|---|
| cloud_revision | integer, default 1 | +1 on every local change (value, ended_at) |
| cloud_synced_revision | integer, default 0 | the revision last uploaded; behind → upload again |
| cloud_link_settled | integer 0/1, default 0 | the cloud row carries its session link, or never will (no session) |

A session's alerts are uploaded with `session_id` null until that session itself is
in the cloud (the server refuses a link to a session it doesn't have), then once
more with the link. Rows that existed before v9 start at revision 1 / synced 0, so
they are uploaded once too.

## Two deliberate representation choices

- **Timestamps in microseconds are TEXT, not INTEGER.** They are u64; SQLite
  INTEGER is signed 64-bit. TEXT round-trips `BigInt` exactly.
- **Payloads are the wire bytes.** No re-encoding on the way in, so a chunk can be
  verified against exactly what the device sent, and later uploaded as-is.
