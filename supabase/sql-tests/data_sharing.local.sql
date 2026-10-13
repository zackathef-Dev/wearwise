-- Data-sharing RLS tests (migration 20261014000005). Plain SQL, no pgTAP, so it runs
-- on the local stub (supabase/sql-tests/standalone/run.sh) and on any Postgres with the
-- migrations applied. Everything happens in one transaction that is rolled back.
--
-- Cast: P and Q participants, R researcher, C clinician.
-- Each step switches identity the way PostgREST does: role authenticated + the
-- JWT "sub" claim that auth.uid() reads.

\set P '''00000000-0000-0000-0000-0000000000a1'''
\set Q '''00000000-0000-0000-0000-0000000000a2'''
\set R '''00000000-0000-0000-0000-0000000000b1'''
\set C '''00000000-0000-0000-0000-0000000000c1'''

begin;

-- Real Supabase Storage blocks DELETE on storage.objects from SQL with a trigger
-- (storage.protect_delete) unless this setting is on. Turn it on for this transaction so
-- the deletes below are refused (or not) by the RLS policies under test, as they would
-- be through the Storage API. The stub has no such trigger; the setting is harmless there.
set local storage.allow_delete_query = 'true';

create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Runs a statement and returns the SQLSTATE it failed with (null if it succeeded).
create function t.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
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
  (:P, 'p@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Pat"}'),
  (:Q, 'q@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Quinn"}'),
  (:R, 'r@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Dr Reed"}'),
  (:C, 'c@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Dr Chen"}');
update public.profiles set account_role = 'researcher' where id = :R;
update public.profiles set account_role = 'clinician' where id = :C;

insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot) values
  ('10000000-0000-0000-0000-000000000001', :P, 'd', now() - interval '2 hours', 'complete', 'ble', 'ble', '{}'),
  ('10000000-0000-0000-0000-000000000002', :P, 'd', now() - interval '1 hour', 'interrupted', 'ble', 'ble', '{}'),
  ('20000000-0000-0000-0000-000000000001', :Q, 'd', now(), 'complete', 'ble', 'ble', '{}');

insert into public.recorded_channels (id, session_id, user_id, sensor_type, canonical_unit, sample_rate_hz, storage_path) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', :P, 1, 'mV', 250, '00000000-0000-0000-0000-0000000000a1/s1/ecg.bin'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', :P, 4, 'bpm', 1, '00000000-0000-0000-0000-0000000000a1/s1/hr.bin'),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', :P, 3, 'C', 1, '00000000-0000-0000-0000-0000000000a1/s1/temp.bin'),
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', :Q, 1, 'mV', 250, '00000000-0000-0000-0000-0000000000a2/s1/ecg.bin');

insert into public.fall_events (id, user_id, session_id, detected_at_ms, freefall_min_g, impact_peak_g, status, created_at) values
  ('12000000-0000-0000-0000-000000000001', :P, '10000000-0000-0000-0000-000000000001', 1000, 0.1, 6.5, 'emergency', now());

insert into storage.objects (bucket_id, name) values
  ('recordings', '00000000-0000-0000-0000-0000000000a1/s1/ecg.bin'),
  ('recordings', '00000000-0000-0000-0000-0000000000a1/s1/hr.bin'),
  ('recordings', '00000000-0000-0000-0000-0000000000a1/s1/temp.bin'),
  ('recordings', '00000000-0000-0000-0000-0000000000a2/s1/ecg.bin');

-- ------------------------------------------------------------- before sharing --
select t.as_user(:R);
select t.ok((select count(*) from public.recorded_sessions) = 0, 'researcher sees no sessions before any grant');
select t.ok((select count(*) from public.recorded_channels) = 0, 'researcher sees no channels before any grant');
select t.ok((select count(*) from public.fall_events) = 0, 'researcher sees no falls before any grant');
select t.ok((select count(*) from storage.objects) = 0, 'researcher sees no objects before any grant');
select t.ok(t.err('select * from public.share_codes') = '42501', 'share_codes is not readable by clients');
select t.ok(t.err($$insert into public.access_grants (participant_id, grantee_id, sensor_types, include_falls)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '{1}', true)$$) = '42501',
  'a viewer cannot insert a grant directly');
