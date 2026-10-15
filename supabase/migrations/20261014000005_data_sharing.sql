-- WearWise: participant-controlled data sharing with researchers and clinicians.
--
-- A participant decides who may see their cloud data, what they may see, and can
-- take it back at any time. Nobody gets access without the participant acting:
--
--   1. The participant creates a one-time SHARE CODE in the app (24 h, single use),
--      choosing which signals and whether falls are included.
--   2. An authorised viewer (account_role 'researcher' or 'clinician', set only by
--      an admin) redeems it in the dashboard, which creates an ACCESS GRANT.
--   3. RLS lets that viewer READ the participant's sessions, the granted channels
--      and their Storage objects, and falls if included. Never write.
--   4. Either side can revoke; the next query already sees nothing.
--
-- Clients never touch share_codes / access_grants rows directly except to read
-- their own grants; every change goes through the security-definer RPCs below,
-- which check the caller's identity, role and status themselves.

-- ------------------------------------------------------------- roles -----------
-- 'clinician' joins 'researcher' as an authorised viewer role. Both are
-- server-controlled (the profiles UPDATE grant only covers display_name).
alter table public.profiles drop constraint profiles_account_role_check;
alter table public.profiles add constraint profiles_account_role_check
  check (account_role in ('participant', 'researcher', 'clinician'));

-- Not exposed through the API (only public is), so its helpers can't be called
-- as RPCs; policies still call them as the signed-in user.
create schema if not exists private;
grant usage on schema private to authenticated;

-- ------------------------------------------------------------- tables ----------
create table public.share_codes (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references auth.users (id) on delete cascade,
  -- sha256 of the normalised code; the code itself is shown once and never stored
  code_hash text not null unique,
  sensor_types smallint[] not null check (cardinality(sensor_types) > 0),
  include_falls boolean not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null
);

create index share_codes_participant on public.share_codes (participant_id);
create index share_codes_redeemed_by on public.share_codes (redeemed_by);

comment on table public.share_codes is
  'One-time codes a participant creates to share data. Hash only; RPC access only.';

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references auth.users (id) on delete cascade,
  grantee_id uuid not null references auth.users (id) on delete cascade,
  sensor_types smallint[] not null check (cardinality(sensor_types) > 0),
  include_falls boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  check (participant_id <> grantee_id)
);

-- One live grant per pair; revoked rows stay as the audit trail.
create unique index access_grants_one_active
  on public.access_grants (participant_id, grantee_id) where revoked_at is null;
create index access_grants_grantee_active
  on public.access_grants (grantee_id, participant_id) where revoked_at is null;
create index access_grants_revoked_by on public.access_grants (revoked_by);

create trigger set_updated_at
  before update on public.access_grants
  for each row execute function public.tg_set_updated_at();

comment on table public.access_grants is
  'Who may read whose cloud data. Created by redeem_share_code; revoked rows are kept.';

-- Failed redemptions, for rate limiting code guessing.
create table public.share_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null
);

create index share_code_attempts_user_time on public.share_code_attempts (user_id, attempted_at desc);

-- Storage policy below looks objects up by path.
create index recorded_channels_storage_path on public.recorded_channels (storage_path);

-- ------------------------------------------------------------- RLS on new ------
alter table public.share_codes enable row level security;
alter table public.access_grants enable row level security;
alter table public.share_code_attempts enable row level security;

-- share_codes, share_code_attempts: no policies — RPC only.
revoke all on public.share_codes, public.share_code_attempts from anon, authenticated;

-- access_grants: each side reads its own rows; all writes go through the RPCs.
-- Supabase's default privileges grant everything (TRUNCATE included) on new
-- tables, so start from nothing and give back SELECT only.
revoke all on public.access_grants from anon, authenticated;
grant select on public.access_grants to authenticated;

create policy "access_grants: participant reads own"
  on public.access_grants for select to authenticated
  using (participant_id = (select auth.uid()));

create policy "access_grants: grantee reads own"
  on public.access_grants for select to authenticated
  using (grantee_id = (select auth.uid()));

