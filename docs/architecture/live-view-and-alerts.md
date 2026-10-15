# Live view and alerts: the contract

The phone app, the database and the web dashboard all depend on the names and formats
below. Change them here first, then in all three places.

## 1. Vital alerts in the cloud: `public.vital_alerts`

The phone already turns readings into alerts (`apps/mobile/src/domain/vitals/alert-monitor.ts`)
and keeps them locally. Falls are mirrored to `public.fall_events`; vital alerts
(`kind` high or low) are now mirrored to `public.vital_alerts`.

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | the phone's local alert id; upserts are idempotent on it |
| `user_id` | uuid, not null, default `auth.uid()` | the participant; FK `auth.users` on delete cascade |
| `session_id` | uuid, null | FK `recorded_sessions` on delete cascade; null when the alert happened while monitoring without recording |
| `sensor_type` | smallint, not null | sensor-protocol wire code, 1..6 |
| `kind` | text, not null | `'high'` or `'low'` |
| `value` | real, not null | most extreme value while open, canonical units |
| `started_at` | timestamptz, not null | |
| `ended_at` | timestamptz, null | null while still out of range |
| `created_at`, `updated_at` | timestamptz | server-maintained |

Who can read it:
- The participant can read and write their own rows.
- A researcher or clinician can read a row while they have an active grant from that
  participant that includes the row's `sensor_type`.

Both `vital_alerts` and `fall_events` are in the `supabase_realtime` publication. The
dashboard subscribes to INSERT and UPDATE events (`postgres_changes`), and Realtime
applies the same read rules to each subscriber. It subscribes on the private channel
`alerts:<own user id>`, which each account can join for itself; nobody can send on it.
DELETE events are never subscribed to, because they aren't filtered per viewer.

The phone uploads a session before that session's alerts: an alert whose `session_id`
isn't in the cloud yet is refused (42501). Clients never send `created_at` or
`updated_at`.

## 2. Live view for setup (nothing stored)

The participant turns on **Live view for setup** in the app, for a time they choose:
30 minutes (the default), 1, 2, 4 or 8 hours. It switches itself off at the end, or
sooner if they stop it (or every viewer does). While it is on, the phone sends its live
readings over **Supabase Realtime broadcast** on a **private** channel for each active
grant:

- topic: `live:<grant_id>` (the `access_grants.id` UUID); the client config is
  `{ private: true }`
- sending is allowed for the grant's participant while the grant is active (not
  revoked), and for the grant's grantee under the same rule as receiving (migration 10).
  The grantee sends only `stop`; the phone ignores every other event from a viewer. The
  policy can't be narrowed to one event (Realtime checks a probe with no event), so
  anything else a grantee sent would reach only the participant's phone and the
  grantee's own other tabs.
- joining is allowed for the grant's grantee (while the grant is active and the grantee's
  account is active with role researcher or clinician), and for the grant's own
  participant: Realtime needs read permission to join a private channel even to send,
  and the participant only ever sees their own readings there
- these rules are RLS policies on `realtime.messages`, based on `realtime.topic()`;
  broadcast only, no presence
- the topic is the grant id in lowercase, exactly as the API returns it; clients call
  `supabase.realtime.setAuth()` before subscribing
- Realtime checks the policies when a channel is joined, not on every message. So both
  sides re-check the grant about once a minute and leave the channel when it has ended.
- the project's Realtime setting **"Allow public access" must be off**. Otherwise a client
  that forgets `private: true` lands on an unprotected public channel with the same name.

The phone sends only the signals in that grant's `sensor_types`, so each grantee
receives only what they were given.

### Events

`status`: sent on start, every 5 s while on, and on stop.
```json
{ "v": 1, "state": "live", "endsAt": 1760001800000, "device": "WearWise-6F84", "simulated": false, "signals": [1, 2, 3, 4, 5] }
```
`state` is `"live"` or `"stopped"`. `endsAt` is phone wall-clock ms. `signals` lists the
streamed sensor codes this grant may see. `link` is how the phone reaches the patch (`"bluetooth"`, `"wifi"` or `"simulation"`) and
`firmware` the patch's firmware version (or null); the Wi-Fi network's name is never
sent. `sensors` lists the sensor codes the patch has, of those this grant may see,
whether or not they are streaming yet (heart rate waits for a finger), so the dashboard
can tell "not on this patch" from "no reading yet". `recording` says the phone is recording;
`startedByYou` that this grantee asked for that recording (only they may stop it from
the dashboard).

