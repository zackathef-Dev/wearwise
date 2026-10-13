/* WearWise firmware build/feature configuration.
 *
 * Feature flags and build "profiles" live here so one codebase serves every board.
 * A profile is just a convenience preset that turns feature flags on/off. Change flags
 * by editing this file: `idf.py build -DWW_...` only sets a CMake variable, and the
 * build does not pass it on to the C compiler.
 */
#pragma once

#define WW_FW_VERSION "0.9.6"

/* ---- Debug ---- */
#ifndef WW_DEBUG
#define WW_DEBUG 1               /* 1 = verbose startup + scan logs on UART @115200 */
#endif

/* ---- Build profiles (§23). Select ONE; it sets the flags below if you don't. ----
 *   A: MAX30102 + MAX30205         B: AD8232 + MMA8452Q
 *   C: all four                    D: no sensors (still boots + advertises)
 * Auto-detection means the I2C flags are advisory — a driver only activates if its
 * chip is actually found on the bus. AD8232 is NOT auto-detectable, so its flag is a
 * real on/off switch. */
#ifndef WW_PROFILE
#define WW_PROFILE 'C'
#endif

/* ---- I2C sensor drivers to consider during a bus scan (auto-detect gates them) ---- */
#ifndef WW_ENABLE_MAX30102
#define WW_ENABLE_MAX30102 (WW_PROFILE=='A' || WW_PROFILE=='C')
#endif
#ifndef WW_ENABLE_MAX30205
#define WW_ENABLE_MAX30205 (WW_PROFILE=='A' || WW_PROFILE=='C')
#endif
#ifndef WW_ENABLE_MMA8452Q
#define WW_ENABLE_MMA8452Q (WW_PROFILE=='B' || WW_PROFILE=='C')
#endif

/* ---- AD8232: analog, cannot self-identify — must be declared present (§6) ---- */
#ifndef WW_ENABLE_AD8232
#define WW_ENABLE_AD8232 (WW_PROFILE=='B' || WW_PROFILE=='C')
#endif
/* Check at boot that an AD8232 is really fitted (its lead-off pins are driven). Set to 0
   for a module wired without LO+/LO-, which would otherwise read as absent. */
#ifndef WW_AD8232_DETECT
#define WW_AD8232_DETECT 1
#endif
#ifndef WW_ECG_SAMPLE_RATE_HZ
#define WW_ECG_SAMPLE_RATE_HZ 250   /* default ECG prototype rate (§6) */
#endif

/* ---- Simulation fallback ----
 * OFF for a real-hardware build: a board with no detected sensors advertises an empty
 * capability list (Profile D). Turn ON (or use Profile 'S') to register a synthetic
 * "sensor" that streams the same 5 signals the app's own simulation does — handy for
 * exercising the app with no hardware attached. The working simulation code is kept
 * (sensors/signals.c), never deleted. */
#ifndef WW_SIM_FALLBACK
#define WW_SIM_FALLBACK (WW_PROFILE=='S')
#endif

/* ---- Streaming ---- */
#define WW_BURST_MS 200            /* per-sensor packet cadence (unchanged from v0.6) */
#define WW_STREAM_TICK_MS 20       /* acquisition tick: sensors are polled 50x/s, packets
                                      still flush every WW_BURST_MS. Decouples a 250 Hz ECG
                                      or 50 Hz accel from the slower BLE flush. */

/* ---- Motion / fall detection ---- */
#ifndef WW_ENABLE_FALL_DETECTION
#define WW_ENABLE_FALL_DETECTION 1 /* on-device "possible fall" flag from accel magnitude */
#endif

/* ---- HR pipeline validation mode (§22) ----
 * WW_HR_DEBUG=1 emits one "HRBEAT,..." line per candidate beat (~1.5/s) carrying the
 * exact values every gate judged plus the verdict — the data needed to set thresholds
 * from measured distributions. Per-beat, NOT per-sample: a 100 Hz dump would spend
 * ~50% of the CPU in blocking UART writes and risk FIFO overflow (§20).
 * See docs/HRValidation.md. Keep 0 for production builds. */
#ifndef WW_HR_DEBUG
#define WW_HR_DEBUG 0
#endif
