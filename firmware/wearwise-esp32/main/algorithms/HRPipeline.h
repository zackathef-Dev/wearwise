/* WearWise heart-rate pipeline — accuracy-first PPG processing for the MAX30102.
 *
 * PURE, SAMPLE-CLOCKED C. No ESP-IDF dependencies: the caller pushes one (IR, RED)
 * sample pair per hardware sample tick and the pipeline derives ALL timing from the
 * sample counter (Fs is crystal-driven inside the MAX30102, far more stable than any
 * task-loop timing). That also makes the whole pipeline host-testable.
 *
 * Stages (each documented at its implementation):
 *   raw IR ──► DC tracker ──► band-pass (0.5–4 Hz Butterworth biquads) ──► adaptive
 *   beat detector (state machine + refractory + sub-sample peak interpolation) ──►
 *   IBI validation (physiological bounds → median/MAD outlier gate + transition
 *   persistence) ──► robust HR (60000/medianIBI) ──► adaptive-EMA display value,
 *   published at 1 Hz with an explicit validity state. SpO2 (ratio-of-ratios on
 *   band-passed RMS) and the filtered PPG stream ride the same front end.
 *
 * Design rule (§26 of the spec): validity > speed > smoothness. When quality is bad
 * the pipeline STOPS publishing rather than inventing numbers; the app already
 * renders a missing stream as "—" + empty graph.
 *
 * NOT a medical device. Prototype signal processing for a research wearable.
 */
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "RhythmCheck.h"

/* ---------------- configuration (all tunables live here — §23) ---------------- */

typedef struct {
    /* Sampling */
    float fs_hz;                 /* pipeline sample rate; MUST match sensor config (100) */

    /* DC tracker: 1-pole EMA. alpha 0.004 @100 Hz → fc ≈ alpha·Fs/2π ≈ 0.06 Hz
       (τ ≈ 2.5 s): tracks contact-pressure drift but sits >8× below the 0.5 Hz
       cardiac low edge, so it cannot eat a 30 BPM pulse. */
    float dc_alpha;

    /* Band-pass corners. 0.5 Hz = 30 BPM; 4.0 Hz = 240 BPM fundamental — slightly
       above the 220 BPM operating max so a 220 BPM fundamental isn't attenuated.
       Timing needs the fundamental + upstroke only; harmonics are noise here. */
    float hp_hz, lp_hz;

    /* Physiological bounds (§8) — used for IBI validation, refractory, width. */
    float hr_min_bpm, hr_max_bpm;      /* 30..220 default */
    float refractory_ms;               /* < min IBI @ hr_max (273 ms @220) → 250 */
    float pulse_width_min_ms, pulse_width_max_ms; /* systolic lobe width sanity */

    /* Beat detector */
    float thr_frac;              /* threshold = noise_floor + frac·peak_amp_ema (0.35) */
    float peak_amp_alpha;        /* per-beat EMA of accepted peak amplitude (0.2) */
    float noise_alpha;           /* sub-threshold |x| EMA → noise floor (0.01) */

    /* Quality gates — EXPERIMENTAL: tune on-wrist (marked ⚠ in docs) */
    float dc_contact_min, dc_contact_max;  /* ADC counts: no-contact / near-saturation */
    float clip_level;            /* raw counts treated as clipped (18-bit max 262143) */
    float pi_min_pct;            /* ⚠ min perfusion (AC-RMS/DC·100). Wrist PI is low. */
    float pi_max_pct;            /* ⚠ above this it is a step/motion artifact, not a pulse */

    /* IBI robust filter (§9) */
    int   ibi_window;            /* rolling valid-IBI window, 5..9 (7) */
    float mad_gate;              /* reject if |IBI-med| > gate·(1.4826·MAD) (3.0) */
    float mad_floor_ms;          /* MAD lower clamp so a flat run can't reject all (15) */
    int   transition_beats;      /* consecutive consistent outliers = real change (3) */
    float transition_tol;        /* mutual consistency of those outliers (0.12) */

    /* Output (§12/§13/§15) */
    int   min_valid_beats;       /* IBIs required to leave ACQUIRING (3) */
    float ema_alpha_stable;      /* display EMA, steady state (0.25) */
    float ema_alpha_transition;  /* display EMA right after an accepted transition (0.6) */
    float publish_period_s;      /* display/publish cadence (1.0) — NOT a sensor delay */
    float degraded_hold_s;       /* keep last HR through short dropouts (3.0) */

    /* SpO2 (prototype ratio-of-ratios; ungated → garbage, so it shares the gates) */
    float spo2_min_sqi;          /* publish SpO2 only above this SQI (55) */
    float spo2_alpha;            /* SpO2 display EMA (0.3) */

    /* SQI composite weights (sum 100; motion weight redistributed when unknown) */
    float w_contact, w_perfusion, w_morph, w_ibi, w_clip, w_motion;
} ww_hr_config_t;

