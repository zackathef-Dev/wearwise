# Troubleshooting

Problems seen while building and testing WearWise, and what fixes them. Grouped by where
they show up.

## Local backend (Supabase CLI and Docker)

| Symptom | Cause | Fix |
|---|---|---|
| `supabase start`: "Cannot connect to the Docker daemon" | Docker isn't running | Start Docker Desktop; wait until `docker info` prints a server version |
| `docker: command not found` right after installing Docker Desktop on macOS | Docker Desktop installed its CLI in `~/.docker/bin`, which this terminal's PATH doesn't include | Open a new terminal. If it persists: Docker Desktop → Settings → Advanced → choose the *System* installation (needs your password), or add `~/.docker/bin` to PATH |
| `supabase start`: "port is already allocated" | Another Supabase project (or anything) uses 54321–54327 | `supabase stop --project-id <other>` (`docker ps` shows `supabase_*_<project>` names), or stop the other program |
| `npx supabase …` fails to find a binary | `.npmrc` has `ignore-scripts=true`, so the npm package can't download its binary | Install the CLI standalone (README, Prerequisites) |
| Studio or the API answers but the tables are missing | The migrations failed part-way | `supabase db reset` and read the first error it prints |
| `supabase db reset` says "seed.sql: this database already has real accounts" | You pointed the seed at a database with other accounts | The seed is for a fresh local database only. Never run it elsewhere |
| `supabase test db` fails with "Bad plan" or a syntax error | A test file is broken, or you added a non-pgTAP `.sql` under `supabase/tests/` | Only pgTAP files go in `supabase/tests/`; plain-SQL suites go in `supabase/sql-tests/` |
| `run-on-local-stack.sh`: "Local Supabase isn't running" | The stack is stopped, or `project_id` in config.toml changed | `supabase start` |
| Demo accounts disappeared | `supabase db reset --no-seed`, or a reset after you changed `seed.sql` | `supabase db reset` |

## App ↔ backend

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in screen says the backend isn't configured | No URL/key, an invalid key (a secret key is refused), or `http://` in a **release** build | `npm run backend:status` to see what each build uses; `npm run backend:local` or fill in `apps/mobile/.env`; restart Metro with `npx expo start -c` |
| Changed `.env` but the app still uses the old backend | `EXPO_PUBLIC_*` values are bundled in when Metro builds | `npx expo start -c` (clears the cache), then reload the app |
| App times out talking to `http://192.168.x.x:54321` | Phone on another network, firewall blocking 54321, or the computer's IP changed | Same Wi-Fi (not a guest network that isolates devices); allow port 54321; `npm run backend:local` again. Test from the phone's browser: `http://<ip>:54321/auth/v1/health` should return JSON |
| Android emulator can't reach the backend | Firewall, or a VPN on the computer | `npm run backend:local -- --host 10.0.2.2` (the emulator's alias for the computer) |
| USB Android phone, no shared Wi-Fi | | `adb reverse tcp:54321 tcp:54321` then `npm run backend:local -- --host 127.0.0.1` |
| "Invalid login credentials" with a demo account | The local database was reset without the seed, or you're on another backend | `supabase db reset`; `npm run backend:status` |
| Sign-up fails: password too short | The server requires 10+ characters | Use a longer password |
| Sign-up fails with a database error | The server's sign-up trigger refused the metadata: an old app, or terms the server doesn't know | Apply all migrations (`supabase db reset` locally, `supabase db push` hosted) |
| Hosted: sign-up says "email rate limit exceeded" (HTTP 429) | No custom SMTP; Supabase's built-in mailer sends about 2 emails per hour | Configure SMTP (docs/deployment.md) |
| Confirmation or reset email opens a browser page instead of the app | `wearwise://auth/confirmed` / `wearwise://auth/reset` aren't in the redirect allow-list | Add them (Auth → URL Configuration; locally they're in config.toml) |
| A new phone signed in as an existing participant shows an empty History for a moment | Restore runs in the background after sign-in | Wait; sessions from the cloud are added as they download |
| Sessions stay "not backed up" | Offline, backend unreachable, or the account hasn't confirmed 18+ (the server refuses uploads) | Fix the connection; Profile → Privacy & access → Back up now; complete "Before you continue" if shown |

## Web dashboard

| Symptom | Cause | Fix |
|---|---|---|
| "Not configured" page | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing | `npm run backend:local` (dev) or set them in `apps/dashboard/.env`; restart `npm run dev -w dashboard` |
| `vite build` stops: "public/_headers doesn't allow …" | The security headers name another backend | `npm run deploy-config -w dashboard`, commit `public/_headers` and `vercel.json`, build again |
| A deployed dashboard can't sign in (browser console: CSP `connect-src` violation) | Headers deployed for another backend | As above, then redeploy |
| A participant can't see Participants / Patch setup | Those pages are for researchers and clinicians | Make the account a viewer with `supabase/admin/set-role.sql` (Studio → SQL editor) |
| Share code "invalid or expired" | Codes are single-use, last 24 h, and a new code replaces an unused one; 10 failed tries per hour lock the viewer out for the hour | Ask for a new code; wait an hour after repeated failures |
| Live view: the researcher sees nothing | Live view is off on the phone, its time ran out, the grant was revoked, or the app is in the background (shows "Paused") | Start live view in the app (Profile → Privacy & access; Home then shows a banner with time left and Stop); keep the app open |
| Fall alarm sound doesn't play on the dashboard | The browser blocks sound until the page is clicked | Click the page once (the banner says so) |

