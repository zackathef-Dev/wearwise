-- Security review fixes (migration 20261016000009, admin snippets). Plain SQL, no
-- pgTAP, run by supabase/sql-tests/standalone/run.sh. Three parts:
--   A. one transaction, rolled back: items 1-9 and 11 of the migration
--   B. one transaction, rolled back: the admin snippets in supabase/admin/ (item 10),
--      run exactly as written (placeholder email dr.name@example.org)
--   C. the redeem_share_code race (item 5), with two real concurrent connections
--      through dblink; its rows are committed and deleted again at the end
--
-- Cast (A): P, Q participants; S participant who gets suspended; U participant who
-- has not confirmed 18+; R researcher (granted ECG + heart rate by P); C clinician
-- (granted temperature only by P).
-- P's sessions: S1 ECG + HR channels, S2 temperature, S3 discarded with temperature,
-- S4 no channels.

\set P '''00000000-0000-0000-0000-000000000501'''
\set Q '''00000000-0000-0000-0000-000000000502'''
\set S '''00000000-0000-0000-0000-000000000503'''
\set U '''00000000-0000-0000-0000-000000000504'''
\set R '''00000000-0000-0000-0000-000000000511'''
\set C '''00000000-0000-0000-0000-000000000512'''
\set S1 '''51000000-0000-4000-8000-000000000001'''
\set S2 '''51000000-0000-4000-8000-000000000002'''
\set S3 '''51000000-0000-4000-8000-000000000003'''
\set S4 '''51000000-0000-4000-8000-000000000004'''
\set META '''{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16"}'''

-- ================================================================== A ==========
begin;

create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Runs a statement and returns the SQLSTATE it failed with (null if it succeeded),
-- or, for a raised exception, its message.
create function t.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end $$;

-- Rows a statement affected (for "changed nothing" checks under RLS).
create function t.rows(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

create function t.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function t.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on all functions in schema t to authenticated, anon;
create table t.vars (k text primary key, v text);
grant all on t.vars to authenticated;

-- ------------------------------------------------------------- arrange ---------
insert into auth.users (id, email, raw_user_meta_data) values
  (:P, 'p@test.wearwise.io', (:META)::jsonb || '{"display_name":"Pat"}'),
  (:Q, 'q@test.wearwise.io', (:META)::jsonb || '{"display_name":"Quinn"}'),
  (:S, 's@test.wearwise.io', (:META)::jsonb || '{"display_name":"Sam"}'),
  (:U, 'u@test.wearwise.io', (:META)::jsonb || '{"display_name":"Uma"}'),
  (:R, 'r@test.wearwise.io', (:META)::jsonb || '{"display_name":"Dr Reed"}'),
  (:C, 'c@test.wearwise.io', (:META)::jsonb || '{"display_name":"Dr Chen"}');
update public.profiles set account_role = 'researcher' where id = :R;
update public.profiles set account_role = 'clinician' where id = :C;
-- U stands for an account from before the 18+ rule: no confirmation anywhere.
update public.profiles set adult_confirmed_at = null where id = :U;
update auth.users set raw_user_meta_data = raw_user_meta_data - 'adult_confirmed_at' where id = :U;

insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot) values
  (:S1, :P, 'patch-1', now() - interval '4 hours', 'complete', 'ble', 'ble', '{"deviceName":"Patch","firmwareVersion":"0.9.2","sensors":["ecg","hr"]}'),
  (:S2, :P, 'patch-1', now() - interval '3 hours', 'complete', 'ble', 'ble', '{"deviceName":"Patch","sensors":["temp"]}'),
  (:S3, :P, 'patch-1', now() - interval '2 hours', 'discarded', 'ble', 'ble', '{"deviceName":"Patch","sensors":["temp"]}'),
  (:S4, :P, 'patch-1', now() - interval '1 hour', 'interrupted', 'ble', 'ble', '{"deviceName":"Patch","sensors":["spo2"]}'),
  ('61000000-0000-4000-8000-0000000000f0', :Q, 'patch-q', now() - interval '5 hours', 'complete', 'ble', 'ble', '{}');
insert into public.recorded_channels (id, session_id, user_id, sensor_type, canonical_unit, sample_rate_hz, storage_path) values
  ('52000000-0000-4000-8000-000000000001', :S1, :P, 1, 'mV', 250, '00000000-0000-0000-0000-000000000501/51000000-0000-4000-8000-000000000001/52000000-0000-4000-8000-000000000001.wwch'),
  ('52000000-0000-4000-8000-000000000002', :S1, :P, 4, 'bpm', 1, '00000000-0000-0000-0000-000000000501/51000000-0000-4000-8000-000000000001/52000000-0000-4000-8000-000000000002.wwch'),
  ('52000000-0000-4000-8000-000000000003', :S2, :P, 3, 'C', 1, '00000000-0000-0000-0000-000000000501/51000000-0000-4000-8000-000000000002/52000000-0000-4000-8000-000000000003.wwch'),
  ('52000000-0000-4000-8000-000000000004', :S3, :P, 3, 'C', 1, '00000000-0000-0000-0000-000000000501/51000000-0000-4000-8000-000000000003/52000000-0000-4000-8000-000000000004.wwch');
