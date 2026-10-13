-- WearWise: accounts are for adults (18 or older).
--
-- WearWise is a research proof of concept that collects health information. The
-- study takes adults only: that is what an ethics committee normally approves, and
-- it avoids parental consent for minors (NHMRC National Statement; the Privacy Act's
-- consent rules for sensitive information; the OAIC Children's Online Privacy Code).
--
-- The person declares it at sign-up ("I'm 18 or older"), recorded like consent: a
-- server-side timestamp no client can rewrite (profiles' only client-writable column
-- stays display_name, see 20261013000004).
--
--   1. profiles.adult_confirmed_at: when the account confirmed it is 18 or older.
--   2. New sign-ups without `adult_confirmed_at` in their metadata are refused by the
--      profile trigger, exactly as sign-ups without consent already are.
--   3. Accounts made before this migration have it null. They confirm once in the app
--      or the dashboard (public.confirm_adult()). Until they do, account_is_active()
--      is false: they can still read and delete their own data, but upload nothing and
--      broadcast no live view. Sharing is judged by account_status, as before
--      (private.my_live_grants), so what they already shared stays visible.

-- ------------------------------------------------------------- 1. column ---------
alter table public.profiles add column adult_confirmed_at timestamptz;

-- Confirmations made before this migration reached the server: the app and the
-- dashboard also record the declaration in the account's metadata, and fall back to
-- that alone while the server has no confirm_adult(). Carry those over, so nobody who
-- already answered is asked again or has uploads refused. Only well-formed timestamps
-- count (the metadata is client-written); anything else confirms again in the app.
-- The time recorded is the server's, since the metadata value is client-chosen
-- (security review, 20261016000009).
create or replace function private.carry_over_adult_confirmations()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with done as (
    update public.profiles p
       set adult_confirmed_at = now()
      from auth.users u
     where u.id = p.id
       and p.adult_confirmed_at is null
       and (u.raw_user_meta_data ->> 'adult_confirmed_at') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
    returning 1
  )
  select count(*)::integer from done;
$$;

revoke all on function private.carry_over_adult_confirmations() from public, anon, authenticated;

select private.carry_over_adult_confirmations();

comment on column public.profiles.adult_confirmed_at is
  'When the account declared it is 18 or older (sign-up, or confirm_adult() for accounts made before 2026-10-16). Null = not yet confirmed: no uploads.';

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
begin
  consent_at := (new.raw_user_meta_data ->> 'consent_recorded_at')::timestamptz;
  if consent_at is null then
    raise exception 'sign-up rejected: consent_recorded_at missing from user metadata';
  end if;
  adult_at := (new.raw_user_meta_data ->> 'adult_confirmed_at')::timestamptz;
  if adult_at is null then
    raise exception 'sign-up rejected: adult_confirmed_at missing from user metadata (WearWise accounts are for people 18 or older)';
  end if;

  insert into public.profiles (id, display_name, consent_recorded_at, adult_confirmed_at)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), consent_at, adult_at);
  return new;
end;
$$;

-- ------------------------------------------------------------- 3. existing accounts
-- The caller confirms they are 18 or older. Idempotent: the first confirmation is
-- the record, later calls return it unchanged.
create or replace function public.confirm_adult()
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles
     set adult_confirmed_at = coalesce(adult_confirmed_at, now())
   where id = (select auth.uid())
  returning adult_confirmed_at;
$$;

revoke all on function public.confirm_adult() from public, anon;
grant execute on function public.confirm_adult() to authenticated;

-- Writes need an active account that has confirmed its age. Every RESTRICTIVE write
-- policy and can_send_live() already go through this one function.
create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.account_status = 'active' and p.adult_confirmed_at is not null
  );
$$;

comment on function public.account_is_active() is
  'True when the calling user''s profile is active and has confirmed it is 18 or older. Used by RESTRICTIVE write policies.';
