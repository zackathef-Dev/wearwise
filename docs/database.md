# WearWise backend (Supabase)

The backend is one Supabase project: Postgres 17, Auth, Storage, Realtime and the
auto-generated REST API (PostgREST). There are **no Edge Functions** and no server code
outside the database. All server-side logic is Postgres functions, triggers and Row Level
Security (RLS) policies, created by the migrations in `supabase/migrations/`.

The same migrations build:

- a **local** stack (Docker, `supabase start`), for development and handover;
- the owner's **Supabase Cloud** project (`supabase db push`);
- a **self-hosted** Supabase (apply the migrations to its database).

See [deployment.md](deployment.md) for the hosted variants. This page covers the schema,
security model, local operation and tests.

## Contents of `supabase/`

| Path | What |
|---|---|
| `config.toml` | Local stack configuration (ports, auth settings, bucket seeding). Every setting changed from the CLI default is marked `WearWise:`. |
| `migrations/` | The schema, in order. **The only way the schema changes.** |
| `seed.sql`, `seed/demo-recordings.sql`, `seed/recordings/` | Synthetic demo data for local development (below) |
| `scripts/generate-demo-recordings.mjs` | Regenerates `seed/demo-recordings.sql` and `seed/recordings/` |
| `scripts/admin.mjs` | Admin helper for a **hosted** project (Management API) |
| `admin/*.sql` | Admin snippets to paste into Studio's SQL editor (local or hosted): create a researcher, change a role or status, reset a password, overview, orphaned files |
| `tests/` | pgTAP tests (`supabase test db`) and API-level scripts (`rls-live.mjs`, `sync-live.mjs`) |
| `sql-tests/` | Plain-SQL RLS and security suites (277 checks), with two runners (below) |

## Running it locally

Needs Docker (Docker Desktop or another Docker-compatible runtime) and the Supabase CLI
(tested with **2.120.0**). Run these from the repository root:

```bash
supabase start          # first run downloads the images (several GB), then applies
                        # every migration and the demo seed
supabase status         # URLs and the local development keys
supabase db reset       # wipe the local database, re-apply migrations + seed
supabase stop           # stop (data kept); `supabase stop --no-backup` also deletes the data
```

| Local service | URL |
|---|---|
| API (REST, Auth, Storage, Realtime): what the apps use | `http://127.0.0.1:54321` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio (database UI, SQL editor) | `http://127.0.0.1:54323` |
| Mailpit (every email the local Auth sends) | `http://127.0.0.1:54324` |

The local keys printed by `supabase status` (`PUBLISHABLE_KEY`, `ANON_KEY`, `SECRET_KEY`,
`SERVICE_ROLE_KEY`) are the CLI's **development defaults**. They are the same on every
machine and only work against your own local stack. The apps need only the publishable
(anon) key, and `npm run backend:local` writes it for them.

> The local stack publishes its ports on **all network interfaces**, so phones on the same
> Wi-Fi can reach the API. That also exposes the database (`postgres` / `postgres`) and
> Studio to that network. Run it only on a network you trust, or block ports 54322–54324 in
> your firewall and leave only 54321 open.

## Schema overview

```
auth.users ──1:1── public.profiles            (role, status, consent, 18+, terms)
     │
     ├──< public.recorded_sessions ──< public.recorded_channels ──▶ storage: recordings/<user>/<session>/<channel>.wwch
     │              ├──< public.fall_events
     │              └──< public.vital_alerts (session optional)
     │
     ├──< public.share_codes            (hashed one-time codes; RPC only)
     ├──< public.share_code_attempts    (rate limit; RPC only)
     └──< public.access_grants >── auth.users (grantee: researcher / clinician)

private.terms_versions        allowed terms versions (not exposed through the API)
private.*()                   helper functions used by policies and RPCs
realtime.messages policies    who may send and receive on live:<grant id> and alerts:<user id>
```

Every user-owned table references `auth.users` with `on delete cascade`, so deleting an
account deletes its rows. Its Storage files must be removed first (`admin.mjs delete-account`
does both).

### Tables

