# Hardware test matrix

Manual, controlled, evidence-backed. A row is **not yet physically tested** until
it has a date and an evidence pointer. Emulators do not count for anything with a
radio in it.

Legend: ✅ passed · ❌ failed · ⏳ not yet physically tested · n/a not applicable
to this milestone

## Milestone 3 — simulated monitoring

| # | Check | Android (physical) | iPhone (physical) | Evidence |
|---|---|---|---|---|
| 3.1 | App installs and reaches Sign In (+ Create Account submits to the real project, "Check your email" shown) | ✅ 26 Aug 2026 (SM-G977N, Android 12) | ⏳ | [evidence](evidence/m3/3.1-android-2026-08-26/) |
| 3.2 | Sign in against project `<project-ref>` | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 12-after-signin.png — Home greets the profile name written by the trigger |
| 3.3 | Choose a signal shows 3 capabilities from the simulated device | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 13-sensor.png |
| 3.4 | Live: ECG trace draws at ~5 fps, "Simulated data" label visible | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 14-live-a/b.png 3 s apart, counters advance (336→532 samples); fps not instrumented — visually smooth |
| 3.5 | Stop → session appears in History immediately | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 15-after-stop.png |
| 3.6 | Session detail chart decodes from stored chunks | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 16-detail.png — 1,568 ECG samples, min −0.28 / max 1.12 mV |
| 3.7 | **Force-quit during recording → relaunch → "A recording was interrupted"** | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 17 (recording, `am force-stop`) → 19-after-relaunch-b.png |
| 3.8 | Keep / Delete on the interrupted session both work | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 20-history-interrupted.png (760 readings kept) → 24-step.png stays INTERRUPTED; Delete confirm dialog seen in 22 and cancelled with Keep (23) |
| 3.9 | Restart app → sessions still listed (encrypted DB persisted) | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 19-after-relaunch-b.png, 28-airplane-stopped.png (3 sessions) |
| 3.10 | **Encryption proof**: `adb shell run-as io.wearwise.participant sh -c 'head -c 16 databases/wearwise.db \| xxd'` does NOT start with `53 51 4C 69 74 65` | ✅ 26 Aug 2026 | n/a (no shell) | [evidence](evidence/m3/3.10-android-2026-08-26/) header `e1 c7 2f 0c`, 0 plaintext markers in DB or WAL |
| 3.11 | Airplane mode ON → recording continues, stop saves | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) 26/27 (✈ in status bar, 2100 samples, 0 gaps) → 28-airplane-stopped.png (1 min, SAVED) |
| 3.12 | Storage mode shows `encrypted` (no "will not be kept" notice) | ✅ 26 Aug 2026 | ⏳ | [evidence](evidence/m3/android-2026-08-26/) no memory-only notice on Home/Sensor/History (13, 19, 28) and DB present on disk (3.10) |

## Milestone 4 — BLE (ESP32)

Hardware in hand: ESP-WROOM-32 (ESP32-D0WD-V3), flashed with
`firmware/wearwise-esp32` fw 0.4.0 on 26 Aug 2026. Boot self-test PASS; advertises
as `WearWise-6280` (deviceId redacted; serial log:
`evidence/m4/firmware-boot-2026-08-26/`). The Android app was rebuilt with the
`react-native-ble-plx` native module (permissions verified in the generated
manifest) and installed on the Samsung SM-G977N. Evidence for the rows below is in
`evidence/m4/android-2026-08-26/`.

