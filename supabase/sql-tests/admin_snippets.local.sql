-- Runs the owner-facing snippets in supabase/admin/ exactly as written (with their
-- placeholder email) against the local stub, and checks what they did.
-- No transaction: create-viewer's duplicate guard is meant to raise.

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

\ir ../admin/create-viewer.sql
select pg_temp.ok((select p.account_role = 'researcher' and p.account_status = 'active' and p.display_name = 'Dr Name'
                     from public.profiles p join auth.users u on u.id = p.id where u.email = 'dr.name@example.org'),
  'create-viewer makes an active researcher with the given name');
select pg_temp.ok((select u.encrypted_password = extensions.crypt(n.one_time_password, u.encrypted_password)
                     from auth.users u, pg_temp.new_viewer n where u.email = n.email),
  'the one-time password it shows is the one stored');
select pg_temp.ok((select u.email_confirmed_at is not null and exists (select 1 from auth.identities i where i.user_id = u.id)
                     from auth.users u where u.email = 'dr.name@example.org'),
  'the account is confirmed and has an email identity');

\echo '(expected: an "already has an account" error next)'
\set ON_ERROR_STOP off
\ir ../admin/create-viewer.sql
\set ON_ERROR_STOP on
select pg_temp.ok((select count(*) = 1 from auth.users where email = 'dr.name@example.org'), 'running it twice creates nothing new');

update public.profiles set account_role = 'participant'
 where id = (select id from auth.users where email = 'dr.name@example.org');
\ir ../admin/set-role.sql
select pg_temp.ok((select p.account_role = 'researcher' from public.profiles p join auth.users u on u.id = p.id
                    where u.email = 'dr.name@example.org'), 'set-role promotes an existing account');

\ir ../admin/set-status.sql
select pg_temp.ok((select p.account_status = 'suspended' from public.profiles p join auth.users u on u.id = p.id
                    where u.email = 'dr.name@example.org'), 'set-status suspends');

create temp table old_hash as select encrypted_password from auth.users where email = 'dr.name@example.org';
\ir ../admin/reset-password.sql
select pg_temp.ok((select u.encrypted_password <> o.encrypted_password
                          and u.encrypted_password = extensions.crypt(r.one_time_password, u.encrypted_password)
                     from auth.users u, pg_temp.old_hash o, pg_temp.pw_reset r where u.email = r.email),
  'reset-password stores the new one-time password it shows');

\ir ../admin/overview.sql
select pg_temp.ok(true, 'overview runs');
