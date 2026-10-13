-- WearWise: vital alerts in the cloud, alerts over Realtime, and live view for setup.
-- Implements sections 1 and 2 of docs/architecture/live-view-and-alerts.md.
--
-- 1. public.vital_alerts mirrors the phone's high/low alerts (falls already go to
--    fall_events). The participant owns their rows; a researcher or clinician reads
--    a row while they hold a live grant from that participant covering its signal,
--    through the same private.my_live_grants() helper as every other viewer policy.
-- 2. fall_events and vital_alerts join the supabase_realtime publication, so the
--    dashboard gets INSERT/UPDATE events (postgres_changes). Realtime runs each
--    change through the subscriber's SELECT policies; nothing new is exposed.
-- 3. Live view: while the participant has it on, the phone broadcasts readings on
--    the private Realtime channel 'live:<access_grants.id>' of each live grant.
--    Nothing is stored. Who may send and receive is decided by RLS on
--    realtime.messages, keyed on realtime.topic():
--      send     the grant's participant, while the grant is not revoked and their
--               account is active
--      receive  the grant's grantee, while the grant is live in the
--               my_live_grants() sense (not revoked, both accounts active, grantee
--               still a researcher or clinician)
--    The participant may also JOIN (read) their own grant's channel: Realtime
--    refuses to join a private channel without broadcast-read permission, even
--    for a client that only sends, and it may read its INSERT probe back
--    (RETURNING). They only ever see their own readings there.
--    Only extension 'broadcast' is allowed. Presence is not: the 'status' event
--    already tells the dashboard whether the phone is live, and presence would let
--    either side publish state into the channel for no benefit.
-- 4. 'alerts:<auth.uid()>': a private channel any signed-in user may join, with
--    nobody allowed to broadcast on it. It exists so the dashboard can subscribe
--    to postgres_changes while Realtime is in private-only mode (see below).
--
-- Realtime evaluates these policies with a probe row when a channel is joined or
-- first sent on, then caches the result for that channel. They can therefore only
-- look at the topic and extension (the probe carries no event or payload), and a
-- revoked grant does not cut off a channel that is already open: the phone stops
-- sending for grants that disappear from its list, and the dashboard leaves
-- channels for grants it no longer has.
--
-- OPERATIONAL: turn OFF "Allow public access" (Dashboard -> Realtime -> Settings).
-- While it is on, a client that forgets { private: true } silently joins a PUBLIC
-- channel of the same name, where none of these policies apply: the phone would
-- broadcast a participant's live vitals to anyone holding the anon key (it ships in
-- every app) and the grant id, and anyone could inject fake readings into a
-- dashboard. With it off, Realtime rejects every non-private channel, so that
-- mistake fails loudly instead. Every channel must then be private and need a read
-- policy, which is why 'alerts:<uid>' exists.

-- ------------------------------------------------------------- vital_alerts ----
create table public.vital_alerts (
  id uuid primary key,                         -- the phone's local alert id (idempotent upsert key)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- null when the alert happened while monitoring without recording
  session_id uuid references public.recorded_sessions (id) on delete cascade,
  sensor_type smallint not null check (sensor_type between 1 and 6),   -- sensor-protocol wire code
  kind text not null check (kind in ('high', 'low')),
  value real not null,                         -- most extreme value while open, canonical units
  started_at timestamptz not null,
  -- null while still out of range. No ended_at >= started_at check: both come from
  -- the phone's wall clock, which can step, and a refused row would wedge its sync.
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vital_alerts_user_started on public.vital_alerts (user_id, started_at desc);
create index vital_alerts_session on public.vital_alerts (session_id);

create trigger set_updated_at
  before update on public.vital_alerts
  for each row execute function public.tg_set_updated_at();

comment on table public.vital_alerts is
  'High/low vital alerts mirrored from the phone; falls are in fall_events. Viewers read granted signals.';

-- Owners read, upsert and delete; viewers only read. Supabase's default privileges
-- grant everything (TRUNCATE included) on new tables, so start from nothing.
-- created_at/updated_at are server-maintained: no client may write them. UPDATE
-- includes id because a PostgREST upsert sets every column it was sent.
revoke all on public.vital_alerts from anon, authenticated;
grant select, delete on public.vital_alerts to authenticated;
grant insert (id, user_id, session_id, sensor_type, kind, value, started_at, ended_at),
      update (id, user_id, session_id, sensor_type, kind, value, started_at, ended_at)
  on public.vital_alerts to authenticated;

alter table public.vital_alerts enable row level security;

create policy "vital_alerts: owner reads"
  on public.vital_alerts for select to authenticated
  using (user_id = (select auth.uid()));

-- A session, when given, must be the caller's own (and already uploaded).
create policy "vital_alerts: owner inserts"
  on public.vital_alerts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (session_id is null or exists (
      select 1 from public.recorded_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    ))
  );