| # | Check | Android (physical) | iPhone | Evidence |
|---|---|---|---|---|
| 4.1 | BLE permission prompt copy, deny path shows why + settings link | ✅ 26 Aug 2026 (Allow path) — deny/blocked copy coded, not yet exercised | ⏳ | 32-ble-permission.png |
| 4.2 | Scan finds the ESP32 by service UUID; other BLE devices filtered | ✅ 26 Aug 2026 — only `WearWise-6280` listed | ⏳ | 33-ble-scan.png |
| 4.3 | Connect; capabilities discovered from GATT | ✅ 26 Aug 2026 — ECG 70 / SpO₂ 25 / Temp 1 Hz read from the device | ⏳ | 34-ble-connected.png |
| 4.4 | Stream ECG+SpO₂+Temp, zero decode errors | ✅ 26 Aug 2026 — two runs, 1m19s (5474 samp / 391 pkt) + ~2 min, **0 gaps, 0 dup, 0 decode errors**. Full 10-min soak not yet run. | ⏳ | 35, 36, 39, 44 |
| 4.5 | Walk out of range → `reconnecting` → walk back → resumes, gap counted | ⏳ physical range-walk not done; auto-reconnect proven by 4.6 | ⏳ | (see 4.6) |
| 4.6 | ESP32 power-cycle mid-session → same session continues (new bootId) | ✅ 26 Aug 2026 — RTS reset (bootId 0x79652df1→0x404f9b3f); app auto-reconnected, **same session**, samples continued 546→2814, no duplicate session | ⏳ | 44, 45, 46, 47 |
| 4.7 | Phone backgrounded 5 min → data on return (or documented loss) | ⏳ | ⏳ | |
| 4.8 | Two ESP32s nearby → correct one selected, no cross-talk | ✅ 26 Aug 2026 — both `WearWise-6280` + `WearWise-6990` listed (distinct deviceIds); selected 6990; GATT connected to its MAC only, zero activity to 6280 | ⏳ | [evidence](evidence/m4/two-devices-2026-08-26/) |

Also proven on-device: a full BLE session saves to the **encrypted** store and is
correctly labelled **"Simulated session"** — the firmware flags its data
`FLAG_SIMULATED` even though the transport is real BLE, and `closeSession`
reconciles the session's `simulated` flag from the packets (47-ble-history2.png,
top row 06:57 vs the pre-fix "Session" at 06:49).

Not a "gap": 4.6 shows GAPS=0 because a new bootId is a **restart**, which the
sequence tracker accepts without counting a gap. A within-stream loss (same
bootId, missing sequence numbers — the 4.5 range-walk) is what increments gaps.

## Milestone 5 — Wi-Fi

| # | Check | Android | iPhone | Evidence |
|---|---|---|---|---|
Hardware: WearWise-6990 flashed with fw 0.5.0 (Wi-Fi STA + WebSocket + BLE
provisioning). A 2.4 GHz home network; phone and ESP32 on one LAN.
Evidence: `evidence/m5/android-2026-08-26/`.

| # | Check | Android (physical) | iPhone | Evidence |
|---|---|---|---|---|
| 5.1 | Provision over BLE with PoP; credentials never visible in logs | ✅ 26 Aug 2026 — SSID/pass written over BLE (opcode 0x10); serial logs only "7 chars ssid" + IP, never the password. PoP gates the WS. | ⏳ | serial-wifi-join.log |
| 5.2 | mDNS discovery `_wearwise._tcp.local` on the LAN | ⏭️ deferred — BLE-reported IP used instead (more reliable, no managed component) | ⏳ | ble-gatt.md |
| 5.3 | Authenticated WebSocket stream, packet counts match | ✅ 26 Aug 2026 — Transport=wifi, PoP-gated `ws://…:80/stream`, 0 duplicates, live ECG. (Not a 10-min soak.) | ⏳ | 70-wifi-live.png |
| 5.4 | Kill Wi-Fi AP → BLE fallback, **no duplicate session, no duplicate packets** | ✅ 26 Aug 2026 — phone Wi-Fi off mid-stream → auto fallback to BLE, Transport switches=2, **Duplicates dropped=0**, one session (`efaf68bd`), recording never stopped | ⏳ | 71-wifi-killed.png, 75-wifi-history.png |
| 5.5 | SoftAP mode with no router; phone warned about lost internet | ⏭️ deferred — STA provisioning implemented; SoftAP-only not built | ⏳ | |
| 5.6 | Wi-Fi up, internet down → recording unaffected | ✅ 26 Aug 2026 (incidental) — phone showed "no internet" throughout; streaming unaffected | ⏳ | 70/71 |

## How to record evidence

Put screenshots / `adb logcat` excerpts / recording exports under
`docs/testing/evidence/<milestone>/<check>-<platform>-<date>/` and link the folder
in the Evidence column. Keep the raw file; do not summarise it.
