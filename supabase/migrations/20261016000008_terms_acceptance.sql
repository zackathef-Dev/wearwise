-- WearWise: which version of the terms each account accepted.
--
-- The terms of use, privacy policy, collection notice and research information
-- (packages/legal, ACCEPTANCE_VERSION) are accepted at sign-up, and again after they
-- change. The record is the version (its effective date, YYYY-MM-DD) and when it was
-- accepted, kept like consent: server-side, not client-writable.
--
--   1. profiles.terms_version / terms_accepted_at.
--   2. New sign-ups must carry `terms_version` in their metadata (the profile trigger
--      refuses them otherwise, as it does without consent or the 18+ declaration).
--   3. public.accept_terms(version): the signed-in account accepts a version (after a
--      change, or for accounts made before this migration). A version can only move
--      forward, so a stale client can't roll an acceptance back.
--   4. Acceptances made before this migration reached the server (recorded only in
--      the account metadata by the app) are carried over.
-- Not an upload gate: consent to store readings (consent_recorded_at) and the 18+
-- declaration already gate that; the apps ask for the current terms before use.

alter table public.profiles add column terms_version text
  check (terms_version is null or terms_version ~ '^\d{4}-\d{2}-\d{2}$');
alter table public.profiles add column terms_accepted_at timestamptz;

comment on column public.profiles.terms_version is
  'The version (effective date) of the terms, privacy policy, collection notice and research information this account last accepted.';

-- ------------------------------------------------------------- 2. sign-up gate ---
create or replace function public.tg_create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  consent_at timestamptz;
  adult_at timestamptz;
  terms text;
begin
  consent_at := (new.raw_user_meta_data ->> 'consent_recorded_at')::timestamptz;
  if consent_at is null then
    raise exception 'sign-up rejected: consent_recorded_at missing from user metadata';
  end if;
  adult_at := (new.raw_user_meta_data ->> 'adult_confirmed_at')::timestamptz;
  if adult_at is null then
    raise exception 'sign-up rejected: adult_confirmed_at missing from user metadata (WearWise accounts are for people 18 or older)';
  end if;
  terms := new.raw_user_meta_data ->> 'terms_version';
  if terms is null or terms !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'sign-up rejected: terms_version missing from user metadata (the terms must be accepted)';
  end if;

  insert into public.profiles (id, display_name, consent_recorded_at, adult_confirmed_at, terms_version, terms_accepted_at)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), consent_at, adult_at, terms, consent_at);
  return new;
end;
$$;

-- ------------------------------------------------------------- 3. accept_terms ---
create or replace function public.accept_terms(p_version text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_version is null or p_version !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'accept_terms: version must look like YYYY-MM-DD' using errcode = '22023';
  end if;
  update public.profiles
     set terms_version = p_version, terms_accepted_at = now()
   where id = (select auth.uid())
     and (terms_version is null or terms_version < p_version)
  returning terms_version into v;
  if v is null then
    select terms_version into v from public.profiles where id = (select auth.uid());
  end if;
  return v;
end;
$$;

revoke all on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- ------------------------------------------------------------- 4. carry-over -----
-- The time recorded is the server's: the metadata's terms_accepted_at is
-- client-chosen. 20261016000009 also limits this to versions the server knows.
create or replace function private.carry_over_terms_acceptances()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with done as (
    update public.profiles p
       set terms_version = u.raw_user_meta_data ->> 'terms_version',
           terms_accepted_at = now()
      from auth.users u
     where u.id = p.id
       and p.terms_version is null
       and (u.raw_user_meta_data ->> 'terms_version') ~ '^\d{4}-\d{2}-\d{2}$'
    returning 1
  )
  select count(*)::integer from done;
$$;

revoke all on function private.carry_over_terms_acceptances() from public, anon, authenticated;

select private.carry_over_terms_acceptances();