| Table | One row per | Written by | Key columns |
|---|---|---|---|
| `profiles` | account | sign-up trigger only | `display_name` (the only client-writable column), `account_role` participant/researcher/clinician, `account_status` active/suspended/deletion_requested, `consent_recorded_at`, `adult_confirmed_at`, `terms_version`, `terms_accepted_at` |
| `recorded_sessions` | finished recording | the phone (upsert by the local session UUID) | `user_id`, `device_id`, `started_at`, `ended_at`, `status` complete/interrupted/discarded, `simulated`, transports, `configuration_snapshot` (device name, firmware, channels) |
| `recorded_channels` | signal in a session | the phone | `sensor_type` (wire code 1–6), unit, rate, sample count, min/max/avg, first/last device timestamps, `storage_path` |
| `fall_events` | possible fall in a recorded session | the phone | `detected_at_ms` (session time), `freefall_min_g`, `impact_peak_g`, `status` emergency/cancelled |
| `vital_alerts` | high/low episode | the phone | `sensor_type`, `kind` high/low, `value` (most extreme), `started_at`, `ended_at`, `session_id` (nullable) |
| `share_codes` | share code | `create_share_code()` | `code_hash` (SHA-256 only), scope (`sensor_types`, `include_falls`), 24 h expiry, redemption |
| `share_code_attempts` | redemption attempt | `redeem_share_code()` | for the 10-failures-per-hour limit |
| `access_grants` | participant → viewer grant | `redeem_share_code()`, `update_access_grant()`, `revoke_access_grant()` | scope; `revoked_at`/`revoked_by` (revoked rows are kept as the audit trail); one live grant per pair |
| `private.terms_versions` | terms version the server accepts | migrations | add a row when the terms change (below) |

### Functions callable by signed-in users (RPCs)

All `security definer` with `search_path = ''`. `anon` can execute none of them. Call them
with named arguments, e.g. `supabase.rpc('create_share_code', { p_sensor_types: [1, 4], p_include_falls: true })`.

| Function | Caller | Purpose |
|---|---|---|
| `create_share_code(p_sensor_types smallint[], p_include_falls boolean)` | participant | New single-use code `XXXXX-XXXXX` (24 h); replaces an unused one |
| `my_pending_share_code()` / `cancel_share_code()` | participant | Show or withdraw the unused code |
| `redeem_share_code(p_code text)` | researcher / clinician | Creates the access grant; failures are returned (not raised) and rate-limited |
| `list_my_access_grants()` | participant | Who has access, scope, since when |
| `update_access_grant(p_grant_id uuid, p_sensor_types smallint[], p_include_falls boolean)` | participant | Change a grant's scope |
| `revoke_access_grant(p_grant_id uuid)` | either side | End a grant |
| `list_shared_participants()` | viewer | Participants sharing with me (display name only, never email) |
| `confirm_adult()` / `accept_terms(p_version text)` | any account | One-time 18+ confirmation; accept a newer terms version |
| `account_is_active()` | used by the write policies | Active, confirmed 18+ account |

Triggers: `create_profile_after_signup` on `auth.users` (creates the profile and **refuses
a sign-up** without consent, 18+ and a known terms version), and `set_updated_at` on
profiles, sessions, grants and alerts.

## Row Level Security

RLS is **enabled on every table in `public`**, and privileges start from nothing: `anon`
has no table privilege and can execute no function. `authenticated` gets only what is
listed below, and RLS then decides which rows. Verified on a fresh local stack: the
queries are at the end of this page.

### Per table, for a signed-in user

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own row | — (trigger only) | own row, **`display_name` column only**, while active | — (account deletion is an admin flow) |
| `recorded_sessions` | own rows; a viewer also reads a participant's non-discarded sessions that contain a channel of a granted signal | own rows, active + 18+ accounts only; server-stamped columns excluded | own rows, active accounts only; server-stamped columns excluded | own rows |
| `recorded_channels` | own rows; viewer: channels of granted signals | own rows, into own sessions only, active accounts | own rows, can't move to someone else's session | own rows |
| `fall_events` | own rows; viewer: if the grant includes falls | own rows, into own sessions, active accounts | own rows, as INSERT | own rows |
| `vital_alerts` | own rows; viewer: alerts of granted signals | own rows; a `session_id` must be an own, already-uploaded session; active accounts | as INSERT; `created_at`/`updated_at` server-only | own rows |
| `access_grants` | participant: own grants including revoked ones (audit); grantee: only **live** grants | — (RPC only) | — (RPC only) | — |
| `share_codes`, `share_code_attempts` | — | — | — | — (no privileges at all; RPC only) |

"Viewer" means an account whose role is researcher or clinician, holding a **live** grant
from that participant: not revoked, both accounts active, the grantee still a viewer. Access
ends the moment any of these stops being true. RESTRICTIVE policies (the "active accounts"
ones) are ANDed with the permissive ones, so a suspended account can still read and delete
its own data but can't upload.

### Storage: bucket `recordings`

Private (`public = false`), 50 MiB per file, `application/octet-stream` only.

