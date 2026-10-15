# Milestone 6 cloud sync — LIVE verification, 26 Aug 2026

Migration `20260826000002_recordings` applied to hosted project
`<project-ref>` via the Management API. Verified: 2 tables, 8 row
policies, 4 storage policies, `recordings` bucket, RLS enabled on both tables.

## Tier 2 — sync-live.mjs (public REST/Auth/Storage API, as the phone uses)
7 passed, 0 failed:
- insert session (201), upload payload to Storage (200), insert channel (201)
- read back session row
- payload survived round trip (CRC clean)
- another user CANNOT read this session (RLS)
- another user CANNOT download this payload (Storage RLS)

## On-device end-to-end (Samsung SM-G977N, a study test account)
- Home banner: "BACKING UP YOUR SESSIONS…" → "ALL SESSIONS BACKED UP"
  (84-m6-sync.png, 85-m6-synced.png).
- Cloud after sync: 9 recorded_sessions, 27 recorded_channels, 27 Storage objects,
  all owned by the signed-in participant.
- Downloaded 3 phone-uploaded objects as the device user and re-verified them:
    sensor 1 (ECG)  7984B  18 chunks  3626 samples (declared 3626)
    sensor 3 (temp) 1410B  22 chunks   259 samples (declared 259)
    sensor 2 (SpO2) 3882B  32 chunks  1295 samples (declared 1295)
  ALL VERIFIED — 72 chunks CRC-checked. The bytes in the cloud are exactly what the
  device recorded.
