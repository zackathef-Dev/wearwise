-- WearWise admin: READ-ONLY schema fingerprint. Changes nothing, reads no user data.
--
-- Run it on two databases and compare the rows: if every hash matches, both have the same
-- WearWise schema (tables and columns, RLS state, policies, functions, triggers, API grants,
-- the recordings bucket, the Realtime publication and the accepted terms versions).
--   - Hosted project: Supabase Dashboard → SQL Editor → paste this file → Run.
--   - Or from the CLI: supabase login, then
--                     supabase db query --linked --project-ref <ref> -f supabase/admin/schema-fingerprint.sql
--   - Local stack:    Studio (http://127.0.0.1:54323) → SQL Editor, or
--                     supabase db query --local -f supabase/admin/schema-fingerprint.sql
-- A fresh local stack built from the migrations is the reference: docs/database.md lists
-- its values. A row that differs names the area to look at (rerun the matching part without
-- md5() to see the detail).

with
cols as (
  select string_agg(format('%s.%s.%s:%s:%s:%s', c.table_schema, c.table_name, c.column_name, c.data_type,
                           c.is_nullable, coalesce(c.column_default, '')), E'\n'
                    order by c.table_schema, c.table_name, c.ordinal_position) as s
  from information_schema.columns c
  where c.table_schema in ('public', 'private')
),
rls as (
  select string_agg(format('%s.%s:%s:%s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity), E'\n'
                    order by n.nspname, c.relname) as s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'r'
),
pol as (
  select string_agg(format('%s.%s.%s:%s:%s:%s:%s:%s', schemaname, tablename, policyname, permissive,
                           array_to_string(roles, ','), cmd, coalesce(qual, ''), coalesce(with_check, '')), E'\n'
                    order by schemaname, tablename, policyname) as s
  from pg_policies
  where schemaname in ('public', 'private')
     or (schemaname = 'storage' and policyname like 'recordings:%')
     or (schemaname = 'realtime' and (policyname like 'live:%' or policyname like 'alerts:%'))
),
fn as (
  select string_agg(format('%s.%s(%s):%s:%s:%s', n.nspname, p.proname, pg_get_function_arguments(p.oid),
                           p.prosecdef, coalesce(array_to_string(p.proconfig, ','), ''), md5(p.prosrc)), E'\n'
                    order by n.nspname, p.proname, pg_get_function_arguments(p.oid)) as s
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
),
trg as (
  select string_agg(format('%s.%s.%s:%s', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid)), E'\n'
                    order by n.nspname, c.relname, t.tgname) as s
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and (n.nspname = 'public' or (n.nspname = 'auth' and t.tgname = 'create_profile_after_signup'))
),
grt as (
  select string_agg(x, E'\n' order by x) as s from (
    select format('table %s.%s %s %s', table_schema, table_name, grantee, privilege_type) as x
      from information_schema.role_table_grants
     where table_schema in ('public', 'private') and grantee in ('anon', 'authenticated')
    union all
    select format('column %s.%s.%s %s %s', table_schema, table_name, column_name, grantee, privilege_type)
      from information_schema.column_privileges
     where table_schema in ('public', 'private') and grantee in ('anon', 'authenticated')
    union all
    select format('execute %s.%s(%s) %s', n.nspname, p.proname, pg_get_function_arguments(p.oid), r.rolname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) as r(rolname)
     where n.nspname in ('public', 'private') and has_function_privilege(r.rolname, p.oid, 'execute')
  ) g
),
bkt as (
  select string_agg(format('%s:%s:%s:%s', id, public, file_size_limit, array_to_string(allowed_mime_types, ',')), E'\n') as s
  from storage.buckets where id = 'recordings'
),
pub as (
  select format('%s:%s:%s:%s|%s', p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete,
                (select string_agg(t.schemaname || '.' || t.tablename, ',' order by t.schemaname, t.tablename)
                   from pg_publication_tables t where t.pubname = p.pubname)) as s
  from pg_publication p where p.pubname = 'supabase_realtime'
),
terms as (
  select string_agg(version, ',' order by version) as s from private.terms_versions
)
select 'columns' as area, md5(coalesce((select s from cols), '')) as fingerprint
union all select 'rls',         md5(coalesce((select s from rls), ''))
union all select 'policies',    md5(coalesce((select s from pol), ''))
union all select 'functions',   md5(coalesce((select s from fn), ''))
union all select 'triggers',    md5(coalesce((select s from trg), ''))
union all select 'grants',      md5(coalesce((select s from grt), ''))
union all select 'bucket',      md5(coalesce((select s from bkt), ''))
union all select 'realtime',    md5(coalesce((select s from pub), ''))
union all select 'terms',       coalesce((select s from terms), '(none)');
