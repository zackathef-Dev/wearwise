-- Terms acceptance (migration 20261016000008). Plain SQL, no pgTAP, run by
-- supabase/sql-tests/standalone/run.sh. One transaction, rolled back.

\set T '''00000000-0000-0000-0000-0000000000a7'''

begin;

create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

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

grant execute on all functions in schema t to authenticated, anon;

-- ------------------------------------------------------------- sign-up --------
select t.ok(t.err($q$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e9', 'x@test.wearwise.io',
  '{"consent_recorded_at":"2026-10-16T00:00:00Z","adult_confirmed_at":"2026-10-16T00:00:00Z"}')$q$) like '%terms_version missing%',
  'a sign-up that did not accept the terms is refused');
select t.ok(t.err($q$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e9', 'x@test.wearwise.io',
  '{"consent_recorded_at":"2026-10-16T00:00:00Z","adult_confirmed_at":"2026-10-16T00:00:00Z","terms_version":"latest"}')$q$) like '%terms_version missing%',
  'and so is one with a version that isn''t a date');

insert into auth.users (id, email, raw_user_meta_data) values
  (:T, 't@test.wearwise.io', '{"consent_recorded_at":"2026-10-16T01:02:03Z","adult_confirmed_at":"2026-10-16T01:02:03Z","terms_version":"2026-10-16","display_name":"Tam"}');
select t.ok((select terms_version = '2026-10-16' and terms_accepted_at = now() from public.profiles where id = :T),
  'the accepted version is recorded with the sign-up, at the server''s time (20261016000009)');

-- ------------------------------------------------------------- accept_terms ----
-- A later version only exists once the server lists it (private.terms_versions).
insert into private.terms_versions (version) values ('2027-01-01');
select t.as_user(:T);
select t.ok(public.accept_terms('2027-01-01') = '2027-01-01', 'accepting a newer version records it');
select t.ok(public.accept_terms('2026-10-16') = '2027-01-01', 'an older version never rolls the acceptance back');
select t.ok(t.err($q$select public.accept_terms('soon')$q$) = '22023', 'a malformed version is refused');
select t.ok(t.err($q$update public.profiles set terms_version = '2099-01-01' where id = auth.uid()$q$) = '42501',
  'the columns cannot be written directly');
reset role;

set local role anon;
select t.ok(t.err($q$select public.accept_terms('2027-01-01')$q$) = '42501', 'anon cannot accept terms');
reset role;

-- ------------------------------------------------------------- carry-over ------
update public.profiles set terms_version = null, terms_accepted_at = null where id = :T;
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"terms_version":"2026-10-16","terms_accepted_at":"2026-10-14T09:00:00Z"}' where id = :T;
select t.ok(private.carry_over_terms_acceptances() = 1, 'acceptances recorded only in account metadata are carried over');
select t.ok((select terms_accepted_at from public.profiles where id = :T) = now(),
  'stamped with the server''s time (the metadata value is client-chosen)');
select t.ok(private.carry_over_terms_acceptances() = 0, 'running it again changes nothing');

rollback;
