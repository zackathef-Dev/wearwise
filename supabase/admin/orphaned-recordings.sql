-- WearWise admin: recordings left in Storage by accounts that no longer exist.
-- Read-only. Supabase Dashboard → SQL Editor → paste → Run.
--
-- Deleting a user (Authentication → Users, or SQL) deletes every row they own, but
-- not their files in the 'recordings' bucket: those live in Storage under a folder
-- named after the user id. `node supabase/scripts/admin.mjs delete-account <email>`
-- removes the files first; this finds any left behind by other routes.
--
-- One row per folder whose name is not an existing user id. To remove one:
-- Dashboard → Storage → recordings → tick the folder → Delete. (Deleting rows from
-- storage.objects in SQL would leave the files themselves behind.)

select split_part(o.name, '/', 1)                                   as folder,
       count(*)                                                     as objects,
       pg_size_pretty(coalesce(sum((o.metadata ->> 'size')::bigint), 0)) as size,
       min(o.created_at)::date                                      as oldest,
       max(o.created_at)::date                                      as newest
  from storage.objects o
 where o.bucket_id = 'recordings'
   and not exists (select 1 from auth.users u where u.id::text = split_part(o.name, '/', 1))
 group by 1
 order by 1;
