-- WearWise admin: change what an existing account is.
--   'researcher' / 'clinician'  → can sign in to the viewer dashboard
--   'participant'               → back to a normal app user (loses dashboard access at once)
--
-- Supabase Dashboard → SQL Editor → paste → change the two values → Run.
-- A participant who becomes a viewer keeps their own recordings, but can't make
-- share codes any more; give viewers their own separate email where possible.
--
-- Only an account whose email address is confirmed can be changed: an unconfirmed
-- sign-up could have been made by anyone who typed that address. Every signed-in
-- session of the account is ended, so the person signs in again under the new role.

with target as (
  select u.id, u.email
    from auth.users u
   where lower(u.email) = lower(trim('dr.name@example.org'))   -- <-- CHANGE: their email
     and u.email_confirmed_at is not null
), changed as (
  update public.profiles p
     set account_role = 'researcher'                           -- <-- CHANGE: 'researcher', 'clinician' or 'participant'
    from target t
   where p.id = t.id
  returning p.id, t.email, p.display_name, p.account_role, p.account_status
), signed_out as (
  delete from auth.sessions s
   using changed c
   where s.user_id = c.id
  returning s.user_id
)
select c.email, c.display_name, c.account_role, c.account_status,
       (select count(*) from signed_out) as sessions_ended
  from changed c;
-- No rows returned = no account with that email, or its email isn't confirmed yet
-- (nothing was changed).