/* Defaults per the rationale above. */
void ww_hr_default_config(ww_hr_config_t *cfg);

/* ---------------- output states (§14) ---------------- */
typedef enum {
    WW_HR_NO_CONTACT = 0,   /* DC outside contact window — sensor off skin */
    WW_HR_ACQUIRING,        /* contact OK, collecting first valid beats */
    WW_HR_VALID,            /* publishing with confidence */
    WW_HR_DEGRADED,         /* quality dipped; last HR held (≤ degraded_hold_s) */
} ww_hr_state_t;

/* Rejection reasons (§24) — indices into diag.rejects[]. */
typedef enum {
    WW_REJ_REFRACTORY = 0, WW_REJ_LOW_AMPLITUDE, WW_REJ_BAD_MORPHOLOGY,
    WW_REJ_LOW_SQI, WW_REJ_IBI_OUT_OF_RANGE, WW_REJ_IBI_OUTLIER,
    WW_REJ_SATURATION, WW_REJ_SETTLING, WW_REJ_PROMINENCE, WW_REJ_NO_CONTACT,
    WW_REJ_COUNT,
} ww_hr_reject_t;

typedef struct {
    uint32_t samples;            /* pushed into the pipeline */
    uint32_t beats_detected;     /* peaks confirmed by the detector */
    uint32_t beats_accepted;     /* survived every gate → entered the IBI filter */
    uint32_t rejects[WW_REJ_COUNT];
    uint32_t fifo_overflows;     /* maintained by the acquisition layer */
    uint32_t clipped_samples;
    /* rhythm cross-check (RhythmCheck.h) */
    uint32_t rhythm_relock_half;    /* beat counter was at half rate; corrected   */
    uint32_t rhythm_relock_double;  /* beat counter was at double rate; corrected */
    uint32_t rhythm_overrides;      /* publishes where the rhythm value was used  */
} ww_hr_diag_t;

/* Per-beat tuning telemetry (§22/§24). Emitted once for EVERY candidate lobe with the
   exact inputs the gates judged, plus the verdict. One line per beat (~1.5/s) is a
   negligible UART load — unlike a per-sample dump — and it is the data needed to set
   thresholds from measured distributions instead of guesswork. NULL logger = disabled. */
typedef struct {
    double idx;          /* sample index of the peak apex */
    float  amp;          /* peak amplitude (filtered counts, polarity-corrected) */
    float  width_ms;     /* threshold-crossing width */
    float  thr;          /* adaptive threshold at the time */
    float  noise_floor;
    float  peak_amp_ema; /* amplitude reference the prominence gate used */
    float  pi_pct;       /* perfusion index */
    float  dc;           /* IR DC level */
    float  sqi;
    float  ibi_ms;       /* interval from the previous anchor (0 = none/anchor beat) */
    int    accepted;     /* 1 = entered the IBI filter */
    int    reason;       /* ww_hr_reject_t when accepted == 0 */
} ww_hr_beat_log_t;

/* ---------------- pipeline state (opaque-ish; allocate statically) ---------------- */

typedef struct { float b0, b1, b2, a1, a2, z1, z2; } ww_biquad_t;

#define WW_HR_IBI_MAX 9
#define WW_HR_AMP_RING 8
#define WW_HR_OUT_RING 8
#define WW_HR_PPG_RING 256
#define WW_HR_DBG_RING 256

