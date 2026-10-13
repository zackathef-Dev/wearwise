-- Adults-only accounts (migration 20261016000007). Plain SQL, no pgTAP, run by
-- supabase/sql-tests/standalone/run.sh. One transaction, rolled back.
--
-- Cast: A signs up declaring 18+; L is an account from before the migration
-- (adult_confirmed_at null), made by clearing the column as the superuser.

\set A '''00000000-0000-0000-0000-0000000000d1'''
\set L '''00000000-0000-0000-0000-0000000000d2'''

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

-- ------------------------------------------------------------- sign-up --------
select t.ok(t.err($q$insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'kid@test.wearwise.io', '{"consent_recorded_at":"2026-10-16T00:00:00Z","display_name":"Kid"}')$q$)
  like '%adult_confirmed_at missing%', 'a sign-up without the 18+ declaration is refused');
select t.ok(not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000e1'),
  'and no profile is created for it');
select t.ok(t.err($q$insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e2', 'x@test.wearwise.io', '{"adult_confirmed_at":"2026-10-16T00:00:00Z","terms_version":"2026-10-16"}')$q$)
  like '%consent_recorded_at missing%', 'consent is still required as well');

insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@test.wearwise.io', '{"consent_recorded_at":"2026-10-16T00:00:00Z","adult_confirmed_at":"2026-10-16T00:00:01Z","terms_version":"2026-10-16","display_name":"Ada"}'),
  (:L, 'l@test.wearwise.io', '{"consent_recorded_at":"2026-08-01T00:00:00Z","adult_confirmed_at":"2026-08-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Lee"}');
select t.ok((select adult_confirmed_at from public.profiles where id = :A) = now(),
  'a sign-up with it records the server''s time of the confirmation (20261016000009)');

-- L stands for an account made before the migration. A's confirmation is moved to
-- a fixed earlier time, so later checks can tell whether anything rewrote it.
update public.profiles set adult_confirmed_at = null where id = :L;
update public.profiles set adult_confirmed_at = '2026-10-16T00:00:01Z' where id = :A;

-- ------------------------------------------------------------- writes ---------
select t.as_user(:A);
select t.ok(public.account_is_active(), 'a confirmed adult account is active');
select t.ok(t.err($q$insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot)
  values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'd', now(), 'complete', 'ble', 'ble', '{}')$q$) is null,
  'and can upload a session');

select t.as_admin(); select t.as_user(:L);
select t.ok(not public.account_is_active(), 'an account that has not confirmed 18+ is not active for writing');
select t.ok(t.err($q$insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot)
  values ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', 'd', now(), 'complete', 'ble', 'ble', '{}')$q$) = '42501',
  'so its uploads are refused');
select t.ok((select count(*) from public.profiles where id = :L) = 1, 'but it can still read its own profile');

-- ------------------------------------------------------------- confirm_adult ---
select t.ok(t.err('update public.profiles set adult_confirmed_at = now() where id = auth.uid()') = '42501',
  'the column cannot be written directly (only display_name can)');
select t.ok(public.confirm_adult() is not null, 'confirm_adult() records the confirmation');
select t.ok(public.account_is_active(), 'after which the account can write');
select t.ok(t.err($q$insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot)
  values ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d2', 'd', now(), 'complete', 'ble', 'ble', '{}')$q$) is null,
  'and upload');

select t.as_admin();
select set_config('t.first_confirm', (select adult_confirmed_at::text from public.profiles where id = :L), true);
select t.as_user(:L);
select t.ok(public.confirm_adult() = current_setting('t.first_confirm')::timestamptz, 'calling it again keeps the first confirmation');

select t.as_admin();
select t.ok((select adult_confirmed_at from public.profiles where id = :A) = '2026-10-16T00:00:01Z', 'it never touches anyone else''s row');

-- ------------------------------------------------------------- carry-over -----
-- An account that confirmed in the app before the migration reached the server has
-- the declaration only in its metadata; a malformed value is not trusted.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'm@test.wearwise.io', '{"consent_recorded_at":"2026-09-20T00:00:00Z","adult_confirmed_at":"2026-10-13T04:58:17.319Z","terms_version":"2026-10-16","display_name":"Mo"}'),
  ('00000000-0000-0000-0000-0000000000f2', 'n@test.wearwise.io', '{"consent_recorded_at":"2026-09-20T00:00:00Z","adult_confirmed_at":"2026-10-13T00:00:00Z","terms_version":"2026-10-16","display_name":"Ned"}');
update public.profiles set adult_confirmed_at = null where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2');
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"adult_confirmed_at":"yes","terms_version":"2026-10-16"}' where id = '00000000-0000-0000-0000-0000000000f2';
select t.ok(private.carry_over_adult_confirmations() = 1, 'confirmations recorded only in account metadata are carried over');
select t.ok((select adult_confirmed_at from public.profiles where id = '00000000-0000-0000-0000-0000000000f1') = now(),
  'stamped with the server''s time (the metadata value is client-chosen)');
select t.ok((select adult_confirmed_at from public.profiles where id = '00000000-0000-0000-0000-0000000000f2') is null,
  'a malformed value is not trusted');
select t.ok(private.carry_over_adult_confirmations() = 0, 'running it again changes nothing');
set local role authenticated;
select t.ok(t.err('select private.carry_over_adult_confirmations()') = '42501', 'clients cannot run the carry-over');
reset role;

set local role anon;
select t.ok(t.err('select public.confirm_adult()') = '42501', 'anon cannot call confirm_adult()');
reset role;

rollback;