`samples`: a batch about every 500 ms.
```json
{ "v": 1, "sentAt": 1760000000500,
  "signals": { "1": { "rateHz": 250, "t0": 1760000000000, "values": [0.12, 0.15] },
               "4": { "rateHz": 1,   "t0": 1760000000000, "values": [72] } } }
```
- Keys are sensor codes as strings.
- `t0` is the phone wall-clock ms of the first value.
- Values are in canonical units: ECG mV, SpO₂ %, temperature °C, heart rate BPM,
  movement g (magnitude), PPG counts.
- A signal with no new values in a batch is left out.
- A batch stays well under 64 KB; at 250 Hz ECG it is about 125 values.
- `"leadsOff": true` on a signal: the batch's latest packet said an ECG electrode is off
  the skin. Absent otherwise.

`fall`: sent only to grantees whose grant has `include_falls`, at each step of the phone's
fall alarm while live view is on. Nothing is stored. Outside live view, falls reach a
grantee only through `fall_events`, which needs a recording.
```json
{ "v": 1, "at": 1760000000000, "state": "detected", "impactG": 3.4 }
```
`state` is `"detected"` (the alarm is counting down), `"ok"` (they tapped "I'm OK"),
`"raised"` (nobody answered) or `"dismissed"` (the raised alarm was closed). `at` is the
phone wall-clock ms of the fall and identifies it across its steps. A grantee who joins
or rejoins while an alarm is on gets its current step after the `status`.

`stop` (grantee → phone): the viewer stopped watching (the dashboard's **Stop live
view**, also sent by **Remove participant** before it revokes the grant).
```json
{ "v": 1 }
```
The phone stops sending to that grantee at once and doesn't take them back until live
view is started again. When nobody is left, live view switches off.

`record` (grantee → phone): ask the participant to start a recording. The phone shows
"Start a recording?" over whatever screen is open; nothing records unless they tap
Start (no answer within a minute counts as Not now). Requests from one grantee closer
than 10 s apart are ignored. `record-stop` (grantee → phone): stop the recording this
grantee asked for; anyone else's is ignored. Both are `{ "v": 1 }`.

`record` (phone → that grantee only): the answer.
```json
{ "v": 1, "answer": "asked" }
```
`answer` is `"asked"` (the participant is being asked), `"started"`, `"declined"` (Not
now, or no answer), `"recording"` (one is already running), `"unavailable"` (sensor not
connected, or no signals chosen) or `"stopped"` (stopped at this grantee's request; it is
saved and backed up like any recording). The next `status` carries `recording`.
The dashboard joins with `broadcast: { ack: true }` so a send resolves only once the
server has taken it: Realtime checks the send against the grant, so Remove participant
must not revoke the grant until the `stop` is through.

The dashboard treats a grant as live while `status` events keep arriving (within 12 s)
with `state: "live"` and `endsAt` in the future. If they stop before `endsAt`, it shows
live view as paused: the phone only sends while WearWise is open (there is no background
mode), and it picks up again by itself when the participant returns to the app.

## 3. Notifications

- **Phone:** a local OS notification when a vital alert opens, when a fall alarm goes off,
  and when the patch disconnects during a recording. Tapping it opens the matching screen.
  The in-app bell is unchanged.
- **Web:** an Alerts page and a bell with an unread count. While the dashboard is open it
  shows a browser notification for new rows, after the user allows notifications. There is
  no email or push when the dashboard is closed.

## 4. Who can sign in to the web dashboard

Any WearWise account whose `account_status` is `'active'`:
- **Participants** see their own data (sessions, charts, CSV, their alerts) and who they
  share with.
- **Researchers and clinicians** additionally see participants who share with them, live
  view, alerts for those participants, and Patch setup.
