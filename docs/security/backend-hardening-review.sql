-- REVIEWED PROPOSAL ONLY: not applied to the hosted database.
-- Compare with live grants/policies first, run in a staging transaction, then run
-- the two-account RLS tests. Anonymous empty results alone do not verify this.
begin;

-- RLS row checks do not make consent/status/role columns immutable.
revoke update on public.profiles from public, anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "profiles: participants rename themselves only" on public.profiles;
create policy "profiles: participants rename themselves only"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and account_status = 'active')
  with check (id = (select auth.uid()) and account_status = 'active');

-- Re-parenting a channel must not bypass the INSERT ownership invariant.
drop policy if exists "recorded_channels: owner updates" on public.recorded_channels;
create policy "recorded_channels: owner updates"
  on public.recorded_channels for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and exists (
      select 1 from public.recorded_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

-- Existing buckets must be private too; INSERT ON CONFLICT DO NOTHING is insufficient.
update storage.buckets set public = false where id = 'recordings';

-- These trigger functions are not client RPC endpoints.
revoke execute on function public.tg_create_profile_for_new_user() from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated;

commit;
