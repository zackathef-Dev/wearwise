-- Vital alerts + live view RLS tests (migration 20261015000006). Plain SQL, no
-- pgTAP, run by supabase/sql-tests/standalone/run.sh. One transaction, rolled back.
--
-- Cast: P and Q participants, R researcher, C clinician.
-- Grants (inserted directly; the share-code flow is covered by data_sharing):
--   GPR  P -> R, ECG + heart rate      GQR  Q -> R, SpO2
-- Realtime is simulated the way the Realtime server authorises a private channel:
-- role + request.jwt.claims + realtime.topic, then a probe under RLS — SELECT a
-- message on the topic (may join/receive), INSERT one (may send).

\set P '''00000000-0000-0000-0000-0000000000a1'''
\set Q '''00000000-0000-0000-0000-0000000000a2'''
\set R '''00000000-0000-0000-0000-0000000000b1'''
\set C '''00000000-0000-0000-0000-0000000000c1'''
\set GPR '''9a000000-0000-0000-0000-000000000001'''
\set GQR '''9b000000-0000-0000-0000-000000000001'''
\set LIVE_PR '''live:9a000000-0000-0000-0000-000000000001'''
\set LIVE_QR '''live:9b000000-0000-0000-0000-000000000001'''

begin;

create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Runs a statement and returns the SQLSTATE it failed with (null if it succeeded).
create function t.err(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;

create function t.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function t.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('realtime.topic', '', true);
end $$;

-- The channel topic Realtime is authorising.
create function t.on_topic(topic text) returns void language sql as $$
  select set_config('realtime.topic', coalesce(topic, ''), true);
$$;

-- Send probe: null = allowed, else the SQLSTATE (42501 = refused by RLS).
create function t.send(ext text default 'broadcast') returns text language sql as $$
  select t.err(format('insert into realtime.messages (topic, extension, private) values (%L, %L, true)',
                      coalesce(realtime.topic(), ''), ext));
$$;

-- Receive probe: can the caller see the probe message on the current topic.
create function t.receives(ext text default 'broadcast') returns boolean language sql as $$
  select exists (select 1 from realtime.messages m where m.topic = realtime.topic() and m.extension = ext);
$$;

grant execute on all functions in schema t to authenticated, anon;

-- ------------------------------------------------------------- arrange ---------
insert into auth.users (id, email, raw_user_meta_data) values
  (:P, 'p@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Pat"}'),
  (:Q, 'q@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Quinn"}'),
  (:R, 'r@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Dr Reed"}'),
  (:C, 'c@test.wearwise.io', '{"consent_recorded_at":"2026-10-01T00:00:00Z","adult_confirmed_at":"2026-10-01T00:00:00Z","terms_version":"2026-10-16","display_name":"Dr Chen"}');
update public.profiles set account_role = 'researcher' where id = :R;
update public.profiles set account_role = 'clinician' where id = :C;

insert into public.recorded_sessions (id, user_id, device_id, started_at, status, initial_transport, final_transport, configuration_snapshot) values
  ('10000000-0000-0000-0000-000000000001', :P, 'd', now() - interval '2 hours', 'complete', 'ble', 'ble', '{}'),
  ('20000000-0000-0000-0000-000000000001', :Q, 'd', now(), 'complete', 'ble', 'ble', '{}');

insert into public.access_grants (id, participant_id, grantee_id, sensor_types, include_falls) values
  (:GPR, :P, :R, '{1,4}', true),
  (:GQR, :Q, :R, '{2}', false);

-- Probe messages, as the Realtime server writes them before checking reads.
insert into realtime.messages (topic, extension, private)
select topic, ext, true
from unnest(array[:LIVE_PR, :LIVE_QR, 'live:nope', 'alerts:' || :P, 'alerts:' || :R]) topic,
     unnest(array['broadcast', 'presence']) ext;

-- ------------------------------------------------------------- publication -----
select t.ok((select array_agg(tablename::text order by tablename) from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public') = '{fall_events,vital_alerts}',
  'fall_events and vital_alerts are in the supabase_realtime publication');

-- ------------------------------------------------------------- owner CRUD ------
select t.as_user(:P);
insert into public.vital_alerts (id, session_id, sensor_type, kind, value, started_at) values
  ('a1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 4, 'high', 128, now() - interval '90 minutes'),
  ('a1000000-0000-0000-0000-000000000002', null, 2, 'low', 89, now() - interval '30 minutes'),
  ('a1000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 1, 'high', 2.4, now() - interval '80 minutes');
select t.ok((select count(*) from public.vital_alerts) = 3, 'participant reads own alerts (with and without a session)');
select t.ok((select user_id from public.vital_alerts where id = 'a1000000-0000-0000-0000-000000000002') = :P,
  'user_id defaults to the caller');

-- The phone's upsert, PostgREST-style: every sent column, id included, in the SET list.
insert into public.vital_alerts (id, user_id, session_id, sensor_type, kind, value, started_at, ended_at)
values ('a1000000-0000-0000-0000-000000000001', :P, '10000000-0000-0000-0000-000000000001', 4, 'high', 141,
        now() - interval '90 minutes', now() - interval '85 minutes')
on conflict (id) do update set id = excluded.id, user_id = excluded.user_id, session_id = excluded.session_id,
  sensor_type = excluded.sensor_type, kind = excluded.kind, value = excluded.value,
  started_at = excluded.started_at, ended_at = excluded.ended_at;
select t.ok((select value = 141 and ended_at is not null from public.vital_alerts where id = 'a1000000-0000-0000-0000-000000000001'),
  'an upsert by id updates the participant''s alert');
update public.vital_alerts set ended_at = now() where id = 'a1000000-0000-0000-0000-000000000002';
select t.ok((select ended_at is not null from public.vital_alerts where id = 'a1000000-0000-0000-0000-000000000002'),
  'participant closes own alert');

select t.ok(t.err($$insert into public.vital_alerts (id, sensor_type, kind, value, started_at, created_at)
  values ('a1000000-0000-0000-0000-000000000009', 4, 'high', 130, now(), '2020-01-01')$$) = '42501',
  'created_at is server-maintained (not client-writable)');
select t.ok(t.err($$update public.vital_alerts set updated_at = '2020-01-01'$$) = '42501',
  'updated_at is server-maintained (not client-writable)');
select t.ok(t.err($$insert into public.vital_alerts (id, session_id, sensor_type, kind, value, started_at)
  values ('a1000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 4, 'high', 130, now())$$) = '42501',
  'an alert under someone else''s session is refused');
select t.ok(t.err($$insert into public.vital_alerts (id, session_id, sensor_type, kind, value, started_at)
  values ('a1000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000001', 4, 'high', 130, now())$$) = '42501',
  'an alert under a session not uploaded yet is refused');
select t.ok(t.err($$insert into public.vital_alerts (id, user_id, sensor_type, kind, value, started_at)
  values ('a1000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a2', 4, 'high', 130, now())$$) = '42501',
  'an alert written under another user''s id is refused');
select t.ok(t.err($$update public.vital_alerts set session_id = '20000000-0000-0000-0000-000000000001'
  where id = 'a1000000-0000-0000-0000-000000000001'$$) = '42501',
  'an alert cannot be moved under someone else''s session');
select t.ok(t.err($$insert into public.vital_alerts (id, sensor_type, kind, value, started_at)
  values ('a1000000-0000-0000-0000-000000000009', 4, 'medium', 130, now())$$) = '23514', 'kind must be high or low');
select t.ok(t.err($$insert into public.vital_alerts (id, sensor_type, kind, value, started_at)
  values ('a1000000-0000-0000-0000-000000000009', 7, 'high', 130, now())$$) = '23514', 'sensor_type must be 1..6');
select t.ok(t.err($$truncate public.vital_alerts$$) = '42501', 'clients cannot TRUNCATE (it would bypass RLS)');

insert into public.vital_alerts (id, sensor_type, kind, value, started_at)
values ('a1000000-0000-0000-0000-000000000004', 3, 'high', 38.4, now());
delete from public.vital_alerts where id = 'a1000000-0000-0000-0000-000000000004';
select t.ok((select count(*) from public.vital_alerts) = 3, 'participant deletes own alert');

-- ------------------------------------------------------------- other participant
select t.as_user(:Q);
select t.ok((select count(*) from public.vital_alerts) = 0, 'another participant reads none of P''s alerts');
update public.vital_alerts set value = 0;
delete from public.vital_alerts;
select t.ok(t.err($$insert into public.vital_alerts (id, sensor_type, kind, value, started_at)
  values ('a1000000-0000-0000-0000-000000000001', 2, 'low', 1, now())
  on conflict (id) do update set value = excluded.value$$) = '42501',
  'another participant cannot upsert over P''s alert id');
insert into public.vital_alerts (id, session_id, sensor_type, kind, value, started_at)
values ('a2000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 2, 'low', 87, now());
select t.as_admin();
select t.ok((select count(*) from public.vital_alerts where user_id = :P and value <> 0) = 3,
  'another participant''s updates and deletes change nothing');

-- ------------------------------------------------------------- viewer reads ----
select t.as_user(:R);
select t.ok((select array_agg(sensor_type order by sensor_type) from public.vital_alerts where user_id = :P) = '{1,4}',
  'researcher reads P''s alerts for granted signals only (ECG, HR; not SpO2)');
select t.ok((select count(*) from public.vital_alerts where user_id = :Q) = 1, 'researcher reads Q''s SpO2 alert under Q''s grant');
select t.ok(t.err($$insert into public.vital_alerts (id, user_id, sensor_type, kind, value, started_at)
  values ('a1000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a1', 4, 'high', 130, now())$$) = '42501',
  'researcher cannot write alerts for P');
update public.vital_alerts set value = 0;
delete from public.vital_alerts;
select t.as_admin();
select t.ok((select count(*) from public.vital_alerts where value <> 0) = 4, 'researcher updates and deletes change nothing');

select t.as_user(:C);
select t.ok((select count(*) from public.vital_alerts) = 0, 'clinician without a grant reads no alerts');

select t.as_user(:P);
select public.update_access_grant(:GPR, '{1}', true);
select t.as_user(:R);
select t.ok((select array_agg(sensor_type) from public.vital_alerts where user_id = :P) = '{1}', 'narrowed grant: researcher sees only ECG alerts');
select t.as_user(:P);
select public.update_access_grant(:GPR, '{1,4}', true);

select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :R;
select t.as_user(:R);
select t.ok((select count(*) from public.vital_alerts) = 0, 'a suspended researcher reads no alerts');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :R;

-- ------------------------------------------------------------- suspended owner -
select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :P;
select t.as_user(:P);
select t.ok(t.err($$insert into public.vital_alerts (id, sensor_type, kind, value, started_at)
  values ('a1000000-0000-0000-0000-000000000009', 4, 'high', 130, now())$$) = '42501', 'a suspended participant cannot upload alerts');
select t.ok((select count(*) from public.vital_alerts) = 3, 'a suspended participant still reads own alerts');
select t.as_user(:R);
select t.ok((select count(*) from public.vital_alerts where user_id = :P) = 0, 'a suspended participant''s alerts are no longer shared');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :P;

-- ------------------------------------------------------------- live: send ------
select t.as_user(:P);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() is null, 'participant may broadcast on own grant''s live channel');
select t.ok(t.err($$insert into realtime.messages (topic, extension, private)
  values ('live:9a000000-0000-0000-0000-000000000001', 'broadcast', true) returning *$$) is null,
  'the send probe also passes when read back (INSERT ... RETURNING)');
select t.ok(t.receives(), 'participant may join own grant''s live channel');
select t.ok(t.send('presence') = '42501', 'presence is not allowed on live channels (send)');
select t.ok(not t.receives('presence'), 'presence is not allowed on live channels (receive)');
select t.on_topic(:LIVE_QR);
select t.ok(t.send() = '42501', 'participant cannot broadcast on another participant''s grant');
select t.ok(not t.receives(), 'participant cannot join another participant''s grant channel');

select t.as_user(:Q);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'another participant cannot broadcast on P''s grant');
select t.ok(not t.receives(), 'another participant cannot receive on P''s grant');

-- ------------------------------------------------------------- live: receive ---
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(t.receives(), 'the grantee receives on the grant''s live channel');
-- Since migration 10 the grantee may also broadcast here (to send 'stop'); see
-- live_viewer_stop.local.sql.
select t.ok(not t.receives('presence'), 'the grantee gets no presence');
select t.on_topic(:LIVE_QR);
select t.ok(t.receives(), 'the grantee receives on each of their grants');

select t.as_user(:C);
select t.on_topic(:LIVE_PR);
select t.ok(not t.receives(), 'another viewer cannot receive on someone else''s grant');
select t.ok(t.send() = '42501', 'another viewer cannot broadcast');

select t.as_admin();
set local role anon;
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501' and not t.receives(), 'anon can neither send nor receive');

-- ------------------------------------------------------------- live: topics ----
select t.as_user(:P);
select t.on_topic('live:nope');
select t.ok(private.can_send_live('live:nope') is false and private.can_receive_live('live:nope') is false,
  'a malformed topic is false, not an error');
select t.ok(t.send() = '42501' and not t.receives(), 'a malformed topic is refused by RLS without raising');
select t.ok(private.can_send_live(null) is false
        and private.can_send_live('LIVE:9a000000-0000-0000-0000-000000000001') is false
        and private.can_send_live('live:9A000000-0000-0000-0000-000000000001') is false
        and private.can_send_live('realtime:live:9a000000-0000-0000-0000-000000000001') is false
        and private.can_send_live('live:9a000000000000000000000000000001') is false
        and private.can_send_live('live:9a000000-0000-0000-0000-000000000001 ') is false
        and private.can_send_live('live:9a000000-0000-0000-0000-00000000000z') is false
        and private.can_send_live('live:00000000-0000-0000-0000-000000000000') is false,
  'only live:<lowercase canonical uuid of an existing grant> is accepted');
select t.on_topic(null);
select t.ok(t.send() = '42501' and not t.receives(), 'no topic set: nothing allowed');

-- ------------------------------------------------------------- alerts channel --
select t.as_user(:P);
select t.on_topic('alerts:' || :P);
select t.ok(t.receives(), 'a user may join their own alerts:<uid> channel');
select t.ok(t.send() = '42501', 'nobody broadcasts on alerts:<uid>');
select t.as_user(:R);
select t.ok(not t.receives(), 'a user cannot join someone else''s alerts channel');
select t.on_topic('alerts:' || :R);
select t.ok(t.receives(), 'viewers join their own alerts channel too');

-- ------------------------------------------------------------- live: accounts --
select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :R;
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(not t.receives(), 'a suspended grantee cannot receive');
select t.as_user(:P);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() is null, 'the participant may still send while the grantee is suspended (nobody receives)');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :R;
update public.profiles set account_role = 'participant' where id = :R;
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(not t.receives(), 'a demoted grantee cannot receive');
select t.as_admin();
update public.profiles set account_role = 'researcher' where id = :R;

update public.profiles set account_status = 'suspended' where id = :P;
select t.as_user(:P);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501' and not t.receives(), 'a suspended participant can neither send nor join');
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(not t.receives(), 'nobody receives a suspended participant''s live channel');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :P;

-- ------------------------------------------------------------- revoke ----------
select t.as_user(:P);
select t.ok(public.revoke_access_grant(:GPR), 'P revokes the grant');
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'after revoke the participant cannot broadcast on it');
select t.ok(not t.receives(), 'after revoke the participant cannot join it');
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(not t.receives(), 'after revoke the grantee cannot receive');
select t.ok((select count(*) from public.vital_alerts where user_id = :P) = 0, 'after revoke the grantee reads none of P''s alerts');
select t.on_topic(:LIVE_QR);
select t.ok(t.receives(), 'other grants are unaffected');

-- ------------------------------------------------------------- anon ------------
select t.as_admin();
set local role anon;
select t.ok(t.err($$select * from public.vital_alerts$$) = '42501', 'anon has no access to vital_alerts');

rollback;
