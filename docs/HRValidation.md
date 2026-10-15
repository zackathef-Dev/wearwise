# WearWise heart-rate validation procedure

How to judge whether the MAX30102 HR pipeline is *accurate*, not merely *stable*.
The pipeline is a research prototype — **not a medical device** — and every claim
about its accuracy must come from this procedure, never from "the number looks steady".

## No chest strap? Use this ladder instead

Most tuning does **not** need an external reference at all, because the two questions are
different:

**Q1 — "Is the detector finding the beats that are in the signal?"** *(needs no reference)*
The PPG waveform IS the measurement; the detector is what's under test. Build with
`WW_HR_DEBUG=1` and capture the per-beat telemetry (below): if the accepted IBI series
clusters tightly (e.g. 600–700 ms) it is tracking real beats; if it clusters at ~2× that,
the detector is missing every other beat and has locked onto the **subharmonic** — a bug,
provable from the device's own data. This is how the pipeline was tuned from 45 % → 77 %
beat acceptance and from a false ~47 BPM subharmonic to a correct ~92 BPM.

**Q2 — "Is the reported BPM the true BPM?"** *(needs a reference)* In order of preference:

1. **The AD8232 on this same board — the best option, and no extra hardware.** It is an
   ELECTRICAL reference (like a chest strap) sharing one device clock, so R-peak vs
   PPG-beat comparison has no clock-sync error. Wire the electrodes, run ECG (250 Hz) and
   PPG (100 Hz) in one session, and compare R-peak intervals to accepted IBIs.
   **Battery/power-bank only when electrodes are on a person.**
2. **Manual pulse count.** Count your radial or carotid pulse for 30 s and double it, three
   times, while the device is reading. Accurate to roughly ±2–4 BPM at rest — genuinely
   good enough to catch a subharmonic (a 2× error is unmissable) or a large bias. Free.
3. **A fingertip pulse oximeter**, if one is to hand. Optical like ours, so it can share an
   artifact — adequate for a rest-HR sanity check, not for motion scenarios.
4. Chest strap (Polar H10 etc.) if one is ever available — still the convenient gold
   standard for the walking/running scenarios below.

Wrist-optical vs wrist-optical comparison remains unacceptable: two such devices can share
the same artifact and agree while both are wrong.

## Per-beat telemetry (the primary tuning tool)

`WW_HR_DEBUG=1` emits one line per CANDIDATE beat (~1.5/s — safe for the UART, unlike a
100 Hz sample dump which would block acquisition):

```
HRBEAT,idx,amp,width_ms,thr,noise,peak_ema,pi_pct,dc,sqi,ibi_ms,accepted,reason
```

Capture it (`idf.py -p COMx monitor`, or a serial logger) and check, in order:
- **`reason` histogram** — which gate rejects most? That is the one to tune.
- **`thr` vs `amp`** — the threshold should sit near **30–40 %** of a typical beat
  amplitude. Much higher and real beats are invisible (the failure found on hardware).
- **accepted `ibi_ms` spread** — tight cluster = tracking real beats; a cluster at 2× or
  0.5× the expected interval = harmonic lock.
- **`dc`** — on-skin is ~10⁵ counts here; ~700 counts is dark current (nothing on the sensor).

## Data capture

1. Build the firmware with validation output:
   set `WW_HR_DEBUG 1` in `FirmwareConfig.h` and rebuild (`idf.py build -D…` does not reach the C code).
2. Capture the UART at 115200: every 4th sample emits
   `HRCSV,idx,rawIR,dc,filteredPPG,threshold,state,SQI,robustHR,displayHR`
   (idx → seconds = idx / 100). Save to a file
   (`idf.py -p COMx monitor | tee run1.csv`, or a serial logger).
3. Record the reference device's HR export with wall-clock timestamps.
4. Synchronize: at the start of each session do 3 sharp wrist taps (visible as spikes
   in `filteredPPG`) while marking the reference timeline — align on those.

## Test scenarios (≥ 2 minutes each, ≥ 3 different people, both loose & snug strap)

| # | Scenario |
|---|---|
| 1 | Sitting still |
| 2 | Standing still |
| 3 | Walking (comfortable pace) |
| 4 | Slow run |
| 5 | Faster run |
| 6 | Arm waving WITHOUT HR change (seated) |
| 7 | Wrist flexing / typing |
| 8 | Rest → exercise transition |
| 9 | Exercise → recovery transition |
| 10 | Deliberately loose strap |

## Metrics (compute per scenario AND pooled; rest / walk / exercise / transitions separately)

With paired samples (device HR `d_i`, reference `r_i`, matched by time, only where
the device reports VALID or DEGRADED):

- **MAE** = mean |d−r| (BPM)
- **RMSE** = √(mean (d−r)²)
- **Bias** = mean (d−r)
- **95 % limits of agreement** = bias ± 1.96·SD(d−r)  (Bland-Altman; also plot d−r vs (d+r)/2)
- **% within ±5 BPM**, **% within ±10 BPM**
- **Availability** = time in VALID ∕ total contact time (report DEGRADED separately)

A stable wrong value must count *against* the device: never exclude segments because
"the reference was changing" — transitions are exactly what §11 must track.

## What to tune, in order (all in `HRPipeline.c` / `ww_hr_default_config`)

| Parameter | Symptom it addresses |
|---|---|
| `pi_min_pct` ⚠ | valid beats rejected on wrist (too high) / noise accepted (too low) |
| `dc_contact_min/max` ⚠ | NO_CONTACT flapping, or off-skin readings |
| `SQI_ACCEPT_MIN`, `SQI_VALID_MIN` ⚠ | availability vs accuracy trade |
| `thr_frac` | missed small beats vs double-detections |
| `mad_gate`, `transition_beats` | HR transitions tracked too slowly vs outliers leaking |
| AGC targets (`AGC_DC_LO/HI`) | chronic clipping or weak signal per skin tone/strap |

Tune across *multiple* people and recordings — never against one trace.

## Acceptance guidance (typical consumer-wearable ballpark, not a claim)

Rest: MAE < 3 BPM, ≥ 90 % within ±5 BPM. Walking: MAE < 5 BPM. Exercise: MAE < 8 BPM
with availability > 80 %. If a scenario misses these, tune per the table and re-run —
do not "fix" it by increasing display smoothing (§26: validity > speed > smoothness).
