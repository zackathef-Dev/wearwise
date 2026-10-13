# Cloud schema (Supabase)

_Milestone 6 state: auth slice (M2) + the recorded-session mirror (M6). The local
encrypted SQLite store is always the source of truth; the cloud is an
upload-only mirror._

## Applying

```bash
supabase link --project-ref <ref>      # once, against your project
supabase db push                       # applies supabase/migrations/*
supabase test db                       # runs supabase/tests/*.sql (pgTAP)
```

## profiles — one row per participant

| Column | Type | Notes |
|---|---|---|
| id | uuid PK → auth.users | cascade delete |
| display_name | text ≤80 | the ONLY client-writable column |
| account_role | 'participant' \| 'researcher' \| 'clinician' | **server-controlled**: no UPDATE privilege on the column |
| account_status | 'active' \| 'suspended' \| 'deletion_requested' | server-controlled (no UPDATE privilege) |
| consent_recorded_at | timestamptz NOT NULL | the **server's** time of sign-up; the trigger refuses a sign-up without consent |
| adult_confirmed_at, terms_version, terms_accepted_at | | see "Adults only and terms acceptance" below |
| created_at / updated_at | timestamptz | updated_at by trigger |

## How consent is enforced

Registration sends `consent_recorded_at` (and `display_name`) as auth metadata.
A `security definer` trigger on `auth.users` creates the profile and **raises** if
consent is absent — so a modified client that skips the checkbox cannot create an
account, not merely an unconsented profile.

The metadata is client-written, so only its **presence** counts (a timestamp-shaped
string, which every client sends): the profile records the server's `now()`, never
the client's value (migration 9; before it, 1970 or 9999 were stored verbatim).
The same holds for `adult_confirmed_at` and `terms_accepted_at`.

## RLS

- SELECT: own row only (`id = auth.uid()`).
- UPDATE: own row only, while the account is `active` (any role: researchers and
  clinicians rename themselves too). Column privileges allow `display_name` only, so a
  payload that touches role, status, consent or terms fails with 42501.
- No INSERT or DELETE privilege for clients (trigger-only creation; accounts are
  deleted with `admin.mjs delete-account`, which cascades from `auth.users`).

Executable forms:

- `supabase/tests/rls_profiles.test.sql` — pgTAP, for a local Docker stack.
- `supabase/tests/rls-live.mjs` — the same assertions against the **hosted** project,
  through the public REST/Auth API exactly as the phone uses it. **15/15 passed on
  project `<project-ref>` on 26 Aug 2026**: trigger accepts consent and
  rejects its absence, server refuses a 6-char password, two-user isolation, no
  self-promotion, no cross-user update, no direct insert/delete, anonymous sees
  nothing. Run with `SB_PAT`, `SB_ANON`, `SB_TEST_MAILBOX` in the environment;
  test users are created by SQL and deleted in `finally`.

## recorded_sessions / recorded_channels — the sync mirror (M6)

`supabase/migrations/20260826000002_recordings.sql`. Uploaded by the phone once a
session is finished; **never** the authority over the local copy.

**recorded_sessions** — mirrors the local `Session`, keyed by the same UUID
(idempotent upsert). `status` allows only `complete`/`interrupted`/`discarded` —
a `recording` session is never uploaded. `user_id` defaults to `auth.uid()`.

**recorded_channels** — one row per channel: summary stats, u64 timestamps as text
(no i64 clip), and `storage_path` pointing at the channel's sample bytes.

**Storage bucket `recordings`** (private) — one object per channel at
`{user_id}/{session_id}/{channel_id}.wwch`, a self-describing WWCH container
(`apps/mobile/src/data/sync/chunk-container.ts`) holding every chunk's boundaries,
timestamps and CRC. The download re-verifies each CRC, so the cloud copy is
provably the bytes the device recorded.

### RLS (owner-only, both tables + Storage)

- SELECT/INSERT/UPDATE/DELETE gated on `user_id = auth.uid()`; channel INSERT also
  requires the parent session to belong to the caller.
