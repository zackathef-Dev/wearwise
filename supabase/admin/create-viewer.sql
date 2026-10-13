-- WearWise admin: create a researcher or clinician account for the viewer dashboard.
--
-- Supabase Dashboard → SQL Editor → New query → paste this whole file →
-- change the three values marked  <-- CHANGE  → Run.
-- The result shows a one-time password. Give it to the person privately (not in
-- the same email as the address); they replace it in the dashboard with
-- top bar → Change password.
--
-- Use an email that is NOT already a participant account: one account can't share
-- data with itself. If the address already has an account, this stops with an
-- error and changes nothing — use set-role.sql to promote that account instead.

drop table if exists pg_temp.new_viewer;
create temp table new_viewer as
select lower(trim('dr.name@example.org')) as email,      -- <-- CHANGE: their email
       'researcher'::text                 as role,       -- <-- CHANGE: 'researcher' or 'clinician'
       'Dr Name'::text                    as display_name, -- <-- CHANGE: name shown to participants
       translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_') as one_time_password;

do $$
declare
  v record;
  new_id uuid := gen_random_uuid();
begin
  select * into v from pg_temp.new_viewer;
  if v.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Not an email address: %', v.email;
  end if;
  if v.role not in ('researcher', 'clinician') then
    raise exception 'Role must be researcher or clinician, not "%"', v.role;
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v.email) then
    raise exception '% already has an account. Nothing was changed. Use set-role.sql to promote it.', v.email;
  end if;

  -- A confirmed email+password user. The profiles trigger creates their profile: it
  -- needs consent_recorded_at, adult_confirmed_at and a terms_version the server
  -- knows in the metadata, so they're set here. The terms acceptance is then
  -- cleared again: the person accepts the current terms, researcher terms included,
  -- themselves when they first sign in, not the administrator for them.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    v.email, extensions.crypt(v.one_time_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', left(v.display_name, 80), 'consent_recorded_at', now(), 'adult_confirmed_at', now(),
                       'terms_version', (select max(t.version) from private.terms_versions t)),
    now(), now(), '', '', '', '', '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), new_id, new_id::text, 'email', jsonb_build_object('sub', new_id::text, 'email', v.email), now(), now(), now());

  update public.profiles
     set account_role = v.role, terms_version = null, terms_accepted_at = null
   where id = new_id;
  update auth.users
     set raw_user_meta_data = raw_user_meta_data - 'terms_version'
   where id = new_id;
end $$;

select email, role, display_name, one_time_password from pg_temp.new_viewer;