insert into public.fall_events (id, user_id, session_id, detected_at_ms, freefall_min_g, impact_peak_g, status, created_at) values
  ('53000000-0000-4000-8000-000000000001', :P, :S1, 1000, 0.1, 6.5, 'emergency', now()),
  ('53000000-0000-4000-8000-000000000002', :Q, '61000000-0000-4000-8000-0000000000f0', 1000, 0.1, 6.5, 'emergency', now());

-- P shares ECG + heart rate (and falls) with R, temperature only with C.
select t.as_user(:P);
insert into t.vars select 'code_r', code from public.create_share_code('{1,4}', true);
select t.as_user(:R);
select t.ok((public.redeem_share_code((select v from t.vars where k = 'code_r')) ->> 'ok')::boolean, 'R redeems P''s ECG + heart rate code');
select t.as_user(:P);
insert into t.vars select 'code_c', code from public.create_share_code('{3}', false);
select t.as_user(:C);
select t.ok((public.redeem_share_code((select v from t.vars where k = 'code_c')) ->> 'ok')::boolean, 'C redeems P''s temperature-only code');

-- ------------------------------------------------------------- 1. no email -----
select t.as_user(:R);
select t.ok((select participant_name = 'Pat' and participant_email is null from public.list_shared_participants()),
  '1: a viewer gets the participant''s name, never their email (participant_email is NULL)');
select t.as_user(:C);
select t.ok((select participant_email is null from public.list_shared_participants()), '1: for every viewer');
select t.as_user(:P);
select t.ok((select count(*) = 2 and bool_and(grantee_email is not null) from public.list_my_access_grants()),
  '1: the participant still sees the email of each viewer they chose');

-- ------------------------------------------------------------- 2. privileges ---
select t.as_admin();
select t.ok(not exists (
    select 1 from pg_tables p
    where p.schemaname = 'public'
      and has_table_privilege('anon', format('%I.%I', p.schemaname, p.tablename), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
  '2: anon holds no privilege on any table in public');
select t.ok(not exists (
    select 1 from pg_tables p
    where p.schemaname = 'public'
      and has_table_privilege('authenticated', format('%I.%I', p.schemaname, p.tablename), 'TRUNCATE,REFERENCES,TRIGGER')),
  '2: authenticated holds no TRUNCATE, REFERENCES or TRIGGER on any table in public');
select t.ok(current_setting('server_version_num')::int < 170000 or not exists (
    select 1 from pg_tables p
    where p.schemaname = 'public'
      and has_table_privilege('authenticated', format('%I.%I', p.schemaname, p.tablename), 'MAINTAIN')),
  '2: nor MAINTAIN (PG17)');
select t.ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT,DELETE')
        and has_table_privilege('authenticated', 'public.profiles', 'SELECT')
        and has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
        and not has_column_privilege('authenticated', 'public.profiles', 'account_role', 'UPDATE')
        and not has_column_privilege('authenticated', 'public.profiles', 'account_status', 'UPDATE')
        and not has_column_privilege('authenticated', 'public.profiles', 'consent_recorded_at', 'UPDATE'),
  '2: profiles: authenticated may read and rename, nothing else');
select t.ok(not exists (select 1 from pg_sequences q where q.schemaname = 'public'
                        and has_sequence_privilege('authenticated', format('%I.%I', q.schemaname, q.sequencename), 'USAGE,SELECT,UPDATE')),
  '2: no sequence in public is usable by authenticated');

select t.as_user(:Q);
select t.ok(t.err('truncate public.fall_events') = '42501', '2: a participant cannot TRUNCATE fall_events (it would bypass RLS)');
select t.ok(t.err('truncate public.recorded_sessions cascade') = '42501', '2: nor recorded_sessions');
select t.ok(t.err('truncate public.recorded_channels') = '42501', '2: nor recorded_channels');
select t.ok(t.err('truncate public.profiles cascade') = '42501', '2: nor profiles');
select t.ok(t.err($q$insert into public.profiles (id, consent_recorded_at) values ('00000000-0000-0000-0000-000000000599', now())$q$) = '42501',
  '2: a client cannot insert a profile');
select t.ok(t.err('delete from public.profiles') = '42501', '2: nor delete one');
select t.as_admin();
select t.ok((select count(*) from public.fall_events) = 2, '2: all falls are still there');
set local role anon;
select t.ok(t.err('select * from public.profiles') = '42501' and t.err('select * from public.fall_events') = '42501'
        and t.err('select * from public.recorded_sessions') = '42501' and t.err('select * from public.recorded_channels') = '42501',
  '2: anon cannot even read the old tables');
reset role;

select t.ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
                        and has_function_privilege('anon', p.oid, 'execute')),
  '2: anon can execute no function in public or private');
