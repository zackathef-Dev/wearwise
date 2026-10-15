# WearWise — session handoff (2026-08-29)

> **Historical (29 Aug 2026).** Kept for its HR-pipeline notes. Versions, test counts and
> settings below are out of date: for the current state start with
> [`docs/knowledge-transfer.md`](knowledge-transfer.md).

Where the project stands, and what to pick up next. Written at the end of a long
build/debug session so the next one can start without re-deriving anything.

---

## State: everything builds and runs

| | Status |
|---|---|
| Firmware (`firmware/wearwise-esp32`) | builds warning-clean; flashed to **both** boards |
| Mobile app (`apps/mobile`) | `tsc` clean, lint clean, **104/104 tests pass** |
| Boards | `WearWise-6280` · `WearWise-6F84` |
| Phone | Samsung SM-G977N (over adb), signed in, paired to 6280 |

## What was built this session

1. **Fall detection** (MMA8452Q) — free-fall → impact → stillness state machine, full-screen
   alarm with a 30 s countdown, "I'm OK" cancels (`cancelled`), expiry raises `emergency`.
   Falls persist in `fall_events` (migration v4); History shows a badge, session detail lists them.
   ⚠ **Emergency-contact SMS/push is deliberately STUBBED** — `raiseFallEmergency()` records
   the fall and shows the raised alarm but notifies nobody. That is the next feature.
2. **Generic modular firmware** — refactored into `config/ core/ sensors/ algorithms/
   communication/ utils/`. `SensorManager` scans I²C, verifies **chip IDs** (not just
   addresses), and builds the BLE capability list dynamically. Drivers: MAX30102,
   MAX30205, MMA8452Q, AD8232 (config-gated — it cannot self-identify). Adding a sensor =
   one driver file + one registration line. See `firmware/wearwise-esp32/README.md`.
3. **Accuracy-first HR pipeline** — `algorithms/HRPipeline.{c,h}`, pure sample-clocked C
   (host-testable). 100 Hz, hardware FIFO averaging OFF, DC tracker + 0.5–4 Hz Butterworth,
   adaptive-threshold beat detector with sub-sample peak interpolation, median/MAD IBI
   validation, transition + subharmonic escape, states NO_CONTACT/ACQUIRING/VALID/DEGRADED,
   composite SQI, slow LED AGC. **All tunables in `ww_hr_default_config`**; experimental
   gates marked ⚠ at the top of the .c.
4. **App UI** — per-signal icons on the Live tabs, PPG (wire code 6) added end to end,
   fixed labelled value axes (HR 0–198 with 72/114/156/198 gridlines), time-aware plotting
   for gappy low-rate channels, "—" when a reading is genuinely absent.

## Measured on real hardware (fingertip, 2026-08-28)

- Acquire (contact → HR published): **2.9–6.3 s**. Floor ≈ 3.2 s = 1.2 s settle + the
  3 valid IBIs §15 requires.
- Release (lift-off → readings stop): **< 1 s**.
- Accuracy: **5 of 6 placements** read the true ~88 BPM (cross-checked two ways: accepted
  median IBI and the independent median gap between all detected peaks agreed within 1 BPM).
- Streaming: 100 Hz PPG with **0 gaps** over multi-minute sessions.

## Next up (highest value first)

1. **Raise beat acceptance (~50–70 % today).** This is the root of both the slower
   placements and the occasional half-rate reading — fix it before touching anything else.
   Use the telemetry workflow below; look at the reject histogram and `thr` vs `amp`.
2. **The remaining subharmonic case.** One placement in six read 49 instead of 88. The
   escape logic is now reachable (an anchor-advance bug made it dead code), but it needs
   3 consecutive detected beats, which poor contact denies it.
3. **Emergency-contact notification** for fall events (the stub above).
4. **SpO₂ calibration** — the ratio-of-ratios curve is textbook, uncalibrated.
5. Optional: adaptive settle window (ends when amplitude stabilises) to shave ~0.5 s off
   acquisition. Trades a little robustness; do it after #1.

## How to debug the HR pipeline (this is the method that worked)

No reference device needed for detector work — the PPG waveform IS the measurement:

1. `WW_HR_DEBUG 1` in `config/FirmwareConfig.h` (currently ON) emits one line per
   candidate beat: `HRBEAT,idx,amp,width_ms,thr,noise,peak_ema,pi_pct,dc,sqi,ibi_ms,accepted,reason`
2. Capture over serial while a finger is on (PowerShell `System.IO.Ports.SerialPort` on
   the board's COM port @115200 works; `idf.py monitor` also fine).
3. Read it: reject histogram → which gate to tune; `thr` should sit at **30–40 % of a
   typical beat amplitude**; a tight accepted-IBI cluster means real beats, a 2× cluster
   means harmonic lock.
4. For absolute accuracy, `docs/HRValidation.md` has the reference ladder — the **AD8232
   on the same board** is the best option (electrical, one shared clock), then a manual
   30 s pulse count. No chest strap required.

## Hard-won facts — do not re-learn these

- MAX30102 **OVF_COUNTER (0x05) double-counts** at a 20 ms poll. Untrustworthy; use
  FIFO-near-full at drain time as the starvation signal.
- Contact needs a **fast DC tracker separate from the perfusion DC**, plus hysteresis and
  debounce. The slow DC took ~3 s to see lift-off and had to climb ~700 → ~140 000 on
  placement (which manufactured giant fake beats).
- **Placement transients are ~25× a real beat** (PI 10–24 % vs 0.8–1.8 % for real beats).
  They must be kept out of *both* accepted beats *and* the bootstrap envelope. Hold the
  detector fully **idle** during the settle window — merely rejecting beats there is not
  enough, because with `thr≈0` a single lobe spans the window and is judged after it ends.
- A prominence gate below `thr_frac` is **dead code** (the threshold already filtered it).
- ESP-IDF needs `IDF_TOOLS_PATH=C:\esp\tools` set **before** `export.ps1`, or the Python
  venv is not found.

## Safety / scope

Research prototype. **Not a medical device**; no diagnostic claims. AD8232 ECG is for
education only — run from a **battery/power bank** when electrodes are on a person.