select t.ok(t.err($$select public.create_share_code('{1}', true)$$) = '42501', 'a researcher cannot create a share code');

-- ------------------------------------------------------------- create code -----
select t.as_user(:P);
select t.ok(t.err($$select public.create_share_code('{}', true)$$) is not null, 'sharing nothing is rejected');
select t.ok(t.err($$select public.create_share_code('{9}', true)$$) = '22023', 'unknown sensor types are rejected');
insert into t.vars select 'old', code from public.create_share_code('{1,4}', true);
insert into t.vars select 'code', code from public.create_share_code('{1,4,4}', true);
select t.ok((select v from t.vars where k = 'code') ~ '^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$', 'code is XXXXX-XXXXX from the unambiguous alphabet');
select t.ok((select count(*) from public.recorded_sessions) = 2, 'participant still reads own sessions');

-- ------------------------------------------------------------- redeem ----------
select t.as_user(:Q);
select t.ok(t.err(format('select public.redeem_share_code(%L)', (select v from t.vars where k = 'code'))) = '42501',
  'a participant cannot redeem a share code');

select t.as_user(:R);
select t.ok((public.redeem_share_code('AAAAA-AAAAA') ->> 'reason') = 'invalid_or_expired', 'a wrong code is refused');
select t.ok((public.redeem_share_code((select v from t.vars where k = 'old')) ->> 'ok')::boolean is false,
  'creating a new code invalidated the previous unused one');
select t.ok((public.redeem_share_code(lower(replace((select v from t.vars where k = 'code'), '-', ' '))) ->> 'participant_name') = 'Pat',
  'the code redeems case- and dash-insensitively and names the participant');

select t.as_user(:C);
select t.ok((public.redeem_share_code((select v from t.vars where k = 'code')) ->> 'ok')::boolean is false, 'a code works only once');

-- ------------------------------------------------------------- viewer reads ----
select t.as_user(:R);
-- P's second session has no channels at all, so nothing in it is shared (20261016000009).
select t.ok((select count(*) from public.recorded_sessions) = 1, 'researcher reads P''s sessions that hold a granted signal');
select t.ok((select count(*) from public.recorded_sessions where user_id = :Q) = 0, 'researcher reads none of Q''s sessions');
select t.ok((select array_agg(sensor_type order by sensor_type) from public.recorded_channels) = '{1,4}', 'researcher reads only the granted signals (ECG, HR)');
select t.ok((select count(*) from public.fall_events) = 1, 'researcher reads P''s falls when included');
select t.ok((select array_agg(name order by name) from storage.objects) =
  array['00000000-0000-0000-0000-0000000000a1/s1/ecg.bin', '00000000-0000-0000-0000-0000000000a1/s1/hr.bin'],
  'researcher downloads only the granted channel objects');

select t.ok(t.err($$insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot)
  values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a1', 'd', now(), 'complete', 'ble', 'ble', '{}')$$) = '42501',
  'researcher cannot write sessions for P');
update public.recorded_sessions set device_id = 'tampered';
delete from public.fall_events;
delete from storage.objects;
select t.as_admin();
select t.ok((select count(*) from public.recorded_sessions where device_id = 'tampered') = 0, 'researcher updates change nothing');
select t.ok((select count(*) from public.fall_events) = 1, 'researcher deletes change nothing (falls)');
-- Only this test's objects: a local stack may also hold the demo seed's files.
select t.ok((select count(*) from storage.objects where name like '00000000-0000-0000-0000-0000000000a_/%') = 4, 'researcher deletes change nothing (objects)');

