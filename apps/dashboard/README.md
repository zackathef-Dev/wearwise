# WearWise web dashboard

The web side of WearWise. **Everyone with a WearWise account signs in here** with the
same email and password as the app:

| Account | Sees |
|---|---|
| Participant | **My data** (their uploaded sessions, charts, CSV, falls), **Alerts**, **Sharing** (who can see their data; stop sharing) |
| Researcher, clinician ("staff") | **Participants** who shared with them, each with **Live view** while the participant has it on, **Alerts** for those participants, and **Patch setup** |

A participant shares by creating a one-time code in the WearWise phone app; staff enter
it under Participants → Add participant. What anyone can see is decided by the server
(RLS and the RPCs in `supabase/migrations/`), not by this app.

## Run it

```bash
npm install                                  # from the repo root (npm workspaces: apps/*, packages/*)
cp apps/dashboard/.env.example apps/dashboard/.env   # then fill in the two values
npm run dev -w dashboard                     # http://localhost:5192
```

| Script (in `apps/dashboard`) | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5192 (strict) |
| `npm run build` | Type-check, then build the production bundle into `dist/` |
| `npm run preview` | Serve `dist/` on port 5193 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: container decoder, downsampler, CSV export, contract mappers, axes |

### Environment

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Same project as the phone app (`EXPO_PUBLIC_SUPABASE_URL` in `apps/mobile/.env`) |
| `VITE_SUPABASE_ANON_KEY` | The project's anon/publishable key (`EXPO_PUBLIC_SUPABASE_ANON_KEY`) |

Both are baked into the bundle at build time and are public by design. **Never** put
the service-role key in a `VITE_` variable. `.env` is gitignored; `.env.example` is
the committed template. Without the values the app shows a "Not configured" page.

### Deploying

`npm run build` produces a static site in `dist/` that runs on any static host. Ready
configs are included:

| Host | Settings |
|---|---|
| **Vercel** | Root directory `apps/dashboard`; `vercel.json` sets the build, the SPA rewrite and the headers. |
| **Netlify** | Base directory `apps/dashboard`; `netlify.toml` builds, and `public/_headers` + `public/_redirects` apply. |
| **Cloudflare Pages** | Build command `npm run build -w dashboard`, output `apps/dashboard/dist`; `_headers` and `_redirects` apply. |
| Anything else | Serve `dist/`, fall back to `index.html` for unknown paths, and send the headers in `public/_headers`. |

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's build environment.

The headers (`public/_headers`, mirrored in `vercel.json`; a test keeps them equal) set a
strict Content-Security-Policy, which allows connections only to the WearWise Supabase
project, so change it there if the project or its domain changes. They also block framing, allow USB serial only for this
site (Patch setup), cache `/assets/` forever and always re-check `/firmware/`. The site
is `noindex`, and no source maps are published.

### Before going live

1. **Database:** apply migrations through `20261015000006_alerts_and_live.sql` (alerts in
   the cloud, and live view authorisation).
2. **Realtime:** in Supabase → Realtime settings, turn **off "Allow public access"**, so
   `live:` and `alerts:` channels can only be used privately. Check there are no other
   broad policies on `realtime.messages` first.
3. **Auth redirects:** add `https://<your domain>/reset-password` to the Auth redirect
   allow list (`node supabase/scripts/admin.mjs allow-redirects` covers localhost), and
   set up custom SMTP so reset emails reach everyone.
4. **Firmware:** export the release firmware into `public/firmware/`
   (`npm run firmware:export -w dashboard`) before building, if Patch setup should
   offer it.
5. **HTTPS only:** browsers allow USB serial and notifications only on secure origins.

## Accounts

There is no sign-up page. Participants create their account in the phone app and can
sign in here straight away. A WearWise administrator creates researcher and clinician
accounts: the
no-code way (Supabase SQL Editor snippets) is in
[`docs/operations/researcher-access.md`](../../docs/operations/researcher-access.md). The admin
script does both steps below in one go, using the service-role credentials it already
needs:

```bash
node supabase/scripts/admin.mjs create-viewer dr.chen@clinic.org clinician "Dr Chen"   # prints a one-time password
node supabase/scripts/admin.mjs set-role someone@example.org researcher                 # promote an existing account
```

By hand, the equivalent is:

1. **Create the auth user** (email + password) with the service-role key or in the
   Supabase dashboard. The `profiles` trigger refuses a new user whose
   `user_metadata` lacks `consent_recorded_at`, so include it, for example with the
   admin API:
   `auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: 'Dr A. Example', consent_recorded_at: new Date().toISOString() } })`.
2. **Make them a viewer:** set `profiles.account_role` to `'researcher'` or
   `'clinician'` (and leave `account_status = 'active'`). Only the server can do
   this; the client's update grant covers `display_name` only.

After every sign-in, and on every load with a saved session, the dashboard reads the
user's own `profiles` row. A suspended account is signed straight back out with an
explanation; the role decides the menu (participants never see the staff pages, and
the server would show them nothing there anyway).