- Storage policies gate every operation on `(storage.foldername(name))[1] =
  auth.uid()::text` — a participant can only read/write objects under their own
  folder. Since migration 9 a new (or renamed) object must be exactly
  `<own uid>/<session uuid>/<channel uuid>.wwch`, and the bucket is forced private.

### How the upload is idempotent + resumable

The phone's `SyncEngine` uploads the session row, then each channel's payload +
row, recording per-channel progress in the local `session_sync` table. Every
remote write is an UPSERT by UUID / an overwrite by object path, so a retry after a
crash or dropped network resumes exactly where it stopped and never duplicates.

### Verifying

- `supabase/tests/sync-live.mjs` — signs in as a confirmed user, uploads a session +
  channel + payload, reads them back, verifies the payload CRC survived, and (with a
  second account) checks another user cannot read the row or the object. Run with
  `SB_ANON`, `SB_TEST_EMAIL`, `SB_TEST_PW`. **7/7 passed on the hosted project
  `<project-ref>` on 26 Aug 2026** (upload, read-back, CRC round-trip, and
  cross-user RLS denial for both the row and the Storage object).

## Data sharing — share codes and access grants (migration 5)

Participants decide who sees their cloud data. Nobody gets access without the
participant acting, and either side can end it.

1. The participant creates a **share code** in the app (Profile → Privacy & access):
   `create_share_code(sensor_types, include_falls)` → `ABCDE-FGHJK`, single use,
   valid 24 h. Only its sha256 is stored; a new code replaces an unused one.
2. A **viewer** — `account_role` `researcher` or `clinician`, set only by an admin
   (`supabase/scripts/admin.mjs create-viewer` / `set-role`) — redeems it in the web
   dashboard: `redeem_share_code(code)`. Failures are returned, not raised, so they
   count toward a limit of 10 failed attempts per viewer per hour. One redemption per
   viewer runs at a time (advisory lock), so parallel requests can't overrun the
   limit. A code whose participant isn't `active` fails like a wrong code.
   Codes are 10 characters, each uniform over a 31-symbol alphabet (~49.5 bits,
   `gen_random_bytes` with rejection sampling); creating one needs an active account
   that has confirmed 18+ (`account_is_active()`).
3. That creates an **access grant** (`access_grants`: participant, grantee, signals,
   falls). One live grant per pair; re-sharing updates its scope.
4. Read-only RLS for the viewer: the participant's `recorded_sessions` that hold at
   least one channel of a granted signal and aren't `discarded`, the
   `recorded_channels` of granted signals, `fall_events` if included, and the Storage
   objects of those channels — only if the object sits in that participant's own
   folder, so a participant can't point a channel row at someone else's file.
   Session columns are not narrowed: the dashboard reads `configuration_snapshot`
   (`deviceName`, `firmwareVersion`). A column-limited view for viewers is a possible
   later step.
5. Access stops at once when the grant is revoked (`revoke_access_grant`, either
   side), when either account is no longer `active`, or when the viewer loses the
   viewer role. Revoked grants stay as the audit trail (`revoked_at`, `revoked_by`).