select t.ok((select array_agg(p.proname::text order by p.proname) from pg_proc p
             where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute'))
          = array['accept_terms', 'account_is_active', 'cancel_share_code', 'confirm_adult', 'create_share_code',
                  'list_my_access_grants', 'list_shared_participants', 'my_pending_share_code', 'redeem_share_code',
                  'revoke_access_grant', 'update_access_grant'],
  '2: authenticated executes exactly the client RPCs and account_is_active() in public (no trigger functions)');
select t.ok(not has_function_privilege('authenticated', 'private.new_share_code()', 'execute')
        and not has_function_privilege('authenticated', 'private.carry_over_terms_acceptances()', 'execute')
        and not has_function_privilege('authenticated', 'private.known_terms_version(text)', 'execute'),
  '2: the new private helpers are not executable by clients');

-- What postgres creates from now on starts closed (Supabase's defaults gave anon and
-- authenticated everything, and PUBLIC EXECUTE on functions).
create table public.t_later (id int);
create sequence public.t_later_seq;
create function public.t_later_fn() returns int language sql as 'select 1';
select t.ok(not has_table_privilege('anon', 'public.t_later', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        and not has_table_privilege('authenticated', 'public.t_later', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  '2: a table created later gives anon and authenticated nothing by default');
select t.ok(has_table_privilege('service_role', 'public.t_later', 'SELECT'), '2: (service_role keeps its default)');
select t.ok(not has_sequence_privilege('anon', 'public.t_later_seq', 'USAGE,SELECT,UPDATE')
        and not has_sequence_privilege('authenticated', 'public.t_later_seq', 'USAGE,SELECT,UPDATE'),
  '2: nor does a sequence');
select t.ok(not has_function_privilege('anon', 'public.t_later_fn()', 'execute')
        and not has_function_privilege('authenticated', 'public.t_later_fn()', 'execute'),
  '2: a function created later is executable by nobody but its owner (no PUBLIC EXECUTE either)');
drop function public.t_later_fn();
drop sequence public.t_later_seq;
drop table public.t_later;

-- ------------------------------------------------------------- 3. stamps -------
select t.as_user(:Q);
-- The phone's upserts (supabase-sync-gateway.ts), PostgREST-style: every sent column in the SET list.
select t.ok(t.err($q$insert into public.recorded_sessions (id, user_id, device_id, started_at, ended_at, duration_ms, status, simulated,
    initial_transport, final_transport, transport_switch_count, configuration_snapshot, recovery_state)
  values ('61000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000502', 'patch-q', now() - interval '1 hour', now(), 3600000,
    'complete', false, 'ble', 'ble', 0, '{"deviceName":"Patch"}', null)
  on conflict (id) do update set id = excluded.id, user_id = excluded.user_id, device_id = excluded.device_id,
    started_at = excluded.started_at, ended_at = excluded.ended_at, duration_ms = excluded.duration_ms, status = excluded.status,
    simulated = excluded.simulated, initial_transport = excluded.initial_transport, final_transport = excluded.final_transport,
    transport_switch_count = excluded.transport_switch_count, configuration_snapshot = excluded.configuration_snapshot,
    recovery_state = excluded.recovery_state$q$) is null, '3: the phone''s session upsert still works (insert)');
select t.ok(t.err($q$insert into public.recorded_sessions (id, user_id, device_id, started_at, ended_at, duration_ms, status, simulated,
    initial_transport, final_transport, transport_switch_count, configuration_snapshot, recovery_state)
  values ('61000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000502', 'patch-q', now() - interval '1 hour', now(), 3600001,
    'complete', false, 'ble', 'wifi', 1, '{"deviceName":"Patch"}', null)
  on conflict (id) do update set id = excluded.id, user_id = excluded.user_id, device_id = excluded.device_id,
    started_at = excluded.started_at, ended_at = excluded.ended_at, duration_ms = excluded.duration_ms, status = excluded.status,
    simulated = excluded.simulated, initial_transport = excluded.initial_transport, final_transport = excluded.final_transport,
    transport_switch_count = excluded.transport_switch_count, configuration_snapshot = excluded.configuration_snapshot,
    recovery_state = excluded.recovery_state$q$) is null, '3: ... and updates on a re-sync');
select t.ok((select duration_ms from public.recorded_sessions where id = '61000000-0000-4000-8000-000000000001') = 3600001,
  '3: (the re-sync changed the row)');
select t.ok((select synced_at = now() and created_at = now() from public.recorded_sessions where id = '61000000-0000-4000-8000-000000000001'),
  '3: synced_at / created_at are the server''s');
select t.ok(t.err($q$insert into public.recorded_sessions (id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot, synced_at)
  values ('61000000-0000-4000-8000-000000000002', 'd', now(), 'complete', 'ble', 'ble', '{}', '1970-01-01')$q$) = '42501',
  '3: a session cannot be inserted with synced_at');
select t.ok(t.err($q$insert into public.recorded_sessions (id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot, created_at)
  values ('61000000-0000-4000-8000-000000000002', 'd', now(), 'complete', 'ble', 'ble', '{}', '1970-01-01')$q$) = '42501',
  '3: nor with created_at');
select t.ok(t.err($q$insert into public.recorded_sessions (id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot, updated_at)
  values ('61000000-0000-4000-8000-000000000002', 'd', now(), 'complete', 'ble', 'ble', '{}', '1970-01-01')$q$) = '42501',
  '3: nor with updated_at');
select t.ok(t.err($q$update public.recorded_sessions set synced_at = '2999-01-01'$q$) = '42501'
        and t.err($q$update public.recorded_sessions set created_at = '2999-01-01'$q$) = '42501'
        and t.err($q$update public.recorded_sessions set updated_at = '2999-01-01'$q$) = '42501',
  '3: and none of the three can be updated');

select t.ok(t.err($q$insert into public.recorded_channels (id, user_id, session_id, sensor_type, canonical_unit, sample_rate_hz, sample_count,
    minimum_value, maximum_value, average_value, first_timestamp_us, last_timestamp_us, storage_path)
  values ('62000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000502', '61000000-0000-4000-8000-000000000001', 1, 'mV', 250, 10,
    -1, 1, 0, '1', '10', '00000000-0000-0000-0000-000000000502/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.wwch')
  on conflict (id) do update set id = excluded.id, user_id = excluded.user_id, session_id = excluded.session_id,
    sensor_type = excluded.sensor_type, canonical_unit = excluded.canonical_unit, sample_rate_hz = excluded.sample_rate_hz,
    sample_count = excluded.sample_count, minimum_value = excluded.minimum_value, maximum_value = excluded.maximum_value,
    average_value = excluded.average_value, first_timestamp_us = excluded.first_timestamp_us,
    last_timestamp_us = excluded.last_timestamp_us, storage_path = excluded.storage_path$q$) is null,
  '3: the phone''s channel upsert still works');
select t.ok(t.err($q$insert into public.recorded_channels (id, session_id, sensor_type, canonical_unit, sample_rate_hz, storage_path, created_at)
  values ('62000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001', 4, 'bpm', 1, 'x', '1970-01-01')$q$) = '42501'
    and t.err($q$update public.recorded_channels set created_at = '1970-01-01'$q$) = '42501',
  '3: recorded_channels.created_at is not client-writable');
select t.ok(t.err($q$insert into public.fall_events (id, user_id, session_id, detected_at_ms, freefall_min_g, impact_peak_g, status, created_at)
  values ('63000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000502', '61000000-0000-4000-8000-000000000001', 5, 0.2, 4, 'cancelled', '2026-10-13T01:00:00Z')
  on conflict (id) do update set id = excluded.id, user_id = excluded.user_id, session_id = excluded.session_id,
    detected_at_ms = excluded.detected_at_ms, freefall_min_g = excluded.freefall_min_g, impact_peak_g = excluded.impact_peak_g,
    status = excluded.status, created_at = excluded.created_at$q$) is null,
  '3: the phone''s fall upsert (its own wall-clock created_at included) still works');

-- ------------------------------------------------------------- 4. consent/terms -
select t.as_admin();
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000521', 'clock@test.wearwise.io',
   '{"consent_recorded_at":"1970-01-01T00:00:00Z","adult_confirmed_at":"2999-01-01T00:00:00Z","terms_version":"2026-10-16","terms_accepted_at":"9999-12-31T00:00:00Z"}');
select t.ok((select consent_recorded_at = now() and adult_confirmed_at = now() and terms_accepted_at = now() and terms_version = '2026-10-16'
             from public.profiles where id = '00000000-0000-0000-0000-000000000521'),
  '4: a sign-up records the server''s time for consent, 18+ and terms, whatever the metadata says');
select t.ok(t.err($q$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000522', 'x@test.wearwise.io',
  '{"consent_recorded_at":"2026-10-13T00:00:00Z","adult_confirmed_at":"2026-10-13T00:00:00Z","terms_version":"2999-01-01"}')$q$)
    like '%not a version of the WearWise terms%',
  '4: a sign-up with a terms version the server doesn''t know is refused');
select t.ok(t.err($q$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000522', 'x@test.wearwise.io',
  '{"consent_recorded_at":"2026-10-13T00:00:00Z","adult_confirmed_at":"2026-10-13T00:00:00Z","terms_version":"2000-01-01"}')$q$)
    like '%not a version of the WearWise terms%',
  '4: including the old staff placeholder 2000-01-01');