Suspending a viewer (`account_status` ≠ `'active'`) hides every participant from
them immediately; their grants remain and come back if the account is reactivated.

### Before you continue (18+ and terms)

Accounts are for people 18 or older, and every account accepts the current terms of
use, privacy policy, collection notice and research information (staff also accept the
researcher and clinician terms). An account that still has to do either sees **Before you
continue** after signing in, before anything else. The answers are recorded on the server
(`confirm_adult()`, `accept_terms()`) and in the account metadata. Bumping
`ACCEPTANCE_VERSION` in `packages/legal` asks everyone to accept again. The documents are
public at `/legal`, linked from the sign-in page and every footer. See
`docs/compliance/README.md` for what to fill in before launch.

### Passwords

- **Change password** (top bar, signed in): sets a new password straight away. This is
  how a viewer replaces the one-time password from `create-viewer`. No email needed.
- **Forgot password?** (sign-in page): emails a reset link that opens
  `/reset-password`, where the viewer sets a new password. Two server settings must be
  in place:
  - `http://localhost:5192/reset-password` (and the hosted origin, once there is one)
    on the Auth redirect allow list — `node supabase/scripts/admin.mjs allow-redirects`.
  - Working email. Without custom SMTP, Supabase's built-in mailer sends very few
    emails per hour and may only deliver to the project team's addresses; until SMTP
    is set up, an administrator can reset a password instead.
- Passwords need at least 10 characters, matching the server's `password_min_length`, and must
  not be a common password. A strength meter under every new-password box recommends
  capital and lowercase letters, numbers and symbols (rules shared with the app in
  `packages/password`).
  The reset form never says whether an address has an account.

## How sharing works, as the viewer sees it

- **Add participant** takes the code (`ABCDE-FGHJK`; case, spaces and dashes don't
  matter). Codes work once and expire after 24 hours. Characters that never occur in
  codes (I, L, O, 0, 1) and wrong lengths are caught before the request, because every
  failed attempt counts towards the server's limit of 10 failures an hour.
- Redeeming a second code from someone already on your list **updates** what you can
  see to match the new code; the list says so.
- **Remove participant** revokes the grant at once. If the participant had already
  stopped sharing, the dashboard says so and refreshes the list rather than showing an error.
- You see all of a participant's sessions, but only the **signals** they granted, and
  falls only if they included them.

## Alerts

The bell (top right) counts alerts that arrived since the last visit to **Alerts**:
falls, and readings that stayed out of the usual range (for example blood oxygen below
95 % for 15 s), as detected by the phone app. Staff see them for participants who share
that signal (or falls) with them; participants see their own.

- New alerts appear within seconds (Realtime on `vital_alerts` and `fall_events`, over
  the private channel `alerts:<user id>`), with a once-a-minute check as a fallback.
- **Browser notifications** (Alerts → Turn on): a notification when an alert arrives
  while WearWise is open in a tab. Nothing is sent when the dashboard is closed.
- "Seen" is remembered per account in this browser only.

## Live view

On a participant's page, staff see **Live view** while the participant has switched on
"Live view for setup" in the app: current heart rate, SpO₂, temperature and movement,
and the last 10 s of ECG, pulse wave and movement, drawn as they arrive. The phone switches
it off after 30 minutes. Only the signals that participant shares with you are sent;
nothing is stored. It travels on the private Realtime channel `live:<grant id>`, and the
page leaves the channel if the participant stops sharing. Contract:
`docs/architecture/live-view-and-alerts.md`.

## Data handling

- Sample bytes are downloaded from the private `recordings` bucket with the viewer's
  own session, CRC-checked chunk by chunk, decoded in memory, and dropped when you
  leave the page. Nothing is written to localStorage, IndexedDB or a cache, and nothing
  is logged. Only the Supabase auth session lives in localStorage (supabase-js
  default), so a reload doesn't sign you out.
