-- WearWise admin: suspend or reactivate an account (viewer or participant).
--   'suspended' → a viewer sees nothing in the dashboard; a participant's shared data
--                 is hidden from every viewer. Nothing is deleted, and access grants
--                 come back if the account is reactivated. Every signed-in session
--                 of the account is ended as well.
--   'active'    → normal again.
--
-- Supabase Dashboard → SQL Editor → paste → change the two values → Run.

with changed as (
  update public.profiles p
     set account_status = 'suspended'                        -- <-- CHANGE: 'suspended' or 'active'
    from auth.users u
   where u.id = p.id
     and lower(u.email) = lower(trim('dr.name@example.org'))   -- <-- CHANGE: their email
  returning p.id, u.email, p.display_name, p.account_role, p.account_status
), signed_out as (
  delete from auth.sessions s
   using changed c
   where s.user_id = c.id
     and c.account_status <> 'active'
  returning s.user_id
)
select c.email, c.display_name, c.account_role, c.account_status,
       (select count(*) from signed_out) as sessions_ended
  from changed c;
-- No rows returned = no account with that email.