select t.ok(t.err($q$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000522', 'x@test.wearwise.io',
  '{"consent_recorded_at":"yes","adult_confirmed_at":"2026-10-13T00:00:00Z","terms_version":"2026-10-16"}')$q$)
    like '%consent_recorded_at missing%',
  '4: consent must be present as a timestamp-shaped value');
select t.ok(t.err($q$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000522', 'x@test.wearwise.io',
  '{"consent_recorded_at":"2026-10-13T00:00:00Z","adult_confirmed_at":false,"terms_version":"2026-10-16"}')$q$)
    like '%adult_confirmed_at missing%',
  '4: so must the 18+ declaration');

insert into private.terms_versions (version) values ('2030-01-01');
update public.profiles set terms_version = null, terms_accepted_at = null where id = :Q;
select t.as_user(:Q);
select t.ok(t.err($q$select public.accept_terms('2999-01-01')$q$) = '22023', '4: accept_terms refuses a version the server doesn''t know');
select t.ok((select terms_version is null from public.profiles where id = :Q), '4: and records nothing');
select t.ok(public.accept_terms('2026-10-16') = '2026-10-16', '4: a known version is accepted (an effective date after today is fine)');
select t.ok(public.accept_terms('2030-01-01') = '2030-01-01', '4: as is any later version the server lists — never compared with today''s date');
select t.ok((select terms_accepted_at = now() from public.profiles where id = :Q), '4: at the server''s time');
select t.ok(t.err('select * from private.terms_versions') = '42501', '4: clients cannot read or change the list of versions');