-- ------------------------------------------------------------- listings --------
select t.as_user(:P);
select t.ok((select grantee_email || '/' || grantee_role from public.list_my_access_grants()) = 'r@test.wearwise.io/researcher', 'participant sees who has access');
select t.as_user(:R);
select t.ok((select participant_name || '/' || session_count from public.list_shared_participants()) = 'Pat/1', 'researcher sees the participant with a count of the sessions they can open');
select t.as_user(:C);
select t.ok((select count(*) from public.list_shared_participants()) = 0, 'clinician without a grant lists nobody');

-- ------------------------------------------------------------- change scope ----
select t.as_user(:Q);
select public.update_access_grant((select grant_id from public.list_shared_participants() limit 1), '{1,2,3,4,5,6}', true);
select t.as_user(:P);
insert into t.vars select 'grant', grant_id::text from public.list_my_access_grants();
select public.update_access_grant((select v::uuid from t.vars where k = 'grant'), '{3}', false);
select t.as_user(:R);
select t.ok((select array_agg(sensor_type) from public.recorded_channels) = '{3}', 'narrowed grant: researcher now sees only temperature');
select t.ok((select count(*) from public.fall_events) = 0, 'narrowed grant: falls hidden');

-- Another participant can't touch P's grant.
select t.as_user(:Q);
select public.revoke_access_grant((select v::uuid from t.vars where k = 'grant'));
select public.update_access_grant((select v::uuid from t.vars where k = 'grant'), '{1,2,3,4,5,6}', true);
select t.as_user(:R);
select t.ok((select count(*) from public.recorded_sessions) = 1, 'Q cannot revoke P''s grant');
select t.ok((select array_agg(sensor_type) from public.recorded_channels) = '{3}', 'Q cannot widen P''s grant');

