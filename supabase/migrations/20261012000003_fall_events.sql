-- WearWise: cloud mirror of detected falls.
--
-- Falls were stored only in the on-device SQLite `fall_events` table, so an
-- uninstall or a lost phone deleted the evidence of every detected fall — the
-- one record a fall-detection feature most needs to keep. This mirrors them under
-- the same ownership rules as recorded_sessions.
--
-- A fall belongs to a session; deleting the session (or the user) removes its
-- falls. The local store remains the source of truth; this is a backup.

create table public.fall_events (
  id uuid primary key,                         -- same UUID as the local row (idempotent upsert key)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null references public.recorded_sessions (id) on delete cascade,
  detected_at_ms bigint not null check (detected_at_ms >= 0),   -- session-elapsed time of the fall
  freefall_min_g real not null,
  impact_peak_g real not null,
  status text not null check (status in ('emergency', 'cancelled')),
  created_at timestamptz not null                                -- wall clock when recorded on the phone
);

create index fall_events_session on public.fall_events (session_id);

comment on table public.fall_events is
  'Falls confirmed during a recorded session; mirrors the phone''s local fall_events table.';

-- ---------------------------------------------------------------- RLS ----------
alter table public.fall_events enable row level security;

create policy "fall_events: owner reads"
  on public.fall_events for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "fall_events: owner inserts"
  on public.fall_events for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.recorded_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

create policy "fall_events: owner updates"
  on public.fall_events for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "fall_events: owner deletes"
  on public.fall_events for delete
  to authenticated
  using (user_id = (select auth.uid()));