select t.as_admin();
update public.profiles set terms_version = null, terms_accepted_at = null where id in (:P, :Q);
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"terms_version":"2999-01-01","terms_accepted_at":"1970-01-01T00:00:00Z"}' where id = :P;
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"terms_version":"2026-10-16","terms_accepted_at":"1970-01-01T00:00:00Z"}' where id = :Q;
select t.ok(private.carry_over_terms_acceptances() = 1, '4: the terms carry-over takes only versions the server knows');
select t.ok((select terms_version = '2026-10-16' and terms_accepted_at = now() from public.profiles where id = :Q)
        and (select terms_version is null from public.profiles where id = :P),
  '4: at the server''s time');
update public.profiles set adult_confirmed_at = null where id = :Q;
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"adult_confirmed_at":"1970-01-01T00:00:00Z"}' where id = :Q;
select t.ok(private.carry_over_adult_confirmations() = 1, '4: the 18+ carry-over still carries a metadata-only confirmation');
select t.ok((select adult_confirmed_at = now() from public.profiles where id = :Q), '4: with the server''s time too');
update public.profiles set terms_version = '2026-10-16', terms_accepted_at = now() where id = :P;

-- ------------------------------------------------------------- 5. share codes --
create temp table codes as select private.new_share_code() as c from generate_series(1, 2000);
select t.ok((select bool_and(c ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$') from codes),
  '5: generated codes are 10 symbols of the unambiguous alphabet');
select t.ok((select min(n) from (select pos, count(distinct substr(c, pos, 1)) as n
                                 from codes, generate_series(1, 10) pos group by pos) x) = 31,
  '5: every position takes all 31 symbols (the UUID-based draw limited one to 16)');
select t.ok((select count(distinct c) from codes) = 2000, '5: and 2000 draws repeat none');

select t.as_user(:U);
select t.ok(t.err($q$select public.create_share_code('{1}', false)$q$) = '42501',
  '5: an account that has not confirmed 18+ cannot create a share code');
select t.as_admin();
update public.profiles set adult_confirmed_at = now() where id = :U;
select t.as_user(:U);
select t.ok(t.err($q$select public.create_share_code('{1}', false)$q$) is null, '5: it can once it has');

select t.as_user(:S);
insert into t.vars select 'code_s', code from public.create_share_code('{1}', false);
select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :S;
select t.as_user(:R);
select t.ok(public.redeem_share_code((select v from t.vars where k = 'code_s')) = '{"ok": false, "reason": "invalid_or_expired"}'::jsonb,
  '5: a suspended participant''s code is refused exactly like a wrong one');
select t.as_admin();
select t.ok((select redeemed_at is null from public.share_codes where participant_id = :S)
        and not exists (select 1 from public.access_grants where participant_id = :S),
  '5: it is not used up and no grant is made');
select t.ok((select count(*) from public.share_code_attempts where user_id = :R and not succeeded) = 1,
  '5: and it counts as a failed attempt');
select t.ok(exists (
    select 1 from pg_locks l, lateral (select hashtextextended('redeem_share_code:' || :R, 0) as k) h
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
      and l.classid::bigint = (h.k >> 32) & 4294967295 and l.objid::bigint = h.k & 4294967295),
  '5: redeem_share_code holds a per-viewer advisory lock until the transaction ends (race: part C)');
update public.profiles set account_status = 'active' where id = :S;
select t.as_user(:R);
select t.ok((public.redeem_share_code((select v from t.vars where k = 'code_s')) ->> 'ok')::boolean,
  '5: once the participant is active again the same code works');

-- ------------------------------------------------------------- 6. viewer scope --
select t.as_user(:C);
select t.ok((select array_agg(id::text) from public.recorded_sessions where user_id = :P) = array['51000000-0000-4000-8000-000000000002'],
  '6: a temperature-only viewer reads only the session with a temperature channel');
select t.ok(not exists (select 1 from public.recorded_sessions where configuration_snapshot ? 'sensors' and configuration_snapshot ->> 'sensors' like '%ecg%'),
  '6: so not the device configuration of sessions without a granted signal');
select t.ok(not exists (select 1 from public.recorded_sessions where status = 'discarded'), '6: and never a discarded session');
select t.ok((select session_count = 1 and last_session_at = (select started_at from public.recorded_sessions where id = :S2)
             from public.list_shared_participants()),
  '6: list_shared_participants counts only those sessions');
select t.as_user(:R);
select t.ok((select array_agg(id::text) from public.recorded_sessions where user_id = :P) = array['51000000-0000-4000-8000-000000000001'],
  '6: an ECG + heart rate viewer reads only the session with those signals');
select t.as_user(:P);
select t.ok((select count(*) from public.recorded_sessions) = 4, '6: the participant still reads all of their own sessions, discarded included');
select t.as_user(:Q);
select t.ok(t.err($q$insert into public.recorded_channels (id, session_id, sensor_type, canonical_unit, sample_rate_hz, storage_path)
  values ('62000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000001', 3, 'C', 1, 'y')$q$) is null,
  '6: channel inserts (which look up recorded_sessions) still work under the new policy');

-- ------------------------------------------------------------- 7. storage ------
select t.as_admin();
select t.ok((select not public from storage.buckets where id = 'recordings'), '7: the recordings bucket is private');
select t.as_user(:Q);
select t.ok(t.err($q$insert into storage.objects (bucket_id, name) values ('recordings',
  '00000000-0000-0000-0000-000000000502/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.wwch')$q$) is null,
  '7: the phone''s object name <uid>/<session>/<channel>.wwch is accepted');
select t.ok(t.err($q$insert into storage.objects (bucket_id, name) values ('recordings',
  '00000000-0000-0000-0000-000000000502/61000000-0000-4000-8000-00000000000A/62000000-0000-4000-8000-00000000000B.wwch')$q$) is null,
  '7: (hex in either case)');
select t.ok(t.err($q$insert into storage.objects (bucket_id, name) values ('recordings', '00000000-0000-0000-0000-000000000502/x.bin')$q$) = '42501'
        and t.err($q$insert into storage.objects (bucket_id, name) values ('recordings',
              '00000000-0000-0000-0000-000000000502/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.bin')$q$) = '42501'
        and t.err($q$insert into storage.objects (bucket_id, name) values ('recordings',
              '00000000-0000-0000-0000-000000000502/62000000-0000-4000-8000-000000000001.wwch')$q$) = '42501'
        and t.err($q$insert into storage.objects (bucket_id, name) values ('recordings',
              '00000000-0000-0000-0000-000000000502/a/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.wwch')$q$) = '42501'
        and t.err($q$insert into storage.objects (bucket_id, name) values ('recordings',
              '00000000-0000-0000-0000-000000000502/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.wwch.exe')$q$) = '42501',
  '7: any other name in the caller''s own folder is refused');
select t.ok(t.err($q$insert into storage.objects (bucket_id, name) values ('recordings',
  '00000000-0000-0000-0000-000000000501/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000009.wwch')$q$) = '42501',
  '7: and so is a well-formed name in someone else''s folder');
select t.ok(t.err($q$update storage.objects set name = '00000000-0000-0000-0000-000000000502/free-storage.zip'
  where name = '00000000-0000-0000-0000-000000000502/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.wwch'$q$) = '42501',
  '7: an object cannot be renamed (moved) out of the format');
select t.ok(t.rows($q$update storage.objects set name = '00000000-0000-0000-0000-000000000502/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000002.wwch'
  where name = '00000000-0000-0000-0000-000000000502/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.wwch'$q$) = 1,
  '7: but can be moved to another well-formed name');

-- ------------------------------------------------------------- 8. realtime -----
select t.as_admin();
select t.ok((select pubinsert and pubupdate and not pubdelete and not pubtruncate from pg_publication where pubname = 'supabase_realtime'),
  '8: supabase_realtime publishes INSERT and UPDATE only (DELETE events are not RLS-filtered)');
select t.ok((select array_agg(tablename::text order by tablename) from pg_publication_tables where pubname = 'supabase_realtime')
          = '{fall_events,vital_alerts}', '8: and still carries fall_events and vital_alerts');

-- ------------------------------------------------------------- 9. staff rename -
select t.as_user(:R);
select t.ok(t.rows($q$update public.profiles set display_name = 'Dr R. Reed' where id = auth.uid()$q$) = 1,
  '9: a researcher can change their display name');
select t.ok((select display_name from public.profiles where id = :R) = 'Dr R. Reed', '9: (it changed)');
select t.ok(t.err($q$update public.profiles set account_role = 'participant' where id = auth.uid()$q$) = '42501'
        and t.err($q$update public.profiles set account_status = 'suspended' where id = auth.uid()$q$) = '42501',
  '9: but not their role or status');
select t.as_user(:C);
select t.ok(t.rows($q$update public.profiles set display_name = 'Dr C. Chen' where id = auth.uid()$q$) = 1, '9: so can a clinician');
select t.ok(t.rows($q$update public.profiles set display_name = 'hijack' where id = '00000000-0000-0000-0000-000000000501'$q$) = 0,
  '9: nobody renames anyone else');
select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :Q;
select t.as_user(:Q);
select t.ok(t.err($q$update public.profiles set display_name = 'Q2' where id = auth.uid()$q$) = '42501', '9: a suspended account cannot rename itself');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :Q;

-- ------------------------------------------------------------- 11. live grants -
select t.as_user(:R);
select t.ok((select count(*) from public.access_grants) = 2, '11: a viewer reads their live grants (from P and S)');
select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :R;
select t.as_user(:R);
select t.ok((select count(*) from public.access_grants) = 0, '11: none while the viewer is suspended');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :R;
update public.profiles set account_status = 'suspended' where id = :S;
select t.as_user(:R);
select t.ok((select count(*) from public.access_grants) = 1, '11: nor the grant of a suspended participant');
select t.as_user(:P);
select public.revoke_access_grant((select id from public.access_grants where grantee_id = :R));
select t.as_user(:R);
select t.ok((select count(*) from public.access_grants where participant_id = :P) = 0, '11: nor a revoked grant');
select t.as_user(:P);
select t.ok((select count(*) from public.access_grants where grantee_id = :R and revoked_at is not null) = 1,
  '11: the participant still reads the revoked grant (audit trail)');

rollback;

-- ================================================================== B ==========
-- The admin snippets, as an owner would run them. admin_snippets.local.sql leaves a
-- dr.name@example.org account behind; it is moved aside inside this transaction.
begin;

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create function pg_temp.sessions_of(addr text) returns bigint language sql as $$
  select count(*) from auth.sessions s join auth.users u on u.id = s.user_id where lower(u.email) = addr;
$$;

create function pg_temp.refresh_tokens_of(addr text) returns bigint language sql as $$
  select count(*) from auth.refresh_tokens r join auth.users u on u.id::text = r.user_id where lower(u.email) = addr;
$$;

-- Two signed-in devices, each with a refresh token, as GoTrue records them.
create function pg_temp.sign_in_twice(addr text) returns void language plpgsql as $$
declare
  uid uuid := (select id from auth.users where lower(email) = addr);
  sid uuid;
begin
  for i in 1..2 loop
    insert into auth.sessions (id, user_id) values (gen_random_uuid(), uid) returning id into sid;
    insert into auth.refresh_tokens (token, user_id, revoked, session_id) values (gen_random_uuid()::text, uid::text, false, sid);
  end loop;
end $$;

update auth.users set email = 'moved-' || id || '@example.org' where lower(email) = 'dr.name@example.org';

\ir ../admin/create-viewer.sql
select pg_temp.ok((select p.account_role = 'researcher' and p.terms_version is null and p.terms_accepted_at is null
                          and p.consent_recorded_at = now() and p.adult_confirmed_at = now()
                          and not (u.raw_user_meta_data ? 'terms_version')
                     from public.profiles p join auth.users u on u.id = p.id where u.email = 'dr.name@example.org'),
  '10: create-viewer makes a researcher who must still accept the terms themselves');

-- set-role: refused while the email address is unconfirmed.
select pg_temp.sign_in_twice('dr.name@example.org');
update public.profiles set account_role = 'participant' where id = (select id from auth.users where email = 'dr.name@example.org');
update auth.users set email_confirmed_at = null where email = 'dr.name@example.org';
\ir ../admin/set-role.sql
select pg_temp.ok((select p.account_role = 'participant' from public.profiles p join auth.users u on u.id = p.id where u.email = 'dr.name@example.org')
                  and pg_temp.sessions_of('dr.name@example.org') = 2,
  '10: set-role changes nothing for an account whose email is not confirmed');
update auth.users set email_confirmed_at = now() where email = 'dr.name@example.org';
\ir ../admin/set-role.sql
select pg_temp.ok((select p.account_role = 'researcher' from public.profiles p join auth.users u on u.id = p.id where u.email = 'dr.name@example.org'),
  '10: set-role changes a confirmed account');
select pg_temp.ok(pg_temp.sessions_of('dr.name@example.org') = 0 and pg_temp.refresh_tokens_of('dr.name@example.org') = 0,
  '10: and ends its sessions (and with them its refresh tokens)');

select pg_temp.sign_in_twice('dr.name@example.org');
\ir ../admin/set-status.sql
select pg_temp.ok((select p.account_status = 'suspended' from public.profiles p join auth.users u on u.id = p.id where u.email = 'dr.name@example.org')
                  and pg_temp.sessions_of('dr.name@example.org') = 0 and pg_temp.refresh_tokens_of('dr.name@example.org') = 0,
  '10: set-status suspends and ends every session');

select pg_temp.sign_in_twice('dr.name@example.org');
\ir ../admin/reset-password.sql
select pg_temp.ok(pg_temp.sessions_of('dr.name@example.org') = 0 and pg_temp.refresh_tokens_of('dr.name@example.org') = 0
                  and (select u.encrypted_password = extensions.crypt(r.one_time_password, u.encrypted_password)
                         from auth.users u, pg_temp.pw_reset r where u.email = r.email),
  '10: reset-password sets the new password and ends every session');

-- orphaned-recordings: one folder of a user that no longer exists, one of a live user.
insert into storage.objects (bucket_id, name, metadata) values
  ('recordings', '00000000-0000-0000-0000-0000000005ff/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.wwch', '{"size": 2048}'),
  ('recordings', (select id from auth.users where email = 'dr.name@example.org') || '/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.wwch', '{"size": 10}');
-- The snippet's output is captured on the psql side (\o, then a shell `cat`), so this needs
-- no server file access: on Supabase the postgres role isn't a superuser (no pg_read_file).
\o /tmp/wearwise-orphaned-recordings.out
\ir ../admin/orphaned-recordings.sql
\o /dev/null
\set orphan_out `cat /tmp/wearwise-orphaned-recordings.out; rm -f /tmp/wearwise-orphaned-recordings.out`
select pg_temp.ok(:'orphan_out' ~ '00000000-0000-0000-0000-0000000005ff\s*\|\s*1\s*\|\s*2048 bytes'
                  and :'orphan_out' not like '%' || (select id from auth.users where email = 'dr.name@example.org') || '%',
  '10: orphaned-recordings lists the folder of the missing user, with its size, and not the live user''s');

rollback;

-- ================================================================== C ==========
-- redeem_share_code under real concurrency: two connections as the same viewer, who
-- has 9 failed attempts this hour. Without the advisory lock both would count 9 and
-- both try a code (11 failures against a limit of 10); with it, the second waits for
-- the first to commit and then sees 10.
select exists (select 1 from pg_available_extensions where name = 'dblink') as have_dblink \gset
\if :have_dblink
create schema race;
create extension dblink schema race;

create function race.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'race-v@test.wearwise.io', (:META)::jsonb),
  ('00000000-0000-0000-0000-0000000005a2', 'race-w@test.wearwise.io', (:META)::jsonb);
update public.profiles set account_role = 'researcher' where id in ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a2');
insert into public.share_code_attempts (user_id, succeeded)
select '00000000-0000-0000-0000-0000000005a1', false from generate_series(1, 9);

-- On Supabase the postgres role isn't a superuser, so dblink must authenticate with a
-- password over a connection that asks for one: pass -v dblink_host=<a non-loopback address
-- of the server> -v dblink_password=... (run-on-local-stack.sh does). The standalone
-- harness connects over its own socket with trust.
\if :{?dblink_password}
select format('host=%s port=%s dbname=%s user=%s password=%s', :'dblink_host', current_setting('port'),
              current_database(), current_user, :'dblink_password') as conn \gset
\else
select format('host=%s port=%s dbname=%s user=%s', split_part(current_setting('unix_socket_directories'), ',', 1),
              current_setting('port'), current_database(), current_user) as conn \gset
\endif
select race.dblink_connect('c1', :'conn'), race.dblink_connect('c2', :'conn'), race.dblink_connect('c3', :'conn');
create temp table race_conns (c text, u uuid);
insert into race_conns values ('c1', '00000000-0000-0000-0000-0000000005a1'), ('c2', '00000000-0000-0000-0000-0000000005a1'),
                              ('c3', '00000000-0000-0000-0000-0000000005a2');
select race.dblink_exec(c, 'begin') from race_conns;
select race.dblink_exec(c, format('set local request.jwt.claims to %L', json_build_object('sub', u, 'role', 'authenticated'))) from race_conns;
select race.dblink_exec(c, 'set local role authenticated') from race_conns;
select pid as c2_pid from race.dblink('c2', 'select pg_backend_pid()') as r(pid int) \gset

-- c1: the 10th failure, transaction left open.
select race.ok((select res from race.dblink('c1', $$select public.redeem_share_code('ZZZZZ-ZZZZZ') ->> 'reason'$$) as r(res text))
               = 'invalid_or_expired', '5: race: the first attempt is the 10th failure');
-- c2: same viewer, at the same time.
select race.dblink_send_query('c2', $$select public.redeem_share_code('ZZZZZ-ZZZZY') ->> 'reason'$$);
do $$
begin
  for i in 1..200 loop
    exit when exists (select 1 from pg_locks where locktype = 'advisory' and not granted);
    perform pg_sleep(0.05);
  end loop;
end $$;
select race.ok(exists (select 1 from pg_locks where locktype = 'advisory' and not granted and pid = :c2_pid),
  '5: race: a second redemption by the same viewer waits for the first to finish');
select race.ok(race.dblink_is_busy('c2') = 1, '5: race: (still waiting)');
-- c3: another viewer is not held up (a wait would hit the timeout and fail here).
select race.dblink_exec('c3', 'set local statement_timeout = ''5s''');
select race.ok((select res from race.dblink('c3', $$select public.redeem_share_code('ZZZZZ-ZZZZX') ->> 'reason'$$) as r(res text))
               = 'invalid_or_expired', '5: race: another viewer is not held up');

select race.dblink_exec('c1', 'commit');
select race.ok((select res from race.dblink_get_result('c2') as r(res text)) = 'rate_limited',
  '5: race: after the first commits, the second sees 10 failures and is rate limited');
select * from race.dblink_get_result('c2') as r(res text);
select race.dblink_exec('c2', 'commit'), race.dblink_exec('c3', 'commit');
select race.ok((select count(*) from public.share_code_attempts where user_id = '00000000-0000-0000-0000-0000000005a1' and not succeeded) = 10,
  '5: race: the limit held: 10 failures recorded, not 11');

select race.dblink_disconnect(c) from race_conns;
drop table race_conns;
delete from auth.users where id in ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a2');
drop schema race cascade;
\else
\echo 'SKIP: dblink is not available, the concurrent redeem test (part C) did not run'
\endif
