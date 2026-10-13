-- WearWise: security hardening after the 2026-10-13 policy review.
--
-- 1. Consent is an audit record: a participant may rename themselves, nothing else.
--    The UPDATE policy pinned role/status but not consent_recorded_at, so a client
--    could rewrite when it consented. Column privileges close that for every column
--    at once (the updated_at trigger still runs — triggers need no column grant).
-- 2. Only an ACTIVE account may write data. Suspended / deletion-requested accounts
--    keep read and delete (they can still see and remove their own data) but cannot
--    upload. RESTRICTIVE policies AND with the existing owner policies, so nothing
--    that was allowed before becomes newly allowed.
-- 3. Re-pointing: an UPDATE on a channel or fall must keep it under a session the
--    caller owns (INSERT already checked this; UPDATE did not).
-- 4. Storage: the recordings bucket gets a size cap and only the one content type
--    the app uploads, so the bucket cannot be used as free general-purpose storage.
-- 5. tg_set_updated_at gets a fixed search_path (Supabase linter 0011).

-- ------------------------------------------------------------- 1. profiles -----
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ------------------------------------------------------------- 2. active gate --
create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.account_status = 'active'
  );
$$;

comment on function public.account_is_active() is
  'True when the calling user''s profile is active. Used by RESTRICTIVE write policies.';

revoke all on function public.account_is_active() from public, anon;
grant execute on function public.account_is_active() to authenticated;

create policy "recorded_sessions: active accounts insert"
  on public.recorded_sessions as restrictive for insert to authenticated
  with check ((select public.account_is_active()));
create policy "recorded_sessions: active accounts update"
  on public.recorded_sessions as restrictive for update to authenticated
  using ((select public.account_is_active()))
  with check ((select public.account_is_active()));

create policy "recorded_channels: active accounts insert"
  on public.recorded_channels as restrictive for insert to authenticated
  with check ((select public.account_is_active()));

create policy "fall_events: active accounts insert"
  on public.fall_events as restrictive for insert to authenticated
  with check ((select public.account_is_active()));

-- ------------------------------------------------------------- 3. re-pointing --
-- (combined with the active gate: one restrictive UPDATE policy per table)
create policy "recorded_channels: active owner keeps own session on update"
  on public.recorded_channels as restrictive for update to authenticated
  using ((select public.account_is_active()))
  with check (
    (select public.account_is_active())
    and exists (
      select 1 from public.recorded_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

create policy "fall_events: active owner keeps own session on update"
  on public.fall_events as restrictive for update to authenticated
  using ((select public.account_is_active()))
  with check (
    (select public.account_is_active())
    and exists (
      select 1 from public.recorded_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

-- Storage writes in the recordings bucket: active accounts only.
create policy "recordings: active accounts write"
  on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'recordings' or (select public.account_is_active()));
create policy "recordings: active accounts update"
  on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'recordings' or (select public.account_is_active()))
  with check (bucket_id <> 'recordings' or (select public.account_is_active()));

-- ------------------------------------------------------------- 4. bucket -------
-- One channel container: ECG at 250 Hz int16 is ~43 MB for 24 h; 50 MB is also the
-- free-plan per-object ceiling. Only the chunk-container type the app uploads.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['application/octet-stream']
 where id = 'recordings';

-- ------------------------------------------------------------- 5. linter -------
alter function public.tg_set_updated_at() set search_path = '';
