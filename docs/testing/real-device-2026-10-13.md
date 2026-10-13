# Real-device test, 13 October 2026

Hardware: Samsung Galaxy S10 5G (SM-G977N, Android 12), iPad Pro 13-inch (M4, iPadOS
26.7.1), three ESP32 boards (chip rev 3.1), the web dashboard in Chrome (driven by
browser automation), the live Supabase project after migrations 6–11.

| Board | Name | Sensors | Firmware at the end |
|---|---|---|---|
| 1 | WearWise-6280 | MAX30102, MAX30205, MMA8452Q, AD8232 | 0.9.6 |
| 2 | WearWise-6F84 | MAX30102 only | 0.9.6 |
| 3 | WearWise-6990 | none (bare board) | 0.9.6 |

## Results

| Area | Check | Result |
|---|---|---|
| Patch setup | Detect board (name, MAC, firmware, "0.9.x available") | Pass |
| | Set up (firmware + label PIN, read back) | Pass after fix 1 |
| | New PIN, Update (PIN kept), Hold to erase, Set up from empty | Pass |
| | Update an existing patch to a newer firmware from the page | Pass (0.9.4) |
| Firmware | 0.9.3 → 0.9.4 → 0.9.5 over USB, pairing and label PIN kept | Pass |
| | ECG only on the board that has an AD8232 | Pass after fix 2 |
| Accounts | Phone sign-in; 18+/terms carried over (no "Before you continue") | Pass |
| | Dashboard sign-in as the researcher test account after confirming 18+/terms | Pass |
| Pairing | Bonded phone reconnects after every firmware update and reboot | Pass |
| | Encrypted, authenticated link (16-byte key, Secure Connections) | Pass |
| | 3 wrong PINs lock pairing; lock survives reboot; new pairings refused | Pass |
| | BOOT unlocks; correct label PIN pairs | Pass |
| | Switch to another patch / back | Pass after fix 8 |
| Monitoring | ECG lead-off message, temperature, movement, heart rate and SpO₂ with a finger | Pass |
| | Wi-Fi restored automatically after reconnect; streaming over pinned TLS | Pass |
| | Recording saved, backed up, visible to the researcher | Pass |
| | Full sample rate from the start of a recording | Pass after fix 4 |
| Sharing | Share code with chosen signals; name shown, never email; ECG hidden when not shared | Pass |
| | Code refused on reuse; lower-case and spaced input accepted | Pass |
| | Phone updates when the code is used | Pass after fix 5 |
| | Live view for setup (phone ↔ dashboard), nothing stored | Pass |
| | Remove access: researcher's list empties, direct session link refused | Pass |
| Alerts | Phone alerts mirrored to the researcher's Alerts page | Pass |
| | Fall: phone alarm with sound and vibration, private notifications on the "falls" channel | Pass |
| | Fall reaches the researcher during live view: detected, "I'm OK", raised, closed, each within ~1 s; repeating sound and banner on the dashboard | Pass after fix 17 |
| | Researcher opening the page during a raised alarm still sees it | Pass |
| Live view | Researcher's live view laid out like the phone's Home (ECG paper, tiles with the same Normal/High labels, graph on click) | Pass |
| | Researcher stops live view: phone switches off within ~1 s ("everyone watching stopped"); restarting it reaches the same page | Pass (migration 10) |
| | Remove participant while live: phone stops within ~2 s, access gone on both sides, re-sharing with a new code works | Pass after fix 18 |
| | Live view length chosen on the phone (30 min – 8 h); 8 h shown on both sides ("7 h 57 min left", dashboard "until 04:28") | Pass (terms 2026-10-17, migration 11) |
| | App sent to the background: dashboard shows Paused within ~15 s, live again within ~10 s of reopening, same end time | Pass |
| Dashboard | Account menu (name, email, role, Change password, Sign out); wordmark header; Remove participant from the list's row menu | Pass (removal from the list confirmed up to the dialog) |
| | Theme: System / Light / Dark in the account menu, applied at once (logo and canvases included), remembered in the browser | Pass |
| Live view | Researcher asks for a recording: phone prompt within ~2 s; Start → dashboard "Recording" + Stop recording; Stop from the dashboard → saved, backed up, participant told who stopped it | Pass |
| | Not now → dashboard "didn't start a recording this time" | Pass |
| | Connected device on the researcher's live view: patch name, Bluetooth / Wi-Fi, firmware, its sensors; "Their patch has no ECG" and "Not on this patch" for sensors it lacks (Samsung + board 2) | Pass |
| | Remove participant from the list's "⋯" menu while live view is on: phone stops within ~2 s, its access list re-lists | Pass |
| Dashboard | CSV download of a shared session (skin temperature: header + 53 rows = 53 samples) | Pass; file name now uses the local start time shown on the page, not UTC |
| Phone | Sign out clears WearWise notifications (a fall notification: 1 → 0) and returns to sign-in with no email filled in | Pass |
| iPad | iPad Pro 13" (M4), iPadOS 26.7.1: Release build signed with a personal team, installed and launched | Pass |
| | New account (18+, terms, password strength), email confirmation, first sign-in | Pass |
| | Pair board 2 with its label PIN; HR, SpO₂ and pulse wave listed; "This sensor has no ECG" | Pass after fix 21 (board was held in download mode by Patch setup) |
| | Live heart rate and SpO₂ with a finger on board 2 | **Open: findings 19, 20** |
| | Board 1 (all sensors) on the iPad: heart rate 97, SpO₂ 99 %, skin temperature, movement, ECG lead-off message | Pass |
| | App-switcher privacy cover | Pass |
| Pairing | Firmware 0.9.6 on all three boards (app only; PINs, bonds, Wi-Fi kept) | Pass |
| | A patch refusing pairing shows "The patch didn't accept this device" with the steps (Bluetooth settings, BOOT, PIN) | Pass |
| | Board 1 paired with the iPad, then the Samsung (BOOT + PIN); the iPad then reconnected with no PIN (two devices kept) | Pass |
| | Browser notifications switched on in Chrome | Pass |
| Wi-Fi | Too-short password refused before sending, current network kept | Pass after fix 14 |
| Links | Malformed and 3,000-character `wearwise://` links on the Samsung | Pass |

