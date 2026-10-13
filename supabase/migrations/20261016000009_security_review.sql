-- WearWise: fixes from the 2026-10-13 security review of the Supabase backend.
-- Tests: supabase/tests/security_review.local.sql (supabase/tests/local/run.sh).
--
--  1. Viewers no longer receive a participant's email. list_shared_participants()
--     keeps its participant_email column (so deployed dashboards keep parsing the
--     result) but it is always NULL; the participant's display name is what a viewer
--     sees. Its session count and last-session time now count only the sessions the
--     viewer can actually open (item 6).
--  2. Least privilege for the API roles. The tables from migrations 1-3 still had
--     Supabase's default grants: everything, TRUNCATE included, for anon and
--     authenticated. TRUNCATE bypasses RLS, so a participant could empty everyone's
--     fall_events. Each of those tables now starts from nothing and gets back only
--     what the apps use (REVOKE ALL also covers PG17's MAINTAIN). Default privileges
--     for objects postgres creates later stop handing anything to anon/authenticated:
--     tables, sequences and functions alike. Functions need the global (not
--     per-schema) revoke from PUBLIC, because PUBLIC's EXECUTE is a built-in default
--     that a per-schema ALTER DEFAULT PRIVILEGES cannot take away. Every function the
--     clients call keeps an explicit EXECUTE grant to authenticated; nothing in
--     public is executable by anon.
--  3. Server-stamped columns stay server-stamped. recorded_sessions.synced_at /
--     created_at / updated_at and recorded_channels.created_at were client-writable;
--     INSERT/UPDATE are now granted per column (every column the phone's upsert sends,
--     as for vital_alerts), the timestamps excluded. fall_events.created_at is the
--     phone's own wall clock by design and stays writable.
--  4. Consent, 18+ and terms records are server facts. The sign-up trigger stamps
--     now() for consent_recorded_at, adult_confirmed_at and terms_accepted_at; the
--     metadata values only have to be present (a timestamp-shaped string, as every
--     client sends) — a client could otherwise record 1970 or 9999. terms_version must
--     be one the server knows (private.terms_versions), both at sign-up and in
--     accept_terms(); add a row there when the terms change. Versions are effective
--     dates and may be in the future, so they are never compared with today.
--     Profiles holding a version the server doesn't know (e.g. the '2000-01-01'
--     placeholder staff accounts were made with) are reset to "not accepted", so the
--     person is asked to accept the current terms. The carry-over functions follow
--     the same rules (20261016000007/8 now stamp now() as well).
--  5. Share codes. redeem_share_code() takes a per-viewer advisory lock before
--     counting failed attempts, so concurrent calls can't all slip under the limit of
--     10 an hour. Codes are drawn from pgcrypto's gen_random_bytes with rejection
--     sampling: each of the 10 characters is uniform over the 31-symbol alphabet
--     (~49.5 bits; the UUID-based draw had ~48.5 and one position with 16 symbols).
--     A code whose participant is not active is refused exactly like an invalid one
--     (it used to "succeed" without the participant ever appearing). Creating a code
--     needs public.account_is_active() (so the 18+ confirmation), like every upload.
--  6. A viewer reads a session only when it has at least one channel of a signal
--     they were granted, and never a discarded one (checked by the security-definer
--     private.session_has_granted_channel(), so the policy doesn't recurse through
--     recorded_channels' policies). Columns are unchanged: the dashboard reads
--     configuration_snapshot's deviceName / firmwareVersion. A column-limited view is
--     a possible later step.
--  7. Storage: the recordings bucket is forced private, and a new object in it must be
--     named <own uid>/<session uuid>/<channel uuid>.wwch — exactly what the phone's
--     sync engine writes. The same name rule applies to the new name of an update
--     (Storage "move"), so the format can't be sidestepped by renaming.
--  8. Realtime: anon has nothing on fall_events (item 2). The supabase_realtime
--     publication carries INSERT and UPDATE only: the dashboard subscribes to nothing
--     else, and Realtime does not filter DELETE events through RLS (any subscriber
--     would learn the ids of rows others delete). The setting applies to every table
--     in the publication, so it is only changed while the publication holds just
--     fall_events and vital_alerts; otherwise a WARNING is raised and nothing changes.
--  9. Staff can rename themselves. The profiles UPDATE policy pinned
--     account_role = 'participant', so researchers and clinicians could not change
--     their display name. Role and status are frozen by column privileges anyway
--     (only display_name is updatable), so the policy now just checks the row is the
--     caller's own and the account is active.
-- 10. (Admin tooling: supabase/admin/*.sql and supabase/scripts/admin.mjs.)
-- 11. A grantee reads its access_grants rows only while the grant is live (not
--     revoked, both accounts active, still a viewer). The participant still reads all
--     of theirs, revoked ones included, as the audit trail.

-- ============================================================ 2. privileges ======
-- profiles: read own row (RLS), rename (display_name only). Rows are created by the
-- sign-up trigger and deleted with the auth user, never by a client.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- recorded_sessions / recorded_channels: item 3 (column grants below).
revoke all on public.recorded_sessions, public.recorded_channels from anon, authenticated;

-- fall_events: owner CRUD under RLS, every column (created_at is the phone's clock).
revoke all on public.fall_events from anon, authenticated;
grant select, insert, update, delete on public.fall_events to authenticated;

-- Sequences: no client inserts into a table with one (share_code_attempts is written
-- by redeem_share_code, which runs as its owner).
revoke all on all sequences in schema public from anon, authenticated;

-- Functions: nobody but the owner by default, then exactly what clients call.
revoke all on function public.tg_set_updated_at() from public, anon, authenticated;
revoke all on function public.tg_create_profile_for_new_user() from public, anon, authenticated;
revoke all on function public.account_is_active() from public, anon, authenticated;
revoke all on function public.create_share_code(smallint[], boolean) from public, anon, authenticated;
revoke all on function public.redeem_share_code(text) from public, anon, authenticated;
revoke all on function public.revoke_access_grant(uuid) from public, anon, authenticated;
revoke all on function public.update_access_grant(uuid, smallint[], boolean) from public, anon, authenticated;
revoke all on function public.my_pending_share_code() from public, anon, authenticated;
revoke all on function public.cancel_share_code() from public, anon, authenticated;
revoke all on function public.list_my_access_grants() from public, anon, authenticated;
revoke all on function public.list_shared_participants() from public, anon, authenticated;
revoke all on function public.confirm_adult() from public, anon, authenticated;
revoke all on function public.accept_terms(text) from public, anon, authenticated;

-- account_is_active(): the RESTRICTIVE write policies call it as the signed-in user.
grant execute on function public.account_is_active() to authenticated;
-- The RPCs the app and the dashboard call.
grant execute on function public.create_share_code(smallint[], boolean) to authenticated;
grant execute on function public.redeem_share_code(text) to authenticated;
grant execute on function public.revoke_access_grant(uuid) to authenticated;
grant execute on function public.update_access_grant(uuid, smallint[], boolean) to authenticated;
grant execute on function public.my_pending_share_code() to authenticated;
grant execute on function public.cancel_share_code() to authenticated;
grant execute on function public.list_my_access_grants() to authenticated;
grant execute on function public.list_shared_participants() to authenticated;
grant execute on function public.confirm_adult() to authenticated;
grant execute on function public.accept_terms(text) to authenticated;
-- (Trigger functions need no EXECUTE grant to fire.)

-- private: anon has no USAGE on the schema anyway; the explicit grants to
-- authenticated made by earlier migrations stay.
revoke execute on all functions in schema private from public, anon;

-- Defaults for what postgres (the migration role) creates from now on.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
-- PUBLIC's EXECUTE on new functions is a global built-in default: only a global
-- ALTER DEFAULT PRIVILEGES removes it. Affects functions postgres creates in any
-- schema from now on; each must be granted explicitly (every migration here does).
alter default privileges for role postgres revoke execute on functions from public;

-- ============================================================ 3. server stamps ===
-- Every column the phone's upsert sends (supabase-sync-gateway.ts putSession /
-- putChannel). UPDATE includes id and user_id because a PostgREST upsert SETs every
-- column it was sent; RLS still pins user_id to the caller.
grant select, delete on public.recorded_sessions to authenticated;
grant insert (id, user_id, device_id, started_at, ended_at, duration_ms, status, simulated,
              initial_transport, final_transport, transport_switch_count,
              configuration_snapshot, recovery_state),
      update (id, user_id, device_id, started_at, ended_at, duration_ms, status, simulated,
              initial_transport, final_transport, transport_switch_count,
              configuration_snapshot, recovery_state)
  on public.recorded_sessions to authenticated;

grant select, delete on public.recorded_channels to authenticated;
grant insert (id, session_id, user_id, sensor_type, canonical_unit, sample_rate_hz, sample_count,
              minimum_value, maximum_value, average_value, first_timestamp_us, last_timestamp_us,
              storage_path),
      update (id, session_id, user_id, sensor_type, canonical_unit, sample_rate_hz, sample_count,
              minimum_value, maximum_value, average_value, first_timestamp_us, last_timestamp_us,
              storage_path)
  on public.recorded_channels to authenticated;

-- ============================================================ 4. consent/terms ===
-- The versions of the terms (packages/legal ACCEPTANCE_VERSION) the server accepts.
-- Add the new effective date here, in a migration, when the terms change.
create table private.terms_versions (
  version text primary key check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  added_at timestamptz not null default now()
);

comment on table private.terms_versions is
  'Versions (effective dates) of the WearWise terms a sign-up or accept_terms() may record. Server-maintained.';

revoke all on private.terms_versions from public, anon, authenticated;

insert into private.terms_versions (version) values ('2026-10-16');

-- A declaration in sign-up metadata counts when it is present as a timestamp-shaped
-- string (what every client writes). Only its presence is used: the value is
-- client-chosen, so the server records its own time instead.
create or replace function private.metadata_declares(p_meta jsonb, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p_meta ->> p_key) ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', false);
$$;

revoke all on function private.metadata_declares(jsonb, text) from public, anon, authenticated;

-- Called by the security-definer trigger, accept_terms() and the carry-over, which
-- read private.terms_versions as its owner; no client calls it.
create or replace function private.known_terms_version(p_version text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from private.terms_versions t where t.version = p_version);
$$;

revoke all on function private.known_terms_version(text) from public, anon, authenticated;

-- Same refusals and messages as before; the three timestamps are now the server's.
create or replace function public.tg_create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  terms text := meta ->> 'terms_version';
begin
  if not private.metadata_declares(meta, 'consent_recorded_at') then
    raise exception 'sign-up rejected: consent_recorded_at missing from user metadata';
  end if;
  if not private.metadata_declares(meta, 'adult_confirmed_at') then
    raise exception 'sign-up rejected: adult_confirmed_at missing from user metadata (WearWise accounts are for people 18 or older)';
  end if;
  if terms is null or terms !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'sign-up rejected: terms_version missing from user metadata (the terms must be accepted)';
  end if;
  if not private.known_terms_version(terms) then
    raise exception 'sign-up rejected: terms_version is not a version of the WearWise terms';
  end if;

  insert into public.profiles (id, display_name, consent_recorded_at, adult_confirmed_at, terms_version, terms_accepted_at)
  values (new.id, coalesce(meta ->> 'display_name', ''), now(), now(), terms, now());
  return new;
end;
$$;

-- Only a version the server knows, and only forward.
create or replace function public.accept_terms(p_version text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_version is null or p_version !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'accept_terms: version must look like YYYY-MM-DD' using errcode = '22023';
  end if;
  if not private.known_terms_version(p_version) then
    raise exception 'accept_terms: % is not a version of the WearWise terms', p_version using errcode = '22023';
  end if;
  update public.profiles
     set terms_version = p_version, terms_accepted_at = now()
   where id = (select auth.uid())
     and (terms_version is null or terms_version < p_version)
  returning terms_version into v;
  if v is null then
    select terms_version into v from public.profiles where id = (select auth.uid());
  end if;
  return v;
end;
$$;

-- Carry-over (migration 8) with the same rules: known versions only, server time.
create or replace function private.carry_over_terms_acceptances()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with done as (
    update public.profiles p
       set terms_version = u.raw_user_meta_data ->> 'terms_version',
           terms_accepted_at = now()
      from auth.users u
     where u.id = p.id
       and p.terms_version is null
       and private.known_terms_version(u.raw_user_meta_data ->> 'terms_version')
    returning 1
  )
  select count(*)::integer from done;
$$;

revoke all on function private.carry_over_terms_acceptances() from public, anon, authenticated;

-- A version the server doesn't know is no acceptance: ask again.
update public.profiles p
   set terms_version = null, terms_accepted_at = null
 where p.terms_version is not null
   and not private.known_terms_version(p.terms_version);

-- ============================================================ 5. share codes =====
-- 10 characters, each uniform over the 31-symbol alphabet: a byte is used only below
-- the largest multiple of 31 that fits in a byte (248), so `% 31` has no bias.
create or replace function private.new_share_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  n constant int := length(alphabet);
  cutoff constant int := 256 - 256 % n;
  raw text := '';
  b bytea;
  v int;
  i int;
begin
  while length(raw) < 10 loop
    b := extensions.gen_random_bytes(16);
    for i in 0..15 loop
      v := get_byte(b, i);
      if v < cutoff then
        raw := raw || substr(alphabet, v % n + 1, 1);
        exit when length(raw) = 10;
      end if;
    end loop;
  end loop;
  return raw;
end;
$$;

revoke all on function private.new_share_code() from public, anon, authenticated;

-- Participant: create a one-time code. Replaces any unredeemed code of theirs.
-- Returns the code formatted XXXXX-XXXXX. Needs an active, 18+-confirmed account.
create or replace function public.create_share_code(p_sensor_types smallint[], p_include_falls boolean)
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  raw text;
  expiry timestamptz := now() + interval '24 hours';
begin
  if me is null
     or (select private.caller_role()) is distinct from 'participant'
     or not (select public.account_is_active()) then
    raise exception 'only an active participant can share data' using errcode = '42501';
  end if;
  if not private.valid_sensor_types(p_sensor_types) then
    raise exception 'choose at least one signal to share' using errcode = '22023';
  end if;

  delete from public.share_codes where participant_id = me and redeemed_at is null;

  raw := private.new_share_code();

  insert into public.share_codes (participant_id, code_hash, sensor_types, include_falls, expires_at)
  values (me, encode(sha256(convert_to(raw, 'UTF8')), 'hex'),
          (select array_agg(distinct s order by s) from unnest(p_sensor_types) s),
          coalesce(p_include_falls, false), expiry);

  code := substr(raw, 1, 5) || '-' || substr(raw, 6, 5);
  expires_at := expiry;
  return next;
end;
$$;

-- Viewer: redeem a code. Returns {ok, grant_id, participant_name} or {ok:false, reason}.
-- Failures are returned, not raised, so the attempt row survives for rate limiting.
-- One redemption per viewer at a time (advisory lock, released at commit), so the
-- failed-attempt count each call sees includes every earlier call's attempt.
create or replace function public.redeem_share_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  sc public.share_codes;
  gid uuid;
  pname text;
begin
  if me is null or (select private.caller_role()) not in ('researcher', 'clinician')
     or (select private.caller_role()) is null then
    raise exception 'only an authorised researcher or clinician can redeem a share code' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('redeem_share_code:' || me::text, 0));

  if (select count(*) from public.share_code_attempts a
      where a.user_id = me and not a.succeeded and a.attempted_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- A participant who isn't active can't share (their data is hidden from every
  -- viewer); their code fails exactly like a wrong one, so status doesn't leak.
  select s.* into sc from public.share_codes s
  where s.code_hash = encode(sha256(convert_to(private.normalise_share_code(p_code), 'UTF8')), 'hex')
    and s.redeemed_at is null
    and s.expires_at > now()
    and s.participant_id <> me
    and exists (select 1 from public.profiles po
                where po.id = s.participant_id and po.account_status = 'active')
  for update of s;

  if not found then
    insert into public.share_code_attempts (user_id, succeeded) values (me, false);
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  update public.share_codes set redeemed_at = now(), redeemed_by = me where id = sc.id;

  -- Re-sharing with the same viewer replaces the scope of the live grant.
  update public.access_grants
     set sensor_types = sc.sensor_types, include_falls = sc.include_falls
   where participant_id = sc.participant_id and grantee_id = me and revoked_at is null
  returning id into gid;
  if gid is null then
    insert into public.access_grants (participant_id, grantee_id, sensor_types, include_falls)
    values (sc.participant_id, me, sc.sensor_types, sc.include_falls)
    returning id into gid;
  end if;

  insert into public.share_code_attempts (user_id, succeeded) values (me, true);
  select p.display_name into pname from public.profiles p where p.id = sc.participant_id;
  return jsonb_build_object('ok', true, 'grant_id', gid, 'participant_name', coalesce(pname, ''));
end;
$$;

-- ============================================================ 1. no email ========
-- Same columns as before (participant_email is always NULL now). Counts cover only
-- the sessions the viewer's read policy lets them open (item 6).
create or replace function public.list_shared_participants()
returns table (grant_id uuid, participant_id uuid, participant_name text, participant_email text,
               sensor_types smallint[], include_falls boolean, shared_since timestamptz,
               last_session_at timestamptz, session_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.participant_id, p.display_name, null::text, g.sensor_types, g.include_falls, g.created_at,
         s.last_session_at, s.session_count
  from public.access_grants g
  join public.profiles p on p.id = g.participant_id
  cross join lateral (
    select max(rs.started_at) as last_session_at, count(*) as session_count
    from public.recorded_sessions rs
    where rs.user_id = g.participant_id
      and rs.status <> 'discarded'
      and exists (
        select 1 from public.recorded_channels c
        where c.session_id = rs.id and c.user_id = rs.user_id and c.sensor_type = any (g.sensor_types)
      )
  ) s
  where g.participant_id in (select lg.participant_id from private.my_live_grants() lg)
    and g.grantee_id = (select auth.uid())
    and g.revoked_at is null
  order by g.created_at desc;
$$;

-- ============================================================ 6. viewer sessions =
drop policy "recorded_sessions: viewer reads shared" on public.recorded_sessions;

-- Does the session hold a channel of a signal the caller's live grant from its owner
-- covers. Security definer so it reads recorded_channels without that table's RLS:
-- a policy subquery on recorded_channels would recurse (the channel and fall INSERT
-- policies look up recorded_sessions). my_live_grants() still keys on the caller,
-- so it only answers about the caller's own grants.
create or replace function private.session_has_granted_channel(p_session_id uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.my_live_grants() g
    join public.recorded_channels c
      on c.user_id = g.participant_id
     and c.sensor_type = any (g.sensor_types)
    where g.participant_id = p_owner
      and c.session_id = p_session_id
  );
$$;

revoke all on function private.session_has_granted_channel(uuid, uuid) from public, anon;
grant execute on function private.session_has_granted_channel(uuid, uuid) to authenticated;

-- The first condition (one my_live_grants() call per query) keeps the per-row check
-- to the rows of participants sharing with the caller.
create policy "recorded_sessions: viewer reads sessions with a granted signal"
  on public.recorded_sessions for select to authenticated
  using (
    status <> 'discarded'
    and user_id in (select g.participant_id from private.my_live_grants() g)
    and private.session_has_granted_channel(id, user_id)
  );

-- ============================================================ 7. storage =========
update storage.buckets set public = false where id = 'recordings';

-- <uid>/<session uuid>/<channel uuid>.wwch (sync-engine.ts channelPath). Hex is
-- accepted in either case; the uid folder must be the caller's, as auth.uid() prints it.
create policy "recordings: new objects are <uid>/<session>/<channel>.wwch"
  on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id <> 'recordings'
    or name ~ ('^' || (select auth.uid())::text
               || '/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
               || '/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.wwch$')
  );

create policy "recordings: updates keep <uid>/<session>/<channel>.wwch"
  on storage.objects as restrictive for update to authenticated
  using (true)
  with check (
    bucket_id <> 'recordings'
    or name ~ ('^' || (select auth.uid())::text
               || '/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
               || '/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.wwch$')
  );

-- ============================================================ 8. realtime ========
do $$
declare
  pub record;
  others text;
begin
  select * into pub from pg_publication where pubname = 'supabase_realtime';
  if not found then
    return;
  end if;
  if pub.puballtables then
    raise warning 'supabase_realtime is FOR ALL TABLES: publish left as is. DELETE events are not RLS-filtered; see docs/database/cloud-schema.md';
    return;
  end if;
  select string_agg(format('%I.%I', t.schemaname, t.tablename), ', ' order by t.schemaname, t.tablename)
    into others
    from pg_publication_tables t
   where t.pubname = 'supabase_realtime'
     and not (t.schemaname = 'public' and t.tablename in ('fall_events', 'vital_alerts'));
  if others is not null then
    raise warning 'supabase_realtime also publishes %: publish left as is (it would change for them too). See docs/database/cloud-schema.md', others;
    return;
  end if;
  alter publication supabase_realtime set (publish = 'insert, update');
end $$;

-- ============================================================ 9. staff rename ====
alter policy "profiles: participants rename themselves only" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and account_status = 'active');
alter policy "profiles: participants rename themselves only" on public.profiles
  rename to "profiles: active accounts rename themselves only";

-- ============================================================ 11. live grants ====
drop policy "access_grants: grantee reads own" on public.access_grants;

create policy "access_grants: grantee reads own live grants"
  on public.access_grants for select to authenticated
  using (
    grantee_id = (select auth.uid())
    and revoked_at is null
    and participant_id in (select lg.participant_id from private.my_live_grants() lg)
  );