-- ------------------------------------------------------------- helpers ---------
-- The caller's live grants, only while both accounts are active and the caller
-- still holds a viewer role. Every read policy for viewers goes through this.
create or replace function private.my_live_grants()
returns table (participant_id uuid, sensor_types smallint[], include_falls boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select g.participant_id, g.sensor_types, g.include_falls
  from public.access_grants g
  join public.profiles viewer on viewer.id = g.grantee_id
  join public.profiles po on po.id = g.participant_id
  where g.grantee_id = (select auth.uid())
    and g.revoked_at is null
    and viewer.account_status = 'active'
    and viewer.account_role in ('researcher', 'clinician')
    and po.account_status = 'active';
$$;

revoke all on function private.my_live_grants() from public, anon;
grant execute on function private.my_live_grants() to authenticated;

create or replace function private.caller_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.account_role from public.profiles p
  where p.id = (select auth.uid()) and p.account_status = 'active';
$$;

revoke all on function private.caller_role() from public, anon;
grant execute on function private.caller_role() to authenticated;

-- ------------------------------------------------------------- read policies ---
-- Viewers read; they never insert, update or delete (no such policies exist).
create policy "recorded_sessions: viewer reads shared"
  on public.recorded_sessions for select to authenticated
  using (user_id in (select g.participant_id from private.my_live_grants() g));

create policy "recorded_channels: viewer reads granted signals"
  on public.recorded_channels for select to authenticated
  using (exists (
    select 1 from private.my_live_grants() g
    where g.participant_id = recorded_channels.user_id
      and recorded_channels.sensor_type = any (g.sensor_types)
  ));

create policy "fall_events: viewer reads shared falls"
  on public.fall_events for select to authenticated
  using (user_id in (select g.participant_id from private.my_live_grants() g where g.include_falls));

-- A viewer may download an object only if it backs a channel they can read (that
-- subquery is itself under the channel policies) AND it sits in that channel
-- owner's folder — so a participant can't point a channel row at someone else's
-- object to borrow a viewer's access.
create policy "recordings: viewer reads granted channel objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'recordings'
    and exists (
      select 1 from public.recorded_channels c
      where c.storage_path = storage.objects.name
        and (storage.foldername(storage.objects.name))[1] = c.user_id::text
        and c.user_id <> (select auth.uid())
    )
  );

