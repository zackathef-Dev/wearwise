-- RLS tests for public.profiles, written for pgTAP (supabase test db runs these).
--
-- Two participants are simulated by switching the request JWT claims, which is
-- exactly how PostgREST resolves auth.uid(). Run with:
--
--   supabase test db
--
-- Requires a local stack (Docker) or a test project. These tests are the
-- executable form of build-instruction §18: two accounts, strict isolation.

begin;
select plan(8);

-- Two fake authenticated users. The trigger path is exercised separately below;
-- here we insert profiles directly as the table owner to arrange state.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.wearwise.io',
   '{"consent_recorded_at":"2026-08-26T00:00:00Z","adult_confirmed_at":"2026-08-26T00:00:00Z","terms_version":"2026-10-16", "display_name": "A"}'::jsonb),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.wearwise.io',
   '{"consent_recorded_at":"2026-08-26T00:00:00Z","adult_confirmed_at":"2026-08-26T00:00:00Z","terms_version":"2026-10-16", "display_name": "B"}'::jsonb);

-- 1. the sign-up trigger created both profiles
select is(
  (select count(*)::int from public.profiles
   where id in ('00000000-0000-0000-0000-00000000000a',
                '00000000-0000-0000-0000-00000000000b')),
  2, 'trigger creates a profile per new auth user');

-- 2. sign-up without consent metadata is rejected
select throws_like(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     values ('00000000-0000-0000-0000-00000000000c', 'c@test.wearwise.io', '{}'::jsonb) $$,
  '%consent_recorded_at missing%',
  'sign-up without consent fails loudly');

-- Act as participant A --------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

-- 3. A sees exactly one profile: their own
select is((select count(*)::int from public.profiles), 1, 'A sees only their own profile');
select is((select display_name from public.profiles), 'A', 'and it is theirs');

-- 4. A can rename themselves
update public.profiles set display_name = 'Alice';
select is((select display_name from public.profiles), 'Alice', 'A can rename themselves');

-- 5. A cannot promote themselves — only display_name is updatable (column privileges,
--    20261013000004; the policy no longer pins the role, 20261016000009)
select throws_like(
  $$ update public.profiles set account_role = 'researcher' $$,
  '%permission denied%',
  'A cannot set their role to researcher');

-- 6. A cannot touch B's row: with RLS the row is simply not visible to UPDATE,
--    so the statement affects zero rows rather than erroring.
update public.profiles set display_name = 'hacked'
  where id = '00000000-0000-0000-0000-00000000000b';
reset role;
select is(
  (select display_name from public.profiles
   where id = '00000000-0000-0000-0000-00000000000b'),
  'B', 'A''s update against B''s row changed nothing');

-- 7. B, in turn, sees only their own row
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select is((select count(*)::int from public.profiles), 1, 'B sees only their own profile');

reset role;
select * from finish();
rollback;