| Operation | Allowed when |
|---|---|
| read | the object is in your own folder (`<your user id>/…`), or you are a viewer with a live grant covering the channel row that points at it, and the object is in that participant's folder |
| insert / update | your own folder, an active account, and the name has exactly the form `<your uid>/<session uuid>/<channel uuid>.wwch` |
| delete | your own folder |

### Realtime

- **Postgres changes:** `fall_events` and `vital_alerts` are in the `supabase_realtime`
  publication, INSERT and UPDATE only (DELETE events aren't RLS-filtered, so they're not
  published). Subscribers receive only rows their SELECT policies allow.
- **Broadcast** (`realtime.messages` policies, private channels only, no presence):
  - `live:<grant id>`: the grant's participant may send and join. The grantee may receive
    while the grant is live, and may also send (migration 10). RLS can't narrow that to
    particular events, because Realtime checks a probe with no event name. Only the two
    parties are on the channel, though, and the phone acts only on `stop`, `record` and
    `record-stop` from a viewer and ignores anything else.
  - `alerts:<own user id>`: any signed-in user may join their own (used by the dashboard
    for its postgres-changes subscription). Nobody may send.
- Hosted projects: set **Realtime → Settings → "Allow public access" off**, so a client that
  forgets `private: true` fails instead of joining an unprotected public channel.

### Where the details are

The migration files are commented line by line. For the reasoning behind each rule and its
history (security findings and fixes), read `docs/database/cloud-schema.md` and
`docs/security/audit-2026-10-13.md`.

## Migrations

| # | File | Adds |
|---|---|---|
| 1 | `20260826000001_profiles.sql` | profiles, sign-up trigger with consent gate |
| 2 | `20260826000002_recordings.sql` | recorded_sessions / recorded_channels, `recordings` bucket and policies |
| 3 | `20261012000003_fall_events.sql` | fall_events |
| 4 | `20261013000004_security_hardening.sql` | column privileges, active-account gate, bucket limits |
| 5 | `20261014000005_data_sharing.sql` | share codes, access grants, viewer read policies, sharing RPCs |
| 6 | `20261015000006_alerts_and_live.sql` | vital_alerts, Realtime publication, live-view broadcast policies |
| 7 | `20261016000007_adults_only.sql` | 18+ declaration |
| 8 | `20261016000008_terms_acceptance.sql` | terms version and acceptance |
| 9 | `20261016000009_security_review.sql` | least privilege, server-stamped times, terms allow-list, share-code hardening, object-name rules |
| 10 | `20261017000010_live_viewer_stop.sql` | viewer may send stop/record requests on live view |
| 11 | `20261017000011_terms_2026_10_17.sql` | terms version 2026-10-17 |

### Changing the schema

1. `supabase migration new <short_name>` creates `supabase/migrations/<timestamp>_<short_name>.sql`.
2. Write the SQL. For a new table: `enable row level security`, explicit `grant`s to
   `authenticated` (default privileges are closed since migration 9, so nothing is
   granted automatically), policies for each operation, and indexes on foreign keys.
3. `supabase db reset` applies everything from scratch, then add or extend a test in
   `sql-tests/` and run `bash supabase/sql-tests/run-on-local-stack.sh`.
4. Update the apps (types and queries) and this page.
5. Hosted: `supabase db push` (see [deployment.md](deployment.md)). **Never edit a migration
   that has been applied anywhere**: add a new one.

**When the terms change:** add the new `ACCEPTANCE_VERSION` (`packages/legal`) in a
migration (`insert into private.terms_versions (version) values ('YYYY-MM-DD');`) and apply
it *before* shipping apps that send it. Sign-up refuses unknown versions.

## Demo seed (local only)

`supabase start` (first time) and `supabase db reset` load synthetic data. It is all
simulated, uses the reserved `.invalid` domain, and the seed refuses to run on a database
that already has other accounts.

| Email | Password | Role | Purpose |
|---|---|---|---|
| `demo.participant@example.invalid` | `wearwise-demo-only` | participant | Has two simulated recordings and shares everything with the researcher |
| `demo.other@example.invalid` | `wearwise-demo-only` | participant | One recording, shares nothing (for checking isolation) |
| `demo.researcher@example.invalid` | `wearwise-demo-only` | researcher | Signs in to the web dashboard |

**These credentials are for a local stack only.** Never create them on a hosted project.

The recordings (`seed/demo-recordings.sql` + `seed/recordings/`) contain a 3-minute session
with all six signals, a high-heart-rate alert and a possible fall the participant answered
"I'm OK", plus two shorter sessions. They are uploaded into Storage by the CLI, so the
dashboard can chart them and a phone signed in as the demo participant restores them into
History. To change them, edit and run `node supabase/scripts/generate-demo-recordings.mjs`.

