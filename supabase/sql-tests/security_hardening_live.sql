-- Live RLS check for the 2026-10-13 hardening (and two-account isolation).
--
-- Runs as ONE DO block against the real project through the Management API:
--   SB_PAT=... node supabase/scripts/admin.mjs sql supabase/sql-tests/security_hardening_live.sql
-- Every user, row and object it creates is rolled back: the block always ends by
-- raising an exception whose message carries the results, so nothing persists.
-- Users are simulated exactly as PostgREST does it: role `authenticated` plus the
-- request.jwt.claims `sub`.
do $$
declare
  a  uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b  uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  c  uuid := 'cccccccc-0000-4000-8000-00000000000c';
  sa uuid := 'aaaaaaaa-1111-4000-8000-00000000000a';
  sb uuid := 'bbbbbbbb-1111-4000-8000-00000000000b';
  ca uuid := 'aaaaaaaa-2222-4000-8000-00000000000a';
  fa uuid := 'aaaaaaaa-3333-4000-8000-00000000000a';
  n int; out text := ''; passed int := 0; failed int := 0;
  meta jsonb := '{"consent_recorded_at":"2026-10-13T00:00:00Z","adult_confirmed_at":"2026-10-13T00:00:00Z","terms_version":"2026-10-16","display_name":"rls-probe"}';
  procedure_ok boolean;
  admin_role text := current_user;
begin
  -- ---- arrange (as the table owner; RLS does not apply) ----
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (a, 'rls-a@probe.invalid', meta, 'authenticated', 'authenticated'),
         (b, 'rls-b@probe.invalid', meta, 'authenticated', 'authenticated'),
         (c, 'rls-c@probe.invalid', meta, 'authenticated', 'authenticated');
  update public.profiles set account_status = 'suspended' where id = c;
  insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot)
  values (sa, a, 'probe', now(), 'complete', 'bluetooth', 'bluetooth', '{}'),
         (sb, b, 'probe', now(), 'complete', 'bluetooth', 'bluetooth', '{}');
  insert into public.recorded_channels (id, session_id, user_id, sensor_type, canonical_unit, sample_rate_hz, storage_path)
  values (ca, sa, a, 1, 'mV', 250, a::text || '/probe.bin');
  insert into public.fall_events (id, user_id, session_id, detected_at_ms, freefall_min_g, impact_peak_g, status, created_at)
  values (fa, a, sa, 1000, 0.2, 3.1, 'cancelled', now());

  -- ---- act as participant A ----
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.recorded_sessions where id = sb;
  if n = 0 then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:A-reads-B-session'; end if;
  select count(*) into n from public.profiles where id = b;
  if n = 0 then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:A-reads-B-profile'; end if;
  select count(*) into n from public.recorded_channels where user_id = b;
  if n = 0 then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:A-reads-B-channels'; end if;

  update public.profiles set display_name = 'renamed' where id = a;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:A-cannot-rename'; end if;

  begin
    update public.profiles set consent_recorded_at = now() where id = a;
    failed := failed + 1; out := out || ' FAIL:A-rewrote-consent';
  exception when others then passed := passed + 1; end;

  begin
    update public.profiles set account_role = 'researcher' where id = a;
    failed := failed + 1; out := out || ' FAIL:A-self-promoted';
  exception when others then passed := passed + 1; end;

  begin
    insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot)
    values (gen_random_uuid(), b, 'probe', now(), 'complete', 'x', 'x', '{}');
    failed := failed + 1; out := out || ' FAIL:A-wrote-as-B';
  exception when others then passed := passed + 1; end;

  update public.recorded_sessions set device_id = 'hijack' where id = sb;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:A-updated-B-session'; end if;
  delete from public.recorded_sessions where id = sb;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:A-deleted-B-session'; end if;

  begin
    update public.recorded_channels set session_id = sb where id = ca;
    failed := failed + 1; out := out || ' FAIL:A-repointed-channel';
  exception when others then passed := passed + 1; end;
  begin
    update public.fall_events set session_id = sb where id = fa;
    failed := failed + 1; out := out || ' FAIL:A-repointed-fall';
  exception when others then passed := passed + 1; end;

  update public.recorded_channels set sample_count = 5 where id = ca;   -- normal re-sync still works
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:A-own-channel-update-blocked'; end if;

  -- Object names are <uid>/<session uuid>/<channel uuid>.wwch (20261016000009).
  begin
    insert into storage.objects (bucket_id, name, owner) values ('recordings', b::text || '/' || sa::text || '/' || ca::text || '.wwch', a);
    failed := failed + 1; out := out || ' FAIL:A-wrote-B-folder';
  exception when others then passed := passed + 1; end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('recordings', a::text || '/' || sa::text || '/' || ca::text || '.wwch', a);
    passed := passed + 1;
  exception when others then failed := failed + 1; out := out || ' FAIL:A-own-folder-blocked(' || sqlerrm || ')'; end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('recordings', a::text || '/x.bin', a);
    failed := failed + 1; out := out || ' FAIL:A-stored-free-form-name';
  exception when others then passed := passed + 1; end;

  -- ---- act as suspended participant C ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin
    insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot)
    values (gen_random_uuid(), c, 'probe', now(), 'complete', 'x', 'x', '{}');
    failed := failed + 1; out := out || ' FAIL:suspended-can-upload';
  exception when others then passed := passed + 1; end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('recordings', c::text || '/' || sa::text || '/' || ca::text || '.wwch', c);
    failed := failed + 1; out := out || ' FAIL:suspended-can-store';
  exception when others then passed := passed + 1; end;
  begin
    select count(*) into n from public.recorded_sessions;   -- reading own data stays allowed
    passed := passed + 1;
  exception when others then failed := failed + 1; out := out || ' FAIL:suspended-cannot-read'; end;

  -- ---- server configuration ----
  perform set_config('role', admin_role, true);
  select count(*) into n from storage.buckets
   where id = 'recordings' and not public and file_size_limit is not null
     and allowed_mime_types = array['application/octet-stream'];
  if n = 1 then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:bucket-limits'; end if;
  select coalesce(bool_or(cfg like 'search_path=%'), false) into procedure_ok
    from pg_proc p, unnest(p.proconfig) cfg where p.proname = 'tg_set_updated_at';
  if coalesce(procedure_ok, false) then passed := passed + 1; else failed := failed + 1; out := out || ' FAIL:updated_at-search_path'; end if;

  raise exception 'RLS_RESULTS passed=% failed=% %', passed, failed, out;
end $$;