typedef struct {
    ww_hr_config_t cfg;
    /* front end */
    float dc_ir, dc_red;
    /* Fast-tracking optical level used ONLY for contact decisions (~0.2 s). The slow
       dc_ir must stay slow (it is the perfusion denominator and must not follow the
       pulse), but using it for contact meant a lift-off took ~3 s to notice. */
    float dc_fast;
    ww_biquad_t hp_ir, lp_ir, hp_red, lp_red;
    bool seeded;
    bool contact_flag;           /* per-sample contact state (drives instant re-arm) */
    int  contact_debounce;       /* consecutive samples agreeing with a pending edge */
    double settle_until;         /* sample index until which beats are ignored (AGC step,
                                    re-contact). Double: float loses sample precision past
                                    2^24 samples (~46 h of continuous wear). */
    /* polarity: +1 if systolic peak is a positive excursion of the filtered signal.
       Auto-detected while ACQUIRING (larger extreme side), locked once VALID. */
    float pol, pos_ema, neg_ema;
    /* detector */
    int   det_state;             /* 0 search / 1 in-peak / 2 refractory */
    float thr, noise_floor, peak_amp_ema;
    float cand_max; double cand_max_idx;
    float prev1, prev2;          /* last two filtered samples (sub-sample interp) */
    double rise_idx, fall_idx;   /* threshold up-crossing / down-crossing of the lobe */
    double last_lobe_idx;        /* sample index of the last completed lobe */
    double last_accept_idx;      /* sample index of the last ACCEPTED beat (EMA decay) */
    double last_beat_idx;        /* sample index of previous accepted beat */
    bool  have_last_beat;
    /* IBI filter */
    float ibi[WW_HR_IBI_MAX]; int ibi_n, ibi_head;
    float pend[4]; int pend_n;   /* candidate-transition outliers */
    float half_pend[4]; int half_n; /* consecutive ~half-median intervals (subharmonic escape) */
    /* amplitude morphology ring */
    float amps[WW_HR_AMP_RING]; int amp_n, amp_head;
    /* AC RMS trackers (for PI + SpO2), EMA of x² */
    float ir_ac_pow, red_ac_pow;
    /* clipping window counter */
    uint32_t clip_recent;
    /* HR estimate */
    float hr_robust, hr_display; bool hr_seeded;
    double last_good_idx;        /* sample index of last accepted beat (dropout timer) */
    int   valid_streak;
    float transition_boost;      /* >0 → use transition alpha for next updates */
    /* SpO2 */
    float spo2_display; bool spo2_seeded;
    /* published state */
    ww_hr_state_t state;
    float sqi;
    float motion_g;              /* <0 = unknown (no accelerometer feed) */
    double motion_at_idx;        /* sample index of the last motion report (staleness) */
    /* sample clock */
    double idx;                  /* absolute sample index (double: exact to 2^53) */
    double next_publish_idx;
    /* output rings (wire values, drained by the sensor layer) */
    float out_hr[WW_HR_OUT_RING];   int hr_head, hr_count;
    float out_spo2[WW_HR_OUT_RING]; int spo2_head, spo2_count;
    float out_ppg[WW_HR_PPG_RING];  int ppg_head, ppg_count;
    /* raw preservation for offline debugging (§2): last N samples */
    float dbg_raw[WW_HR_DBG_RING], dbg_filt[WW_HR_DBG_RING]; int dbg_head;
    ww_hr_diag_t diag;
    void (*beat_log)(const ww_hr_beat_log_t *);   /* NULL = off */
    /* rhythm cross-check: an independent HR from the PPG's periodicity */
    ww_rhythm_t rhythm;
    float rhythm_bpm, rhythm_strength;
    bool rhythm_ready, rhythm_override;
    int rhythm_harm_streak, rhythm_dis_streak;
} ww_hr_t;

/* ---------------- API ---------------- */

void ww_hr_init(ww_hr_t *p, const ww_hr_config_t *cfg_or_null);

/* Push ONE sample pair (raw 18-bit counts). Call at the sensor sample rate. */
void ww_hr_push(ww_hr_t *p, uint32_t ir_raw, uint32_t red_raw);

/* Optional motion feed: RMS-ish deviation of |a| from 1 g (g units). Pass whenever
   accelerometer data is available; pipeline treats "never called" as unknown. */
void ww_hr_set_motion(ww_hr_t *p, float g_dev);

void ww_hr_set_beat_logger(ww_hr_t *p, void (*fn)(const ww_hr_beat_log_t *));

/* Acquisition layer notifications. */
void ww_hr_note_overflow(ww_hr_t *p, uint32_t n);
void ww_hr_note_led_change(ww_hr_t *p);   /* AGC stepped an LED → settle window */

/* Introspection. */
ww_hr_state_t ww_hr_state(const ww_hr_t *p);
float ww_hr_sqi(const ww_hr_t *p);
float ww_hr_display(const ww_hr_t *p);    /* float BPM (NaN-free; check state) */
float ww_hr_dc_ir(const ww_hr_t *p);      /* for the AGC */
float ww_hr_rhythm_bpm(const ww_hr_t *p); /* rhythm cross-check estimate (0 = none) */
float ww_hr_rhythm_strength(const ww_hr_t *p);
const ww_hr_diag_t *ww_hr_diag(const ww_hr_t *p);

/* Drain wire outputs (physical units: BPM / % / counts). Return count written. */
uint16_t ww_hr_drain_hr(ww_hr_t *p, float *out, uint16_t max);
uint16_t ww_hr_drain_spo2(ww_hr_t *p, float *out, uint16_t max);
uint16_t ww_hr_drain_ppg(ww_hr_t *p, float *out, uint16_t max);

/* Discard queued output samples (session start) without touching analysis state. */
void ww_hr_flush_outputs(ww_hr_t *p);