| RPC | Caller | Returns |
|---|---|---|
| `create_share_code(smallint[], boolean)` | participant | `code`, `expires_at` |
| `redeem_share_code(text)` | viewer | `{ok, grant_id, participant_name}` or `{ok:false, reason}` |
| `my_pending_share_code()` | participant | scope + expiry of their unused code (the code isn't stored) |
| `cancel_share_code()` | participant | `true` if an unused code was withdrawn |
| `list_my_access_grants()` | participant | grantee name/email/role, scope, since, `access_active` (false while the viewer is suspended or no longer a viewer) — the participant sees the email of each viewer they chose |
| `update_access_grant(uuid, smallint[], boolean)` | participant | `true` if the grant was live and theirs |
| `revoke_access_grant(uuid)` | either side | `true` if this call ended it |
| `list_shared_participants()` | viewer | participant **name only** (`participant_email` is always NULL since migration 9), scope, count and last start of the sessions the viewer can open |

Tests: `supabase/sql-tests/data_sharing.local.sql` (56 checks), run with
`supabase/sql-tests/standalone/run.sh` — a throwaway local Postgres with
`supabase/sql-tests/standalone/supabase-stub.sql` standing in for Supabase's `auth`,
`storage` and `realtime` schemas, so no Docker is needed.

## Vital alerts, alert events and live view (migration 6)

`supabase/migrations/20261015000006_alerts_and_live.sql`, implementing sections 1
and 2 of `docs/architecture/live-view-and-alerts.md` (the contract for names and
formats).

### vital_alerts — high/low alerts from the phone

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | the phone's local alert id; upserts are idempotent on it |
| user_id | uuid → auth.users | default `auth.uid()`, cascade delete |
| session_id | uuid → recorded_sessions, null | cascade delete; null when monitoring without recording |
| sensor_type | smallint 1..6 | sensor-protocol wire code |
| kind | `'high'` \| `'low'` | |
| value | real | most extreme value while open, canonical units |
| started_at / ended_at | timestamptz | `ended_at` null while still out of range |
| created_at / updated_at | timestamptz | **server-maintained**: clients have no INSERT/UPDATE privilege on them |

Falls stay in `fall_events`. RLS:

- The participant reads, upserts and deletes their own rows. A `session_id`, when
  given, must be one of their own sessions **already uploaded** — an alert for a
  session still recording is refused (42501) until the session row exists.
- Only an `active` account inserts or updates (as for sessions, channels, falls).
- A researcher/clinician reads a row while they hold a live grant from the owner
  that includes its `sensor_type` (same `private.my_live_grants()` rule as
  `recorded_channels`). Never writes.
- Privileges start from nothing (no TRUNCATE, nothing for `anon`):
  SELECT/DELETE, and INSERT/UPDATE on every column except the timestamps.

### Realtime: postgres_changes

`fall_events` and `vital_alerts` are in the `supabase_realtime` publication. The
dashboard subscribes to INSERT and UPDATE; Realtime runs each change through the
subscriber's SELECT policies, so a viewer only gets rows they could query. Delete
events are not RLS-filtered (they carry the id to every subscriber), so since
migration 9 the publication publishes **INSERT and UPDATE only**
(`publish = 'insert, update'`). That setting is per publication, i.e. it applies to
every table in `supabase_realtime`: a table added later (e.g. with the Dashboard's
"Enable Realtime" switch) gets no DELETE events either. Migration 9 only changes it
while the publication holds just these two tables (and isn't FOR ALL TABLES);
otherwise it leaves it and raises a WARNING — then decide by hand. anon has no
privilege on either table.

### Realtime: live view (broadcast, nothing stored)

The phone broadcasts on the **private** channel `live:<access_grants.id>` (lowercase
UUID, exactly as PostgREST returns it) for each live grant. RLS on
`realtime.messages`, keyed on `realtime.topic()`:

| Policy | Op | Who | When |
|---|---|---|---|
| `live: participant sends on own grant` | INSERT (send) | the grant's participant | grant not revoked, participant `active` |
| `live: participant joins own grant channel` | SELECT (join) | the grant's participant | same as send |
| `live: grantee receives` | SELECT (receive) | the grant's grantee | grant live per `my_live_grants()`: not revoked, both accounts `active`, grantee researcher/clinician |
| `alerts: user joins own changes channel` | SELECT (join) | any signed-in user, topic `alerts:<own uid>` | always; nobody may send there |

- All four require `extension = 'broadcast'`; presence is not allowed (the `status`
  event already says whether the phone is live).
- The participant may join their own grant's channel because Realtime refuses to
  join a private channel without broadcast-read permission, even to send. They
  only ever see their own readings there.
- Checks live in `private.live_topic_grant_id(text)` (topic → grant id, null for
  anything malformed, never an error), `private.can_send_live(text)` and
  `private.can_receive_live(text)` (security definer, `search_path = ''`).
- `alerts:<uid>` exists only so the dashboard has a private channel to put its
  postgres_changes subscription on once public access is off (below).
- Realtime checks these policies when a channel is joined or first sent on, and
  then caches the result — not per message. Revoking a grant does not close a
  channel already open; the phone stops sending for grants that leave its list,
  and the dashboard leaves channels for grants it no longer has. Live view also
  switches itself off at the end of the time the participant chose (30 minutes up
  to 8 hours).

Tests: `supabase/sql-tests/alerts_and_live.local.sql` (64 checks) — owner CRUD,
cross-user isolation, viewer scope by signal, suspension, revoke, and the
Realtime send/receive probes the server runs (including malformed topics and
presence).

## Applied server configuration (via Management API, 26 Aug 2026)

| Setting | Value | Why |
|---|---|---|
| `password_min_length` | **10** (was 6) | server half of the client rule |
| `uri_allow_list` | `wearwise://auth/confirmed,wearwise://auth/reset` | confirm/reset emails open the app, not localhost |
| `mailer_autoconfirm` | off | email confirmation stays on |

## ⚠ Realtime "Allow public access" — turn it off before live view ships

Dashboard → Realtime → Settings → **Allow public access: off** (not yet applied).

While it is on, a client that forgets `{ private: true }` silently joins a *public*
channel of the same name, where no RLS applies: the phone would broadcast a
participant's live vitals to anyone who has the anon key (it ships in every app)
and the grant id, and anyone could inject fake readings into a dashboard. With it
off, Realtime rejects every non-private channel, so that mistake fails loudly.

Consequence: **every** channel must then be private and have a read policy — the
dashboard's postgres_changes channel must be `alerts:<its own user id>` with
`{ private: true }`. Before switching, check `realtime.messages` has no other,
broader policies (permissive policies are OR'ed, so one `using (true)` would open
every `live:` topic).

## ⚠ Sign-up email cap — must be fixed before real participants

The project has **no custom SMTP**, so Supabase's built-in mailer applies:
`rate_limit_email_sent = 2` per hour, project-wide. With email confirmation on,
that means **at most two sign-ups per hour for the whole app**. This is a platform
limit, not a bug in ours, and it blocked the first verification run (HTTP 429
`over_email_send_rate_limit`).

Fix before any study enrolment: Dashboard → Authentication → SMTP Settings →
configure a provider (Resend, Postmark, SES — all have free tiers), then raise
`rate_limit_email_sent`. Until then, demos should use pre-created accounts.

## Not yet decided / deferred

- Password strength is enforced client-side at ≥10 chars; set the same minimum in
  the Supabase dashboard (Auth → Policies) when the project is created — the
  dashboard is the server half of that rule.
- Deep-link handling for confirm/reset URLs (`wearwise://auth/...`) is registered
  in the app scheme but the in-app landing screens are Milestone 2 follow-up work
  once a real project exists to send the emails.

## Adults only and terms acceptance (migrations 7 and 8)

`20261016000007_adults_only.sql`:
- `profiles.adult_confirmed_at`: when the account declared it is 18 or older.
- The sign-up trigger refuses metadata without `adult_confirmed_at`.
- `public.confirm_adult()` lets accounts made before the rule confirm once. It is idempotent: the first answer is the one recorded.
- `public.account_is_active()` now also requires the confirmation, so an unconfirmed account can read and delete its data but not upload or send live view.
- Confirmations recorded only in account metadata (made while the server lacked the function) are carried over by `private.carry_over_adult_confirmations()`, with the server's time.

`20261016000008_terms_acceptance.sql`:
- `profiles.terms_version` (YYYY-MM-DD) and `terms_accepted_at` record what each account last accepted (`packages/legal`, `ACCEPTANCE_VERSION`).
- Sign-up requires `terms_version` in metadata.
- `public.accept_terms(version)` only moves forward.
- Metadata-only acceptances are carried over, with the server's time.
- Terms acceptance doesn't gate uploads; consent and the 18+ declaration do.

Since migration 9 a version must also be one the server lists in
`private.terms_versions` (seeded with `2026-10-16`), at sign-up and in
`accept_terms()`; anything else is refused (`accept_terms`: 22023). Versions are
effective dates and may lie in the future: they are never compared with today's
date. **When the terms change**, add the new `ACCEPTANCE_VERSION` in a migration
(`insert into private.terms_versions (version) values ('YYYY-MM-DD')`) before the
apps that send it ship. Stored versions the server didn't know (e.g. the
`2000-01-01` placeholder staff accounts used to get) were reset to "not accepted".

Neither column is client-writable; the only client-writable column on `profiles` is still `display_name`. Tests: `supabase/sql-tests/adults_only.local.sql`, `supabase/sql-tests/terms_acceptance.local.sql`.

## Security review (migration 9)

`20261016000009_security_review.sql`, from the 2026-10-13 review. Tests:
`supabase/sql-tests/security_review.local.sql` (101 checks, including a real two-connection
race through `dblink`); `run.sh` runs 261 checks in all.

| # | Finding | Fix |
|---|---|---|
| 1 | Viewers received each participant's email | `list_shared_participants()` keeps the `participant_email` column for compatibility but returns NULL; viewers see the display name |
| 2 | Migrations 1-3 tables kept Supabase's default grants (TRUNCATE included, for anon too) | Least privilege (below); default privileges for future objects closed |
| 3 | Server-stamped columns were client-writable | Column-level INSERT/UPDATE grants on `recorded_sessions` / `recorded_channels`, timestamps excluded |
| 4 | Consent / 18+ / terms times were client-chosen; any `YYYY-MM-DD` was a "version" | Server `now()`; `private.terms_versions` allow-list |
| 5 | Share-code rate limit raceable; weak code generation; suspended participant's code "succeeded"; unconfirmed accounts could share | Advisory lock; `gen_random_bytes` + rejection sampling; refused as invalid; `account_is_active()` required |
| 6 | Viewers read every session's metadata, discarded ones included | Only sessions with a channel of a granted signal, never `discarded` |
| 7 | Bucket privacy not enforced; free-form object names | `public = false`; RESTRICTIVE INSERT/UPDATE policies: `<uid>/<session uuid>/<channel uuid>.wwch` only |
| 8 | Realtime DELETE events aren't RLS-filtered | Publication publishes INSERT/UPDATE only (see Realtime above) |
| 9 | Researchers/clinicians couldn't rename themselves | UPDATE policy allows any role (columns still limited to `display_name`) |
| 10 | Admin tooling left sessions alive, accepted unconfirmed emails, had no full account delete | See `docs/operations/researcher-access.md` |
| 11 | Grantees read their grant rows after revocation / suspension | Grantee reads only live grants; the participant still reads all, revoked included (audit trail) |

**Privileges for the API roles now** (anon has nothing on any table in `public`, and
can execute no function in `public` or `private`):

| Table | authenticated |
|---|---|
| profiles | SELECT; UPDATE (`display_name`) |
| recorded_sessions | SELECT, DELETE; INSERT/UPDATE on every column except `synced_at`, `created_at`, `updated_at` |
| recorded_channels | SELECT, DELETE; INSERT/UPDATE on every column except `created_at` |
| fall_events | SELECT, INSERT, UPDATE, DELETE (`created_at` is the phone's clock by design) |
| vital_alerts | unchanged (migration 6) |
| share_codes, share_code_attempts | nothing (RPC only) |
| access_grants | SELECT |

Functions `authenticated` may execute in `public`: `account_is_active` (used by the
write policies) and the RPCs `create_share_code`, `redeem_share_code`,
`revoke_access_grant`, `update_access_grant`, `my_pending_share_code`,
`cancel_share_code`, `list_my_access_grants`, `list_shared_participants`,
`confirm_adult`, `accept_terms`. Trigger functions need no grant.

Default privileges for what `postgres` creates from now on: no table, sequence or
function access for anon/authenticated. For functions this needed the *global*
`alter default privileges for role postgres revoke execute on functions from public`
(PUBLIC's EXECUTE is a built-in default a per-schema revoke can't remove), so it
covers functions `postgres` creates in **any** schema: every new function needs an
explicit `grant execute ... to authenticated` if clients or policies call it. If an
extension enabled later as `postgres` exposes functions clients must call, grant
them explicitly too. `service_role` keeps its defaults.

Not changed: a viewer still sees all columns of a session it may read (a
column-limited view is a possible later step); a participant reads the email of the
viewers they share with (`list_my_access_grants`), which they chose themselves.
