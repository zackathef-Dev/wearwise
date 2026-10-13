-- Viewer stop RLS tests (migration 20261017000010). Plain SQL, no pgTAP, run by
-- supabase/sql-tests/standalone/run.sh. One transaction, rolled back.
--
-- Cast: P and Q participants, R researcher, C clinician.
--   GPR  P -> R      GQC  Q -> C
-- Realtime is simulated as in alerts_and_live.local.sql: role + request.jwt.claims
-- + realtime.topic, then an INSERT probe under RLS (may send).

\set P '''00000000-0000-0000-0000-0000000000a1'''
\set Q '''00000000-0000-0000-0000-0000000000a2'''
\set R '''00000000-0000-0000-0000-0000000000b1'''
\set C '''00000000-0000-0000-0000-0000000000c1'''
\set GPR '''9a000000-0000-0000-0000-000000000001'''
\set GQC '''9c000000-0000-0000-0000-000000000001'''
\set LIVE_PR '''live:9a000000-0000-0000-0000-000000000001'''
\set LIVE_QC '''live:9c000000-0000-0000-0000-000000000001'''

begin;

create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

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

create function t.on_topic(topic text) returns void language sql as $$
  select set_config('realtime.topic', coalesce(topic, ''), true);
$$;

-- Send probe: null = allowed, else the SQLSTATE (42501 = refused by RLS).
create function t.send(ext text default 'broadcast') returns text language sql as $$
  select t.err(format('insert into realtime.messages (topic, extension, private) values (%L, %L, true)',
                      coalesce(realtime.topic(), ''), ext));
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

insert into public.access_grants (id, participant_id, grantee_id, sensor_types, include_falls) values
  (:GPR, :P, :R, '{1,4}', true),
  (:GQC, :Q, :C, '{2}', false);

-- ------------------------------------------------------------- send ------------
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() is null, 'the grantee may broadcast on their grant''s live channel (stop)');
select t.ok(t.send('presence') = '42501', 'the grantee still gets no presence');
select t.on_topic(:LIVE_QC);
select t.ok(t.send() = '42501', 'a viewer cannot broadcast on someone else''s grant');
select t.on_topic('live:nope');
select t.ok(t.send() = '42501', 'a malformed topic is refused');

select t.as_user(:C);
select t.on_topic(:LIVE_QC);
select t.ok(t.send() is null, 'a clinician grantee may broadcast on their own grant too');
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'and not on another viewer''s grant');

select t.as_user(:Q);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'another participant still cannot broadcast on P''s grant');

-- ------------------------------------------------------------- accounts --------
select t.as_admin();
update public.profiles set account_status = 'suspended' where id = :R;
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'a suspended grantee cannot broadcast');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :R;
update public.profiles set account_role = 'participant' where id = :R;
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'a demoted grantee cannot broadcast');
select t.as_admin();
update public.profiles set account_role = 'researcher' where id = :R;

update public.profiles set account_status = 'suspended' where id = :P;
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'nobody broadcasts on a suspended participant''s channel');
select t.as_admin();
update public.profiles set account_status = 'active' where id = :P;

-- ------------------------------------------------------------- revoke ----------
select t.as_user(:P);
select t.ok(public.revoke_access_grant(:GPR), 'P revokes the grant');
select t.as_user(:R);
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'after revoke the grantee cannot broadcast');

select t.as_admin();
set local role anon;
select t.on_topic(:LIVE_PR);
select t.ok(t.send() = '42501', 'anon cannot broadcast');

rollback;