-- ------------------------------------------------------------- path hijack -----
-- Q shares everything with R, then points one of Q's channel rows at P's ECG
-- object (which P's grant no longer covers). R must still not get P's ECG.
select t.as_user(:Q);
insert into t.vars select 'qcode', code from public.create_share_code('{1,2,3,4,5,6}', true);
select t.as_user(:R);
select t.ok((public.redeem_share_code((select v from t.vars where k = 'qcode')) ->> 'ok')::boolean, 'R redeems Q''s code');
select t.as_user(:Q);
insert into public.recorded_channels (id, session_id, user_id, sensor_type, canonical_unit, sample_rate_hz, storage_path)
values ('21000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', :Q, 1, 'mV', 250,
        '00000000-0000-0000-0000-0000000000a1/s1/ecg.bin');
select t.as_user(:R);
select t.ok(not exists (select 1 from storage.objects where name = '00000000-0000-0000-0000-0000000000a1/s1/ecg.bin'),
  'a channel row pointing into another participant''s folder grants nothing');
select t.ok(exists (select 1 from storage.objects where name = '00000000-0000-0000-0000-0000000000a2/s1/ecg.bin'),
  'R reads Q''s own objects under Q''s grant');

-- ------------------------------------------------------------- account states --
select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :P;
select t.as_user(:R);
select t.ok((select count(*) from public.recorded_sessions where user_id = :P) = 0, 'a suspended participant''s data is no longer shared');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :P;
update public.profiles set account_role = 'participant' where id = :R;
select t.as_user(:R);
select t.ok((select count(*) from public.recorded_sessions where user_id = :P) = 0, 'a demoted viewer loses access');
select t.as_admin();
update public.profiles set account_role = 'researcher' where id = :R;

-- ------------------------------------------------------------- re-share --------
select t.as_user(:P);
insert into t.vars select 'code2', code from public.create_share_code('{1}', false);
select t.as_user(:R);
select public.redeem_share_code((select v from t.vars where k = 'code2'));
select t.as_admin();
select t.ok((select count(*) from public.access_grants where participant_id = :P and grantee_id = :R and revoked_at is null) = 1,
  're-sharing with the same viewer updates the one live grant');
select t.as_user(:R);
select t.ok((select array_agg(sensor_type) from public.recorded_channels where user_id = :P) = '{1}', 're-share replaced the scope');

-- ------------------------------------------------------------- revoke ----------
select t.as_user(:P);
select public.revoke_access_grant((select v::uuid from t.vars where k = 'grant'));
select t.as_user(:R);
select t.ok((select count(*) from public.recorded_sessions where user_id = :P) = 0, 'after revoke the researcher sees none of P''s sessions');
select t.ok(not exists (select 1 from storage.objects where name like '00000000-0000-0000-0000-0000000000a1/%'), 'after revoke no objects either');
select t.ok((select count(*) from public.list_shared_participants() where participant_id = :P) = 0, 'after revoke P is off the list');
select t.as_user(:P);
select t.ok((select count(*) from public.list_my_access_grants()) = 0, 'after revoke P lists nobody');
select t.as_admin();
select t.ok((select revoked_by from public.access_grants where id = (select v::uuid from t.vars where k = 'grant')) = :P, 'the revoked grant is kept with who revoked it');

-- ------------------------------------------------------------- results ---------
select t.as_user(:P);
select t.ok(public.revoke_access_grant((select v::uuid from t.vars where k = 'grant')) is false, 'revoking an ended grant reports false');
select t.ok(public.update_access_grant((select v::uuid from t.vars where k = 'grant'), '{1}', false) is false, 'updating an ended grant reports false');

-- ------------------------------------------------------------- pending code ----
insert into t.vars select 'code5', code from public.create_share_code('{2,5}', true);
select t.ok((select sensor_types::text || include_falls from public.my_pending_share_code()) = '{2,5}true', 'the participant sees their unused code''s scope');
select t.ok(public.cancel_share_code(), 'the participant can withdraw an unused code');
select t.ok((select count(*) from public.my_pending_share_code()) = 0, 'nothing pending after withdrawing');
select t.as_user(:R);
select t.ok((public.redeem_share_code((select v from t.vars where k = 'code5')) ->> 'ok')::boolean is false, 'a withdrawn code cannot be redeemed');

-- ------------------------------------------------------------- access_active ---
select t.as_user(:P);
insert into t.vars select 'code6', code from public.create_share_code('{1}', false);
select t.as_user(:R);
select public.redeem_share_code((select v from t.vars where k = 'code6'));
select t.as_user(:P);
select t.ok((select access_active from public.list_my_access_grants()), 'a working grant is listed as active');
select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :R;
select t.as_user(:P);
select t.ok((select access_active from public.list_my_access_grants()) is false, 'a suspended viewer''s grant is listed as not active');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :R;

-- ------------------------------------------------------------- expiry ----------
select t.as_user(:P);
insert into t.vars select 'code3', code from public.create_share_code('{1}', false);
select t.as_admin();
update public.share_codes set expires_at = now() - interval '1 minute' where participant_id = :P and redeemed_at is null;
select t.as_user(:R);
select t.ok((public.redeem_share_code((select v from t.vars where k = 'code3')) ->> 'reason') = 'invalid_or_expired', 'an expired code is refused');

-- ------------------------------------------------------------- rate limit ------
select t.as_user(:P);
insert into t.vars select 'code4', code from public.create_share_code('{1}', false);
select t.as_user(:C);
select public.redeem_share_code('ZZZZZ-ZZZZ' || n) from generate_series(2, 9) n;  -- 8 more failures
select public.redeem_share_code('ZZZZZ-ZZZZZ');
select public.redeem_share_code('ZZZZZ-ZZZZY');
select t.ok((public.redeem_share_code((select v from t.vars where k = 'code4')) ->> 'reason') = 'rate_limited',
  'after 10 failures in an hour even a valid code is refused');

-- ------------------------------------------------------------- anon ------------
select t.as_admin();
set local role anon;
select t.ok(t.err($$select public.list_shared_participants()$$) = '42501', 'anon cannot call the sharing RPCs');
select t.ok(t.err($$select public.redeem_share_code('AAAAA-AAAAA')$$) = '42501', 'anon cannot redeem');

rollback;