`supabase db reset --no-seed` skips the SQL seed, but the CLI still uploads the seed files
into Storage.

### Creating more test accounts

- **From the app:** register normally. Email confirmation is **off locally** (config.toml),
  so the account works at once. Mail that would be sent appears in Mailpit.
- **A researcher:** Studio → SQL Editor → paste `supabase/admin/create-viewer.sql`, change
  the marked values, Run. Or promote an existing account with `admin/set-role.sql`.
  Researchers have no sign-up page.

## Tests

| What | Command | Needs |
|---|---|---|
| All database suites on the **real local stack** (277 plain-SQL checks + pgTAP). Resets the local DB. | `bash supabase/sql-tests/run-on-local-stack.sh` | Docker, CLI, `supabase start` |
| pgTAP only | `supabase test db` | local stack |
| The same plain-SQL suites on a throwaway Postgres (no Docker) | `PG_BIN=/path/to/pg/bin supabase/sql-tests/standalone/run.sh` | Postgres 15+ binaries, zsh |
| Sync + Storage RLS through the public API | `SB_URL=http://127.0.0.1:54321 SB_ANON=<publishable key> SB_TEST_EMAIL=demo.participant@example.invalid SB_TEST_PW=wearwise-demo-only SB_OTHER_EMAIL=demo.other@example.invalid SB_OTHER_PW=wearwise-demo-only node supabase/tests/sync-live.mjs` | local stack (or a hosted project) |
| Profiles RLS through the public API, **hosted** project | `node supabase/tests/rls-live.mjs` (needs `SB_PROJECT_REF`, `SB_ANON`, `SB_PAT`, `SB_TEST_MAILBOX`) | a hosted project |

### Checking RLS yourself

```sql
-- Every table in public has RLS on (expect no rows):
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
-- What anon can touch (expect no rows):
select table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';
-- Every policy:
select tablename, policyname, permissive, cmd from pg_policies
 where schemaname in ('public', 'storage', 'realtime') order by 1, 4, 2;
```

### Checking a hosted project matches the migrations

`supabase/admin/schema-fingerprint.sql` is read-only and reads no user data. It returns one
hash per area of the schema. Run it on the hosted project (SQL Editor, or after `supabase login`:
`supabase db query --linked --project-ref <ref> -f supabase/admin/schema-fingerprint.sql`)
and compare with a fresh local build of these migrations (`supabase db reset`, then
`supabase db query --local -f supabase/admin/schema-fingerprint.sql`). For the 11 migrations
at handover, a fresh build gives:

| area | fingerprint |
|---|---|
| columns | `47c2670722640be5f7e22611640387fa` |
| rls | `dccd36dfe82330cb3950bab08b8d9f12` |
| policies | `9a18103bdc33fde5f539324ff65d37d0` |
| functions | `7c58ef4f02a3acbf215a81e19088e86d` |
| triggers | `0501acced271fa01b3810925afb5cef6` |
| grants | `c9dd14fec7d3b7ce5ed9aa496eafc549` |
| bucket | `0a34a4996447d604e93e9bbf900b05cf` |
| realtime | `807123203bf8369d1c3acebd7d31b0ec` |
| terms | `2026-10-16,2026-10-17` |

A differing row means the hosted database was changed outside the migrations (or a
migration is missing there). Comments inside function bodies count too: the original capstone
project's `functions` hash differs only because its copy of `list_my_access_grants()` lacks a
two-line comment that migration 9 has (checked 14 October 2026; every other area matches). Rerun that part of the query without `md5()` on both sides to
see the difference, and turn any change you want to keep into a new migration.

## Settings that live outside the migrations

These are project settings, not SQL. Locally they're in `config.toml`; on a hosted project,
set them in the dashboard.

| Setting | Value | Local (`config.toml`) | Hosted (dashboard) |
|---|---|---|---|
| Minimum password length | 10 | `auth.minimum_password_length` | Authentication → Policies / Providers → Email |
| Redirect URLs | `wearwise://auth/confirmed`, `wearwise://auth/reset`, `<dashboard origin>/reset-password` | `auth.additional_redirect_urls` | Authentication → URL Configuration |
| Site URL | the dashboard's origin | `auth.site_url` | Authentication → URL Configuration |
| Email confirmation | **on** for real participants | off (local convenience) | Authentication → Providers → Email |
| SMTP | a real provider (the built-in mailer allows about 2 emails per hour) | Mailpit | Authentication → SMTP Settings |
| Realtime public access | **off** | n/a | Realtime → Settings |
| Postgres version | 17 | `db.major_version` | fixed at project creation |