- **Download CSV** is built in the browser from the decoded samples:
  `timestamp_us,elapsed_s,<signal>_<unit>` (for example `ecg_mV`). `timestamp_us` is the
  device clock as recorded, `elapsed_s` is seconds since the session's first sample
  (the charts' time axis), and values are written with exactly the resolution the
  device sent (ECG 0.001 mV, SpO₂ 0.01 %, temperature 0.01 °C, heart rate 0.1 BPM,
  movement 0.001 g, PPG 1 count). When zoomed in, "Visible window" exports only that span.
- Channels over 24 MB (about a day of ECG) wait for a click before downloading.

## Charts

- One chart per shared signal, all on one time axis: seconds since the session's
  first recorded sample. Zoom by dragging across any chart (all charts follow), with
  the toolbar above them, or with the keyboard on a focused chart (arrows move the
  readout, `+`/`−` zoom, `[`/`]` pan, `0` resets). Double-click shows the whole session.
- Long recordings are drawn as a min-max envelope per pixel column, so a single spike
  is never averaged away; a column with no samples stays empty, so gaps in the
  recording are visible. Zoomed in past one sample per pixel, the real samples are drawn.
- Falls are marked on every chart. Their times come from the phone's clock
  (`detected_at_ms`) while samples carry the device's clock, so a marker is accurate to
  about a second.
- Every chart has a "Table view of this window" for reading values without hovering.

## Patch setup

**Patch setup** (top bar, researchers and clinicians) installs firmware on a WearWise patch over USB and gives it the
Bluetooth PIN printed on its label. It works in **Chrome or Edge** on a computer (Web
Serial; Safari and Firefox can't reach USB devices) and only between the tab and the USB
port: nothing about a patch is sent to Supabase.

1. Plug the patch in with a USB data cable and click **Connect patch**. If no port is
   listed, install the USB driver for the board's chip (Silicon Labs CP210x or WCH CH340).
   If it won't connect, hold BOOT, tap EN/RST, release BOOT, and connect again. If it
   still fails, unplug the patch and plug it back in: that resets the USB serial chip.
   *Technical details* under the card shows esptool's log and the exact error.
2. The page shows the patch's Bluetooth name (`WearWise-XXXX`), its firmware version
   and whether it has a label PIN. Then pick:
   - **Set up**: installs the bundled firmware, writes a new PIN and erases the
     patch's settings (every paired phone is unpaired; Wi-Fi is forgotten). Use it for a
     new patch, and once for any patch flashed before label PINs existed.
   - **Update**: installs the bundled firmware and keeps the PIN, phones and Wi-Fi.
   - **New PIN** (new participant): a new PIN and erased settings, firmware untouched.
   - **Erase everything** (press and hold for 2 seconds; letting go early cancels): wipes
     the whole flash, so the patch is empty: no firmware, PIN, paired phones or Wi-Fi. The
     page stays connected, so **Set up** can follow straight away.
3. Print the label and stick it on the patch. The participant types that PIN when the
   phone asks while pairing.

How the PIN works: the page draws a random six-digit PIN (browser crypto, skipping
guessable ones like 123456) and writes it to the patch's `wwcfg` flash partition, the last
4 KB of flash, outside the settings store, so erasing settings never invalidates a label.
Every write is verified on the chip (MD5), and the PIN is read back before it is shown.
The firmware prefers this PIN; a board flashed with `idf.py` and never set up here makes
up its own and prints it on the serial console. Byte layout:
`firmware/wearwise-esp32/main/core/factory_config.h`.

### Installing firmware from files

**Choose file…** (under *Firmware to install*) installs a build from your computer instead
of the bundled one, for every action. It accepts what an ESP-IDF build produces and
recognises each file by its content, not its name:

- the app image alone (`build/wearwise-esp32.bin`): goes into the patch's own app
  partition, so the patch must already have the current layout (one **Set up** first);
- `bootloader.bin`, `partition-table.bin` and the app together (any order);
- one merged image (`idf.py merge-bin` → `build/merged-binary.bin`).

Files for another chip (ESP32-S3, C3…), files that aren't firmware, an app too big for
its partition, and a flash layout with no place for the label PIN are refused before
anything is written. An app that isn't `wearwise-esp32` is flagged and always asks first.
**Use included** switches back.

### Updating the bundled firmware

The page installs whatever is in `public/firmware/` (three images plus a `manifest.json`
with offsets and SHA-256; the page refuses files that don't match). After changing the
firmware:

```bash
cd firmware/wearwise-esp32 && idf.py build      # ESP-IDF 5.4
cd ../.. && npm run firmware:export -w dashboard   # copies build/ → public/firmware/
```

Then deploy the dashboard as usual. If the export says the build has no `wwcfg`
partition, the local `sdkconfig` predates `partitions.csv`: delete it and build again.

## Where things come from

| Concern | Source of truth |
|---|---|
| Backend contract | `supabase/migrations/*.sql`; the dashboard's reading of it is `src/data/types.ts`, `rows.ts`, `api.ts` |
| Storage byte format | `apps/mobile/src/data/sync/chunk-container.ts`; the decoder is copied to `src/data/chunk-container.ts`, pinned by golden bytes from the phone's packer in `src/data/__tests__/chunk-container.test.ts` |
| Sensor codes, scales, CRC | `packages/sensor-protocol` |
| Label PIN record, flash layout | `firmware/wearwise-esp32/main/core/factory_config.h` and `partitions.csv`; mirrored in `src/patch/`, pinned by a byte vector shared with `firmware/wearwise-esp32/test/host/` |
| Signal names and units | mirror `apps/mobile/src/shared/signal-meta.ts` in `src/data/signals.ts` |
| Colours, type, spacing | `packages/design-tokens`, injected as CSS variables by `src/theme/tokens.ts`; light, with dark following the OS |
| Typeface | Poppins, self-hosted (SIL Open Font License), in `src/assets/fonts` |
