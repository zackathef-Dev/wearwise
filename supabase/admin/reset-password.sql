-- WearWise admin: give a viewer a new one-time password (when they're locked out
-- and the "Forgot password?" email can't reach them).
--
-- Supabase Dashboard → SQL Editor → paste → change the email → Run.
-- Give them the password privately; they replace it with top bar → Change password.
--
-- Every signed-in session of the account is ended too (deleting auth.sessions also
-- deletes their refresh tokens), so whoever had the old password can't keep using
-- it. An access token already handed out stays valid until it expires (at most the
-- project's JWT expiry, 1 hour by default).

drop table if exists pg_temp.pw_reset;
create temp table pw_reset as
select lower(trim('dr.name@example.org')) as email,   -- <-- CHANGE: their email
       translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_') as one_time_password;

with changed as (
  update auth.users u
     set encrypted_password = extensions.crypt(r.one_time_password, extensions.gen_salt('bf')),
         updated_at = now()
    from pg_temp.pw_reset r
   where lower(u.email) = r.email
  returning u.id
)
delete from auth.sessions s
 using changed c
 where s.user_id = c.id;

select r.email, r.one_time_password,
       exists (select 1 from auth.users u where lower(u.email) = r.email) as account_found
  from pg_temp.pw_reset r;
-- account_found = false: no account with that email, nothing changed.