## Patch setup (firmware over USB)

| Symptom | Cause | Fix |
|---|---|---|
| No port in Chrome's picker | No USB driver, a charge-only cable, or not Chrome/Edge | Install the CP210x or CH340 driver; use a data cable; use Chrome or Edge |
| Several identical "CP2102" entries | Identical boards | Plug in one patch at a time |
| "The patch didn't answer" | The board isn't in download mode, or the USB link corrupts data at high speed (the page retries at 115200 baud) | Hold BOOT, tap EN/RST, release BOOT, connect again; or unplug and replug; try another cable or port |
| Patch silent on Bluetooth after using Patch setup | Older dashboards could leave it in download mode | Press EN/RST or unplug and replug (current versions restart it on every exit) |

## Bluetooth pairing and live data

| Symptom | Cause | Fix |
|---|---|---|
| "The patch didn't accept this device" | Stale bond, pairing window closed, or lock-out after 3 failed attempts | In the phone's Bluetooth settings remove the old WearWise entry; press BOOT on the patch; pair again and type the label PIN within a minute |
| Android suggests the PIN is "0000 or 1234" | Generic Android hint | Ignore it; type the 6-digit label PIN |
| A third phone or tablet can't pair | The patch remembers two devices | Press BOOT, pair with the PIN; the oldest remembered device is dropped |
| No patch found when scanning | Another phone is connected (one connection at a time), the patch isn't powered, or Bluetooth / Nearby-devices permission is off | Close the app on the other phone; check power and permissions |
| Emulator / simulator shows no Bluetooth | They have no Bluetooth | Use **Use Simulation** on the Devices tab, or a physical phone |
| A possible-fall alarm keeps appearing while using the simulation | The simulated movement signal contains a fall about 12 s after each stream start (on connecting, and again each time a recording starts or stops) and then every 3 minutes, on purpose | Answer **I'm OK**, or leave Movement out of the recording; the alarm is part of what the simulation tests |
| No ECG on a patch | No AD8232 fitted (detected at boot), or a module wired without LO+/LO− | Wire LO+/LO−, or set `WW_AD8232_DETECT 0` in `FirmwareConfig.h` and rebuild |
| ECG says "leads off" | An electrode isn't touching skin | Check the electrodes and lead colours |
| Heart rate about double at first, or SpO₂ around 80 % | Pulse estimate not yet settled; poor finger contact; an uncalibrated or weak MAX30102 module | Hold still for 10–20 s with steady, light pressure; try another module; SpO₂ is uncalibrated (known limitation) |
| Wi-Fi streaming never starts | 5 GHz-only network, or a WPA2 password under 8 characters (refused before it's sent) | Use a 2.4 GHz network; Bluetooth carries the data anyway |

## Building

| Symptom | Cause | Fix |
|---|---|---|
| Android release build: "Release requires NODE_ENV=production…" | Intentional guard | `NODE_ENV=production ./gradlew assembleRelease` with `.env.production` filled in |
| Android release build: "Production backend must be an HTTPS URL…" | `.env.production` points at a local/http backend | Use the hosted https URL |
| Android release build: "Release signing missing" | No keystore yet | `node scripts/create-release-signing.cjs` (in `apps/mobile`), then back up the two files |
| Xcode: the app identifier can't be registered to your team | `io.wearwise.participant` is registered to another Apple team | Change `ios.bundleIdentifier` in `apps/mobile/app.config.ts`, `npx expo prebuild --platform ios` |
| Expo Go can't open the project | The app uses native modules | Use `npx expo run:android` / `run:ios` (development build) |
| The app behaves oddly after a code change | Metro reloaded in place with stale state | Fully close and reopen the app |
| A phone you didn't mean to test with now talks to the local backend | Development builds load JavaScript from whichever Metro serves on this computer's port 8081 | Expected. Run `npm run backend:cloud` and restart Metro (`npx expo start -c`) to put every development build back on the hosted backend |
| Firmware build ignores `idf.py build -DWW_…` | The build doesn't pass CMake variables to C | Edit `main/config/FirmwareConfig.h` |
| Firmware export: "no wwcfg partition" | An old `sdkconfig` from before `partitions.csv` | Delete `firmware/wearwise-esp32/sdkconfig` and build again |
| Windows: ESP-IDF can't find its Python environment | `IDF_TOOLS_PATH` set after `export.ps1` | Set `IDF_TOOLS_PATH` first, then run `export.ps1` |
| macOS/Linux: `export.sh` says the Python virtual environment `idf5.4_py3.X_env` was not found | ESP-IDF was installed with a different `python3` than the one now first on PATH | Put that Python first on PATH, or `export IDF_PYTHON_ENV_PATH=~/.espressif/python_env/<the env that exists>` before `. export.sh`; or re-run `./install.sh esp32` |
| `idf.py`: "cmake must be available on the PATH" | ESP-IDF's tools weren't installed by `install.sh` (cmake and ninja come with it) | Re-run `./install.sh esp32` in the ESP-IDF folder, or install cmake and ninja yourself |
| macOS: opening the serial port restarts the ESP32 | Normal (the port toggles DTR/RTS) | Nothing to fix |
