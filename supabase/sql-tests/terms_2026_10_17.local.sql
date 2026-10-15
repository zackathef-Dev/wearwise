-- Terms version 2026-10-17 (migration 20261017000011). Plain SQL, run by
-- supabase/sql-tests/standalone/run.sh. One transaction, rolled back.

\set A '''00000000-0000-0000-0000-0000000000d1'''

begin;

create schema t;
grant usage on schema t to authenticated;
create function t.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;
create function t.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on all functions in schema t to authenticated;

select t.ok(exists (select 1 from private.terms_versions where version = '2026-10-17'), '2026-10-17 is a known version');

insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Ada"}');

select t.as_user(:A);
select t.ok(public.accept_terms('2026-10-17') = '2026-10-17', 'an account on 2026-10-16 accepts 2026-10-17');
select t.ok(public.accept_terms('2026-10-16') = '2026-10-17', 'and can''t move back to 2026-10-16');

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d2', 'b@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-17","display_name":"Bo"}');
select t.ok((select terms_version from public.profiles where id = '00000000-0000-0000-0000-0000000000d2') = '2026-10-17',
  'a sign-up at 2026-10-17 is recorded');

rollback;