create policy "vital_alerts: owner updates"
  on public.vital_alerts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (session_id is null or exists (
      select 1 from public.recorded_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    ))
  );

create policy "vital_alerts: owner deletes"
  on public.vital_alerts for delete to authenticated
  using (user_id = (select auth.uid()));

-- Only an active account uploads (as for sessions, channels and falls); a
-- suspended one keeps read and delete.
create policy "vital_alerts: active accounts insert"
  on public.vital_alerts as restrictive for insert to authenticated
  with check ((select public.account_is_active()));
create policy "vital_alerts: active accounts update"
  on public.vital_alerts as restrictive for update to authenticated
  using ((select public.account_is_active()))
  with check ((select public.account_is_active()));

-- Same rule as recorded_channels: a live grant from the owner covering the signal.
create policy "vital_alerts: viewer reads granted signals"
  on public.vital_alerts for select to authenticated
  using (exists (
    select 1 from private.my_live_grants() g
    where g.participant_id = vital_alerts.user_id
      and vital_alerts.sensor_type = any (g.sensor_types)
  ));

-- ------------------------------------------------------------- publication -----
-- Supabase creates supabase_realtime (empty); add each table once, whatever state
-- the publication is in, so re-running this block is harmless.
do $$
declare
  tbl text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    return;   -- FOR ALL TABLES already covers them
  end if;
  foreach tbl in array array['fall_events', 'vital_alerts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------- live helpers ----
-- 'live:<uuid>' -> the grant id; anything else -> null, never an error (the topic
-- is whatever a client chose to join). Lowercase canonical form only, as PostgREST
-- returns ids, so each grant has exactly one channel name.
create or replace function private.live_topic_grant_id(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_topic ~ '^live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substr(p_topic, 6)::uuid
  end;
$$;

-- May the caller broadcast on this topic: it names a grant the caller gave, which
-- is not revoked, and the caller's account is active.
create or replace function private.can_send_live(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.access_grants g
    where g.id = private.live_topic_grant_id(p_topic)
      and g.participant_id = (select auth.uid())
      and g.revoked_at is null
  ) and (select public.account_is_active());
$$;

-- May the caller receive on this topic: it names the caller's own live grant
-- (my_live_grants decides "live", as for every other viewer read). One live grant
-- per pair, so the participant pins down the grant row.
create or replace function private.can_receive_live(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_grants g
    join private.my_live_grants() lg on lg.participant_id = g.participant_id
    where g.id = private.live_topic_grant_id(p_topic)
      and g.grantee_id = (select auth.uid())
      and g.revoked_at is null
  );
$$;

revoke all on function private.live_topic_grant_id(text) from public, anon;
revoke all on function private.can_send_live(text) from public, anon;
revoke all on function private.can_receive_live(text) from public, anon;
grant execute on function private.live_topic_grant_id(text) to authenticated;
grant execute on function private.can_send_live(text) to authenticated;
grant execute on function private.can_receive_live(text) to authenticated;

-- ------------------------------------------------------------- realtime RLS ----
-- SELECT = may join and receive, INSERT = may send. No policy for anon, none for
-- presence, none for UPDATE/DELETE.
create policy "live: participant sends on own grant"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select private.can_send_live((select realtime.topic())))
  );

create policy "live: grantee receives"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select private.can_receive_live((select realtime.topic())))
  );

-- Needed to join the channel at all (see header); only their own readings flow there.
create policy "live: participant joins own grant channel"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select private.can_send_live((select realtime.topic())))
  );

-- The dashboard's postgres_changes channel. Read-only for everyone (no INSERT
-- policy matches it), so nothing but table changes, under table RLS, arrives.
create policy "alerts: user joins own changes channel"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'alerts:' || (select auth.uid())::text
  );
