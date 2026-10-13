-- WearWise LOCAL DEVELOPMENT seed. Synthetic data only.
--
-- Runs automatically after the migrations on `supabase start` (first time) and on every
-- `supabase db reset`. It is never applied to a hosted project unless someone runs
-- `supabase db push --include-seed` on purpose, and it refuses to run on a database that
-- already holds any account outside @example.invalid (see the guard below).
--
-- What it creates (all passwords: wearwise-demo-only — LOCAL USE ONLY, never reuse it):
--
--   demo.participant@example.invalid  participant  "Demo Participant"  — shares everything with the researcher
--   demo.other@example.invalid        participant  "Other Participant" — shares nothing (for isolation checks)
--   demo.researcher@example.invalid   researcher   "Demo Researcher"   — signs in to the web dashboard
--
-- plus an access grant (participant → researcher). The simulated recordings, their alerts and
-- the possible-fall event are in seed/demo-recordings.sql, generated with their Storage files
-- by scripts/generate-demo-recordings.mjs. Every health value in this seed is SIMULATED:
-- sessions carry simulated = true and the device name "Simulated Patch (demo seed)".
--
-- .invalid is a reserved top-level domain (RFC 2606): these addresses can never receive mail.

do $$
begin
  if exists (select 1 from auth.users where email not like '%@example.invalid') then
    raise exception 'seed.sql: this database already has real accounts. The demo seed is for a fresh LOCAL database only.';
  end if;
end $$;

-- Accounts. Inserted the way supabase/scripts/admin.mjs creates a viewer: the sign-up trigger
-- (public.tg_create_profile_for_new_user) runs as for a real sign-up, so the metadata must
-- declare consent, 18+ and a terms version the server knows.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('wearwise-demo-only', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.name, 'consent_recorded_at', now(), 'adult_confirmed_at', now(),
                     'terms_version', (select max(t.version) from private.terms_versions t),
                     'terms_accepted_at', now()),
  now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('0d3e0000-0000-4000-8000-000000000001'::uuid, 'demo.participant@example.invalid', 'Demo Participant'),
  ('0d3e0000-0000-4000-8000-000000000002'::uuid, 'demo.other@example.invalid',       'Other Participant'),
  ('0d3e0000-0000-4000-8000-000000000003'::uuid, 'demo.researcher@example.invalid',  'Demo Researcher')
) as u(id, email, name);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u
where u.email like '%@example.invalid';

-- Roles are server-controlled: only an administrator (this seed, admin SQL, admin.mjs) sets one.
update public.profiles set account_role = 'researcher'
where id = '0d3e0000-0000-4000-8000-000000000003';

-- The participant shares every signal and falls with the researcher, as if they had created a
-- share code in the app and the researcher had redeemed it in the dashboard.
insert into public.access_grants (id, participant_id, grantee_id, sensor_types, include_falls)
values ('0d3e0000-0000-4000-8000-0000000000a1',
        '0d3e0000-0000-4000-8000-000000000001', '0d3e0000-0000-4000-8000-000000000003',
        array[1, 2, 3, 4, 5, 6]::smallint[], true);
