-- WearWise: cloud mirror of recorded sessions (Milestone 6, sync).
--
-- The encrypted on-device SQLite store is the SOURCE OF TRUTH. This is a mirror
-- the phone uploads to, so a participant's data survives a lost phone and a
-- researcher can (in a later milestone) read it under RLS. Nothing here is ever
-- the authority over the local copy.
--
-- Design:
--   recorded_sessions   one row per completed/interrupted session (never 'recording')
--   recorded_channels   one row per channel, with summary stats + a Storage path
--   Storage bucket 'recordings'  the actual int16 sample bytes, per channel
--
-- Every row carries user_id and RLS pins it to the owner. A participant can only
-- ever touch their own rows and their own Storage folder.

-- ---------------------------------------------------------------- sessions -----
create table public.recorded_sessions (
  id uuid primary key,                         -- same UUID as the local session (idempotent upsert key)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms bigint,
  -- a session is only ever uploaded once finished; 'recording' is not allowed here
  status text not null check (status in ('complete', 'interrupted', 'discarded')),
  simulated boolean not null default false,
  initial_transport text not null,
  final_transport text not null,
  transport_switch_count integer not null default 0,
  configuration_snapshot jsonb not null,
  recovery_state jsonb,
  -- server-stamped receipt time; the local started_at/ended_at are the real clock
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recorded_sessions_user_started on public.recorded_sessions (user_id, started_at desc);

comment on table public.recorded_sessions is
  'Cloud mirror of a finished on-device recording session. Local SQLite is the source of truth.';

-- ---------------------------------------------------------------- channels -----
create table public.recorded_channels (
  id uuid primary key,                         -- same UUID as the local channel
  session_id uuid not null references public.recorded_sessions (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sensor_type smallint not null,
  canonical_unit text not null,
  sample_rate_hz integer not null,
  sample_count bigint not null default 0,
  minimum_value double precision,
  maximum_value double precision,
  average_value double precision,
  -- u64 microsecond timestamps as text, exactly like the local store (no i64 clip)
  first_timestamp_us text,
  last_timestamp_us text,
  -- Storage object holding this channel's chunk container (see chunk-container.ts)
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index recorded_channels_session on public.recorded_channels (session_id);

comment on table public.recorded_channels is
  'One row per channel of a recorded session; sample bytes live in Storage at storage_path.';

-- updated_at maintenance for sessions -------------------------------------------
create trigger set_updated_at
  before update on public.recorded_sessions
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------- RLS ----------
alter table public.recorded_sessions enable row level security;
alter table public.recorded_channels enable row level security;

-- Sessions: a participant fully owns their own rows. INSERT/UPDATE pin user_id to
-- the caller so a row can never be written under another user's id.
create policy "recorded_sessions: owner reads"
  on public.recorded_sessions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "recorded_sessions: owner inserts"
  on public.recorded_sessions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "recorded_sessions: owner updates"
  on public.recorded_sessions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "recorded_sessions: owner deletes"
  on public.recorded_sessions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Channels: same ownership, and the parent session must belong to the caller too.
create policy "recorded_channels: owner reads"
  on public.recorded_channels for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "recorded_channels: owner inserts"
  on public.recorded_channels for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.recorded_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

create policy "recorded_channels: owner updates"
  on public.recorded_channels for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "recorded_channels: owner deletes"
  on public.recorded_channels for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- Storage ------
-- Private bucket; every object lives under {user_id}/... and RLS on storage.objects
-- lets a participant touch only their own folder.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

create policy "recordings: owner reads own folder"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "recordings: owner writes own folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "recordings: owner updates own folder"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "recordings: owner deletes own folder"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