## Findings and fixes

| # | Finding | Status |
|---|---|---|
| 1 | Patch setup flashing failed on a board whose USB link corrupts data above 115200 baud ("The patch didn't answer"; the esptool CLI fails the same way) | **Fixed**: the write retries at 115200, and a persistent failure says the cable is dropping data (`serial-link.ts`) |
| 2 | Boards without an AD8232 advertised ECG and would record ADC noise | **Fixed** in firmware 0.9.4: the AD8232's driven lead-off pins are detected at boot |
| 3 | Chrome's port picker shows identical names for identical boards | **Mitigated**: Patch setup says to plug in one patch at a time; the page shows the MAC after connecting |
| 4 | **Data loss:** the first recording after a preview sometimes saved only temperature for minutes (one session kept 5,202 of ~12,300 movement samples) | **Fixed**: the sequence tracker keys streams by session (`packages/sensor-protocol/src/sequence.ts`); regression test; verified ~310 samples/s from the first second |
| 5 | Privacy & access kept showing "code waiting" after the researcher used it | **Fixed**: checks every 10 s while a code waits |
| 6 | Home's "This week" didn't update after a recording | **Fixed**: reloads when a recording is saved |
| 7 | Icons went blank app-wide after a busy session (one Skia GPU canvas per icon; thousands of "EGLConsumer is not attached") | **Fixed**: icons are drawn once on the CPU into cached PNGs |
| 8 | Picking another patch while one was connected silently kept the old one | **Fixed**: the old link is ended first; refused during a recording |
| 9 | Reconnect on a patch that hadn't paired reconnected the previous patch | **Fixed**: "Try again" retries the patch the card names |
| 10 | Pairing failures were never explained on Home ("Not connected") | **Fixed**: one line with More/Less |
| 11 | A failed first connect started the background reconnect loop: 8 more pairing prompts, each counted by the patch toward its lock-out | **Fixed**: only a link that was fully up is re-established |
| 12 | A patch reporting no sensors failed with "Invalid WearWise capabilities." | **Fixed**: "No sensor connected. The patch paired, but it didn't find any sensor attached…" |
| 13 | "Change network" offered no way to enter another network | **Fixed**: "Use a different network" |
| 14 | A too-short Wi-Fi password flipped the status to "not connected" | **Fixed**: checked first, shown under the form |
| 15 | Samsung's "Pair with…?" step plus reading time ran past the patch's 15 s limit | **Fixed** in firmware 0.9.5: 30 s, and 60 s once the PIN prompt is up; Wi-Fi send-queue drops are now logged |
| 16 | **Falls outside a recording never reach the researcher**: `fall_events.session_id` is required, so a fall during ordinary monitoring stays on the phone | **Decided**: while live view is on, each step of the fall alarm goes to researchers whose share includes falls, over the live channel, nothing stored; otherwise only falls inside recordings are shared, as before |
| 17 | The dashboard's fall sound stayed silent if the page was reloaded and clicked before it finished loading (the sound was only set up by a click it saw), and it played once while the phone keeps ringing | **Fixed**: the alarm sets the sound up itself, a note asks for a click while the browser still blocks sound, and it repeats every 4 s until the fall is answered or the banner is closed |
| 18 | Remove participant revoked the grant before the server had checked the "stop" sent just before it, so the stop was dropped and live view ended only at the phone's next check (up to 30 s) | **Fixed**: the dashboard's live channel uses acknowledged sends, so removal waits until the stop is through; the phone's access list re-lists when a viewer leaves |
| 19 | Board 2 showed SpO₂ ≈ 80 % at rest. Board 1 with the same firmware, on the iPad, read 99 %. SpO₂ uses the uncalibrated textbook curve (110 − 25·R), which a weaker or different module pushes low | **Open**: check board 2's sensor module and wiring; calibrate against a reference pulse oximeter |
| 20 | Board 2 showed heart rate ≈ 150 at rest (about double). Board 1 read 97 after starting near 140 and settling over ~10 s | **Open**: board 2's module or wiring is the first suspect; separately, the patch sends heart rate before it has settled (firmware could hold it back until then) |
| 21 | Patch setup left a patch in its download mode (silent, no Bluetooth) when a read failed, and offered no way out while connecting | **Fixed**: Disconnect whenever connected, Cancel while connecting, and every exit restarts the patch |
| 22 | Moving a patch between a phone and a tablet meant BOOT + PIN every time: a patch kept a single owner, so pairing one device unpaired the other | **Changed** in firmware 0.9.6: a patch keeps the two most recent devices; a third still needs BOOT + PIN and pushes out the oldest |
| 23 | A refused pairing said only "The sensor refused pairing", and Home told people to "enter the pairing code your phone shows" (the phone shows none; the PIN is on the label) | **Fixed**: step-by-step help (remove the old entry in Bluetooth settings, press BOOT, type the PIN), correct hints on Home and Devices, and a note that Android's "0000 or 1234" suggestion is wrong |

## Not tested

- Heart rate and SpO₂ accuracy against a reference device (findings 19 and 20).

## Notes for the next test

- On macOS, opening a CP2102 port with pyserial resets the ESP32. To read a running
  board's log without a reset, open it with raw termios and leave DTR/RTS alone.
- After a code change, Metro reloads the phone app in place, which can leave stale
  state; restart the app fully before judging a fix.
