-- WearWise admin: read-only overview. Changes nothing.
-- Supabase Dashboard → SQL Editor → paste → Run. There are two queries, and the SQL Editor
-- shows only the result of the last one (2. who shares with whom). To see list 1, select
-- its lines and click "Run selected".

-- 1. Every researcher and clinician, and how many participants share with them now.
select u.email, p.display_name, p.account_role, p.account_status, p.created_at::date as created,
       (select count(*) from public.access_grants g
         where g.grantee_id = p.id and g.revoked_at is null) as participants_sharing
  from public.profiles p
  join auth.users u on u.id = p.id
 where p.account_role in ('researcher', 'clinician')
 order by p.account_role, u.email;

-- 2. Who shares what with whom (live grants; add "or true" to the where clause to
--    include ended ones). Sensor codes: 1 ECG, 2 SpO2, 3 temperature, 4 heart
--    rate, 5 movement, 6 pulse wave.
select pu.email as participant, vu.email as viewer, g.sensor_types, g.include_falls,
       g.created_at::date as since, g.revoked_at
  from public.access_grants g
  join auth.users pu on pu.id = g.participant_id
  join auth.users vu on vu.id = g.grantee_id
 where g.revoked_at is null
 order by pu.email, vu.email;
