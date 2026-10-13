-- WearWise: participant profiles.
--
-- One row per auth.users row. The profile is the only place the app writes
-- account-level facts; auth.users itself is never touched by the client.
--
-- account_role is SERVER-CONTROLLED: participants must not be able to promote
-- themselves to researcher later (build instruction §16). The column exists now so
-- the researcher phase is an ALTER POLICY away, but no client-reachable path can
-- set it — see the trigger and the UPDATE policy's WITH CHECK below.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  account_role text not null default 'participant'
    check (account_role in ('participant', 'researcher')),
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'deletion_requested')),
  -- Explicit storage consent, recorded at registration. Non-null is a hard gate:
  -- the client cannot insert profiles (see policies), and the trigger only fires
  -- from a sign-up whose metadata carries consent.
  consent_recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One per participant. Created by trigger on auth.users; clients can read and rename themselves, nothing else.';

-- updated_at maintenance ---------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Profile creation ---------------------------------------------------------------
-- The row is created server-side when the auth user is created. The consent
-- timestamp comes from raw_user_meta_data captured at sign-up; a sign-up without
-- consent metadata fails loudly rather than creating an unconsented profile.
create or replace function public.tg_create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  consent_at timestamptz;
begin
  consent_at := (new.raw_user_meta_data ->> 'consent_recorded_at')::timestamptz;
  if consent_at is null then
    raise exception 'sign-up rejected: consent_recorded_at missing from user metadata';
  end if;

  insert into public.profiles (id, display_name, consent_recorded_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    consent_at
  );
  return new;
end;
$$;

create trigger create_profile_after_signup
  after insert on auth.users
  for each row execute function public.tg_create_profile_for_new_user();

-- Row Level Security -------------------------------------------------------------
alter table public.profiles enable row level security;

-- SELECT: yourself only.
create policy "profiles: participants read their own row"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- UPDATE: yourself only, and the WITH CHECK pins every server-controlled column.
-- display_name is the only client-writable field; a payload that changes role,
-- status or consent fails the check even though the row is the user's own.
create policy "profiles: participants rename themselves only"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and account_role = 'participant'
    and account_status = 'active'
  );

-- No INSERT policy: creation is the trigger's job (security definer).
-- No DELETE policy: account deletion is a server-side, audited flow (later
-- milestone), never a bare row delete from a phone.
