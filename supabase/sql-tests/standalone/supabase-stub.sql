-- Minimal stand-in for the parts of a Supabase database the migrations use, so they
-- and the RLS tests can run on a plain local Postgres (no Docker). Not a full copy:
-- just the roles and their default privileges, auth.users/identities/sessions/
-- refresh_tokens + auth.uid(), storage.buckets/objects/foldername,
-- realtime.messages + realtime.topic(), and the supabase_realtime publication.
-- Run by supabase/sql-tests/standalone/run.sh before the migrations.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default privileges for what postgres creates in public: API roles get
-- table/sequence/function access; RLS decides rows. (On top of Postgres' own
-- built-in default: EXECUTE on every new function for PUBLIC.)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- pgcrypto lives in "extensions" on Supabase; the admin snippets call it there.
create schema extensions;
create extension pgcrypto schema extensions;

-- The columns the admin snippets (supabase/admin/*.sql) write, as on Supabase.
create table auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change text, email_change_token_new text,
  email_change_token_current text, phone_change text, phone_change_token text, reauthentication_token text
);

create table auth.identities (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null,
  provider text not null,
  identity_data jsonb not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

-- Signed-in sessions and their refresh tokens (the admin snippets end sessions).
-- As on Supabase: deleting a session deletes its refresh tokens; user_id on
-- refresh_tokens is varchar.
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  not_after timestamptz
);

create table auth.refresh_tokens (
  id bigserial primary key,
  token varchar(255) unique,
  user_id varchar(255),
  revoked boolean,
  parent varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- PostgREST puts the JWT claims in request.jwt.claims; auth.uid() reads "sub".
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;

-- Folder segments of an object path ('a/b/c.bin' -> {a,b}), as in Supabase.
create function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Realtime Authorization: when a client joins or sends on a private channel, the
-- Realtime server sets role + request.jwt.claims + realtime.topic in a transaction,
-- then probes this table under RLS (SELECT = may receive, INSERT = may send) and
-- rolls back. The real table is partitioned by day; a plain table is enough here.
create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table realtime.messages (
  id uuid not null default gen_random_uuid(),
  topic text not null,
  extension text not null,          -- 'broadcast' | 'presence'
  event text,
  payload jsonb,
  private boolean default false,
  updated_at timestamp not null default now(),
  inserted_at timestamp not null default now(),
  primary key (id, inserted_at)
);
alter table realtime.messages enable row level security;
grant select, insert, update on realtime.messages to anon, authenticated, service_role;

-- The channel topic being authorised, as on Supabase ('live:...', no 'realtime:' prefix).
create function realtime.topic() returns text
language sql stable
as $$
  select nullif(current_setting('realtime.topic', true), '')::text;
$$;
grant execute on function realtime.topic() to anon, authenticated, service_role;

-- Every Supabase project has this (empty) publication; Realtime streams
-- postgres_changes for the tables in it. (CREATE PUBLICATION warns that
-- wal_level isn't 'logical' here; harmless, nothing replicates.)
set client_min_messages = error;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
reset client_min_messages;