-- ------------------------------------------------------------- RPCs ------------
-- Sensor codes the app knows (packages/sensor-protocol SensorType 1..6).
create or replace function private.valid_sensor_types(p smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(p) > 0 and p <@ array[1, 2, 3, 4, 5, 6]::smallint[];
$$;

grant execute on function private.valid_sensor_types(smallint[]) to authenticated;

create or replace function private.normalise_share_code(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

grant execute on function private.normalise_share_code(text) to authenticated;

-- Participant: create a one-time code. Replaces any unredeemed code of theirs.
-- Returns the code formatted XXXXX-XXXXX (unambiguous alphabet, ~49 bits).
create or replace function public.create_share_code(p_sensor_types smallint[], p_include_falls boolean)
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw text := '';
  b bytea;
  i int;
  expiry timestamptz := now() + interval '24 hours';
begin
  if me is null or (select private.caller_role()) is distinct from 'participant' then
    raise exception 'only an active participant can share data' using errcode = '42501';
  end if;
  if not private.valid_sensor_types(p_sensor_types) then
    raise exception 'choose at least one signal to share' using errcode = '22023';
  end if;

  delete from public.share_codes where participant_id = me and redeemed_at is null;

  -- 10 characters from 20 random bytes (two v4 UUIDs' worth of randomness).
  b := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  for i in 0..9 loop
    raw := raw || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;

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

  if (select count(*) from public.share_code_attempts a
      where a.user_id = me and not a.succeeded and a.attempted_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into sc from public.share_codes s
  where s.code_hash = encode(sha256(convert_to(private.normalise_share_code(p_code), 'UTF8')), 'hex')
    and s.redeemed_at is null
    and s.expires_at > now()
    and s.participant_id <> me
  for update;

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

-- Either side ends a grant. True if this call ended it (false: unknown, not
-- yours, or already ended).
create or replace function public.revoke_access_grant(p_grant_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  n int;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.access_grants
     set revoked_at = now(), revoked_by = me
   where id = p_grant_id
     and revoked_at is null
     and (participant_id = me or grantee_id = me);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Participant narrows or widens what a live grant covers. True if the grant was
-- live and theirs (false: the viewer may have ended it meanwhile).
create or replace function public.update_access_grant(p_grant_id uuid, p_sensor_types smallint[], p_include_falls boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  n int;
begin
  if me is null or (select private.caller_role()) is distinct from 'participant' then
    raise exception 'only an active participant can change sharing' using errcode = '42501';
  end if;
  if not private.valid_sensor_types(p_sensor_types) then
    raise exception 'choose at least one signal to share' using errcode = '22023';
  end if;
  update public.access_grants
     set sensor_types = (select array_agg(distinct s order by s) from unnest(p_sensor_types) s),
         include_falls = coalesce(p_include_falls, false)
   where id = p_grant_id and participant_id = me and revoked_at is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Participant: the code they made that nobody has used yet (the code itself is
-- not stored, so only its scope and expiry), and a way to withdraw it.
create or replace function public.my_pending_share_code()
returns table (expires_at timestamptz, sensor_types smallint[], include_falls boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.expires_at, s.sensor_types, s.include_falls
  from public.share_codes s
  where s.participant_id = (select auth.uid()) and s.redeemed_at is null and s.expires_at > now();
$$;

create or replace function public.cancel_share_code()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n int;
begin
  delete from public.share_codes
   where participant_id = (select auth.uid()) and redeemed_at is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Participant: who can see my data. Names and emails of the viewers they chose.
create or replace function public.list_my_access_grants()
returns table (grant_id uuid, grantee_name text, grantee_email text, grantee_role text,
               sensor_types smallint[], include_falls boolean, created_at timestamptz,
               access_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, p.display_name, u.email::text, p.account_role, g.sensor_types, g.include_falls, g.created_at,
         -- false while the viewer is suspended or no longer a viewer: the grant
         -- stands, but the read policies show them nothing
         p.account_status = 'active' and p.account_role in ('researcher', 'clinician')
  from public.access_grants g
  join public.profiles p on p.id = g.grantee_id
  join auth.users u on u.id = g.grantee_id
  where g.participant_id = (select auth.uid()) and g.revoked_at is null
  order by g.created_at desc;
$$;

-- Viewer: participants who shared with me, while the grant is live.
create or replace function public.list_shared_participants()
returns table (grant_id uuid, participant_id uuid, participant_name text, participant_email text,
               sensor_types smallint[], include_falls boolean, shared_since timestamptz,
               last_session_at timestamptz, session_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.participant_id, p.display_name, u.email::text, g.sensor_types, g.include_falls, g.created_at,
         (select max(s.started_at) from public.recorded_sessions s where s.user_id = g.participant_id),
         (select count(*) from public.recorded_sessions s where s.user_id = g.participant_id)
  from public.access_grants g
  join public.profiles p on p.id = g.participant_id
  join auth.users u on u.id = g.participant_id
  where g.participant_id in (select lg.participant_id from private.my_live_grants() lg)
    and g.grantee_id = (select auth.uid())
    and g.revoked_at is null
  order by g.created_at desc;
$$;

revoke all on function public.create_share_code(smallint[], boolean) from public, anon;
revoke all on function public.redeem_share_code(text) from public, anon;
revoke all on function public.revoke_access_grant(uuid) from public, anon;
revoke all on function public.update_access_grant(uuid, smallint[], boolean) from public, anon;
revoke all on function public.list_my_access_grants() from public, anon;
revoke all on function public.my_pending_share_code() from public, anon;
revoke all on function public.cancel_share_code() from public, anon;
revoke all on function public.list_shared_participants() from public, anon;
grant execute on function public.create_share_code(smallint[], boolean) to authenticated;
grant execute on function public.redeem_share_code(text) to authenticated;
grant execute on function public.revoke_access_grant(uuid) to authenticated;
grant execute on function public.update_access_grant(uuid, smallint[], boolean) to authenticated;
grant execute on function public.list_my_access_grants() to authenticated;
grant execute on function public.my_pending_share_code() to authenticated;
grant execute on function public.cancel_share_code() to authenticated;
grant execute on function public.list_shared_participants() to authenticated;
