-- WearWise: a viewer can stop live view from the dashboard.
-- Extends section 2 of docs/architecture/live-view-and-alerts.md (migration 6).
--
-- Until now only the participant could broadcast on 'live:<access_grants.id>'; the
-- grantee could only receive. The dashboard's "Stop live view" (and "Remove
-- participant", which stops it first) sends one 'stop' event to the phone on that
-- channel, so the grantee now needs broadcast-send there too, under exactly the
-- condition that already lets them receive (private.can_receive_live).
--
-- Realtime checks policies with a probe that carries no event or payload, so this
-- cannot be narrowed to 'stop'. What the grantee could send otherwise reaches only
-- the two parties already on the channel: the participant's phone, which acts on
-- 'stop' and ignores every other event from the viewer, and the grantee's own other
-- tabs. Nobody else can join the channel. Presence stays refused.

create policy "live: grantee sends on own grant (stop)"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select private.can_receive_live((select realtime.topic())))
  );
