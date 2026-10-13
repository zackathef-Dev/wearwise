#include "HRPipeline.h"
#include <math.h>
#include <string.h>

/* ============================ EXPERIMENTAL GATES =============================
 * The one place non-config gates live. Marked ⚠ = must be tuned on-wrist against
 * a reference monitor (see docs/HRValidation.md); everything else derives from
 * physiology or filter math. */
#define SQI_ACCEPT_MIN   30.0f   /* ⚠ beats below this composite SQI are rejected */
#define SQI_VALID_MIN    45.0f   /* ⚠ publish state VALID only above this */
/* Beat silence tolerated while still VALID. At ~92 BPM with ~78% of beats accepted,
   a run of 2-3 rejected beats is routine and produces a ~2.5 s gap — at 1.5 s the
   state flapped VALID->ACQUIRING constantly and the reading blanked between bursts
   even at SQI 100. A missed beat does NOT invalidate the rhythm: the median IBI is
   unchanged, so holding VALID across a few of them is the honest call. */
#define DROPOUT_VALID_S   3.5f

/* Rhythm cross-check policy (see RhythmCheck.h). Periodicity strength r is the
   normalised autocorrelation at the detected period. Measured on synthetic PPG: regular
   rhythms score >= 0.95 (noisy ~0.77), irregular (AF-like) rhythms up to ~0.87, noise
   < 0.4. So the check only ever CORRECTS the beat counter when the pulse repeats very
   clearly, and the disagreement persists — an irregular rhythm is left to the beat
   counter (whose median IBI is the right estimate for it), never "regularised". */
#define RC_AGREE_TOL      0.12f   /* beats within ±12% of the rhythm = confirmed        */
#define RC_RELOCK_MIN     0.85f   /* exact half/double + this strength = miscount        */
#define RC_OVERRIDE_MIN   0.90f   /* other disagreement: publish the rhythm value only   */
#define RC_PERSIST        2       /* consecutive 1 Hz checks before acting              */
#define STARTUP_SETTLE_S  2.0f   /* filter warm-up: biquad transients die out */

/* ---------------- small helpers ---------------- */

static float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

static void ring_pushf(float *ring, int cap, int *head, int *count, float v) {
    ring[*head] = v;
    *head = (*head + 1) % cap;
    if (*count < cap) (*count)++;
}
static uint16_t ring_drainf(float *ring, int cap, int *head, int *count, float *out, uint16_t max) {
    uint16_t n = 0;
    while (*count > 0 && n < max) {
        int tail = (*head - *count + cap) % cap;
        out[n++] = ring[tail];
        (*count)--;
    }
    return n;
}

/* median of up to 9 floats (insertion sort on a copy — n is tiny) */
static float medianf(const float *src, int n) {
    float a[WW_HR_IBI_MAX];
    for (int i = 0; i < n; i++) a[i] = src[i];
    for (int i = 1; i < n; i++) {
        float v = a[i];
        int j = i - 1;
        while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
        a[j + 1] = v;
    }
    return (n & 1) ? a[n / 2] : 0.5f * (a[n / 2 - 1] + a[n / 2]);
}
/* median absolute deviation about med (robust scale; ×1.4826 ≈ σ for Gaussian) */
static float madf(const float *src, int n, float med) {
    float d[WW_HR_IBI_MAX];
    for (int i = 0; i < n; i++) d[i] = fabsf(src[i] - med);
    return medianf(d, n);
}

/* RBJ audio-cookbook biquads, Q = 1/√2 (Butterworth). Direct Form II transposed. */
static void biquad_hp(ww_biquad_t *f, float fc, float fs) {
    float w = 2.0f * (float)M_PI * fc / fs;
    float c = cosf(w), al = sinf(w) / (2.0f * 0.70710678f);
    float a0 = 1 + al;
    f->b0 = (1 + c) / 2 / a0; f->b1 = -(1 + c) / a0; f->b2 = (1 + c) / 2 / a0;
    f->a1 = (-2 * c) / a0;    f->a2 = (1 - al) / a0;
    f->z1 = f->z2 = 0;
}
static void biquad_lp(ww_biquad_t *f, float fc, float fs) {
    float w = 2.0f * (float)M_PI * fc / fs;
    float c = cosf(w), al = sinf(w) / (2.0f * 0.70710678f);
    float a0 = 1 + al;
    f->b0 = (1 - c) / 2 / a0; f->b1 = (1 - c) / a0; f->b2 = (1 - c) / 2 / a0;
    f->a1 = (-2 * c) / a0;    f->a2 = (1 - al) / a0;
    f->z1 = f->z2 = 0;
}
static float biquad_run(ww_biquad_t *f, float x) {
    float y = f->b0 * x + f->z1;
    f->z1 = f->b1 * x - f->a1 * y + f->z2;
    f->z2 = f->b2 * x - f->a2 * y;
    return y;
}

/* ---------------- configuration ---------------- */

void ww_hr_default_config(ww_hr_config_t *c) {
    memset(c, 0, sizeof *c);
    c->fs_hz = 100.0f;
    c->dc_alpha = 0.004f;            /* fc ≈ 0.06 Hz, τ ≈ 2.5 s — see header */
    c->hp_hz = 0.5f;                 /* 30 BPM low edge */
    c->lp_hz = 4.0f;                 /* 240 BPM fundamental headroom */
    c->hr_min_bpm = 30.0f;
    c->hr_max_bpm = 220.0f;
    c->refractory_ms = 250.0f;       /* < 273 ms (IBI @ 220 BPM) */
    c->pulse_width_min_ms = 50.0f;   /* narrower = spike/noise, wider = drift, not a pulse.
                                        Measured between threshold crossings; a systolic
                                        lobe runs ~150 ms (fast HR) to ~400 ms (slow). */
    c->pulse_width_max_ms = 600.0f;  /* ⚠ tune on-wrist */
    c->thr_frac = 0.30f;             /* ⚠ fraction of the recent peak amplitude. Lower =
                                        catches weaker beats (wrist/low perfusion), higher
                                        = more selective. 0.30 chosen on-hardware. */
    c->peak_amp_alpha = 0.2f;
    c->noise_alpha = 0.01f;
    c->dc_contact_min = 8000.0f;     /* ⚠ below = off-skin (dark current territory) */
    c->dc_contact_max = 250000.0f;   /* near the 18-bit ceiling (262143) */
    c->clip_level = 258000.0f;
    c->pi_min_pct = 0.03f;           /* ⚠ wrist PI is far lower than fingertip */
    c->pi_max_pct = 5.0f;            /* ⚠ real fingertip beats measured 0.8-1.8% here;
                                        placement transients hit 10-24%. 5% sits well
                                        clear of physiology and still rejects artifacts
                                        (one measured 9.87% and slipped past a 10% gate). */
    c->ibi_window = 7;
    c->mad_gate = 3.0f;
    c->mad_floor_ms = 15.0f;         /* a rock-steady rhythm must not reject everything */
    c->transition_beats = 3;         /* §11: sustained change accepted after 3 beats */
    c->transition_tol = 0.12f;
    c->min_valid_beats = 3;          /* §15 */
    c->ema_alpha_stable = 0.25f;
    c->ema_alpha_transition = 0.6f;
    c->publish_period_s = 1.0f;      /* §13: display cadence, not a sensor delay */
    c->degraded_hold_s = 8.0f;       /* §14: hold the last HR (flagged DEGRADED) through a
                                        dropout, then stop presenting it. 8 s ≈ 12 beats:
                                        long enough to ride out a shifting finger without
                                        blanking, short enough that a removed sensor or a
                                        genuinely lost pulse stops reporting quickly. */
    c->spo2_min_sqi = 55.0f;
    c->spo2_alpha = 0.3f;
    c->w_contact = 20; c->w_perfusion = 20; c->w_morph = 20;
    c->w_ibi = 20; c->w_clip = 10; c->w_motion = 10;
}

void ww_hr_init(ww_hr_t *p, const ww_hr_config_t *cfg) {
    memset(p, 0, sizeof *p);
    if (cfg) p->cfg = *cfg;
    else ww_hr_default_config(&p->cfg);
    biquad_hp(&p->hp_ir, p->cfg.hp_hz, p->cfg.fs_hz);
    biquad_lp(&p->lp_ir, p->cfg.lp_hz, p->cfg.fs_hz);
    biquad_hp(&p->hp_red, p->cfg.hp_hz, p->cfg.fs_hz);
    biquad_lp(&p->lp_red, p->cfg.lp_hz, p->cfg.fs_hz);
    /* Validate ranges so a config typo cannot silently disable a mechanism
       (pend[] is capped at 4; the IBI ring at WW_HR_IBI_MAX). */
    if (p->cfg.transition_beats < 2) p->cfg.transition_beats = 2;
    if (p->cfg.transition_beats > 4) p->cfg.transition_beats = 4;
    if (p->cfg.ibi_window < 3) p->cfg.ibi_window = 3;
    if (p->cfg.ibi_window > WW_HR_IBI_MAX) p->cfg.ibi_window = WW_HR_IBI_MAX;
    p->pol = 1.0f;
    p->motion_g = -1.0f;                       /* unknown until fed */
    p->settle_until = STARTUP_SETTLE_S * p->cfg.fs_hz;
    p->next_publish_idx = p->cfg.publish_period_s * p->cfg.fs_hz;
    p->state = WW_HR_NO_CONTACT;
}

void ww_hr_set_motion(ww_hr_t *p, float g_dev) { p->motion_g = g_dev; p->motion_at_idx = p->idx; }
void ww_hr_set_beat_logger(ww_hr_t *p, void (*fn)(const ww_hr_beat_log_t *)) { p->beat_log = fn; }

/* Emit one tuning record for a candidate lobe. Cheap: only when a logger is attached. */
static void beat_report(ww_hr_t *p, double idx, float amp, float width_ms, float ibi_ms,
                        int accepted, int reason) {
    if (!p->beat_log) return;
    ww_hr_beat_log_t r = {
        .idx = idx, .amp = amp, .width_ms = width_ms, .thr = p->thr,
        .noise_floor = p->noise_floor, .peak_amp_ema = p->peak_amp_ema,
        .pi_pct = (p->dc_ir > 1) ? 100.0f * sqrtf(p->ir_ac_pow) / p->dc_ir : 0.0f,
        .dc = p->dc_fast, .sqi = p->sqi, .ibi_ms = ibi_ms,   /* fast tracker: this is the
            level contact decisions are actually made on, so telemetry must show it */
        .accepted = accepted, .reason = reason,
    };
    p->beat_log(&r);
}
void ww_hr_note_overflow(ww_hr_t *p, uint32_t n) { p->diag.fifo_overflows += n; }

/* An LED-current step moves the optical operating point; the DC tracker needs to
   re-converge before amplitudes mean anything. Beats inside the window are
   rejected (SETTLING) and the DC EMA runs 10× faster to re-seat quickly. */
void ww_hr_note_led_change(ww_hr_t *p) {
    /* 0.25 s, not 0.6: a single-LSB LED step shifts the optical DC by a few percent and
       the (faster, in-settle) DC tracker absorbs it quickly. The long window was costing
       real acquisition time every time the AGC nudged the current. */
    double until = p->idx + 0.25 * p->cfg.fs_hz;
    if (until > p->settle_until) p->settle_until = until;
}

/* ---------------- SQI (§5): several independent factors, 0..100 ---------------- */

static float sqi_compute(ww_hr_t *p) {
    const ww_hr_config_t *c = &p->cfg;
    float wsum = 0, acc = 0;

    /* A. contact: comfortable DC band scores 100, tapering to 0 at the hard bounds */
    {
        float lo = c->dc_contact_min, hi = c->dc_contact_max;
        float s;
        if (p->dc_ir <= lo || p->dc_ir >= hi) s = 0;
        else if (p->dc_ir < 2 * lo) s = 100.0f * (p->dc_ir - lo) / lo;
        else if (p->dc_ir > 0.8f * hi) s = 100.0f * (hi - p->dc_ir) / (0.2f * hi);
        else s = 100;
        acc += c->w_contact * s; wsum += c->w_contact;
    }
    /* B. perfusion: AC-RMS/DC as % — 0 at pi_min, full credit at 4×pi_min */
    {
        float pi = (p->dc_ir > 1) ? 100.0f * sqrtf(p->ir_ac_pow) / p->dc_ir : 0;
        float s = 100.0f * clamp01((pi - c->pi_min_pct) / (3.0f * c->pi_min_pct));
        acc += c->w_perfusion * s; wsum += c->w_perfusion;
    }
    /* C. morphology: coefficient of variation of recent accepted peak amplitudes */
    if (p->amp_n >= 3) {
        float mean = 0;
        for (int i = 0; i < p->amp_n; i++) mean += p->amps[i];
        mean /= p->amp_n;
        float var = 0;
        for (int i = 0; i < p->amp_n; i++) { float d = p->amps[i] - mean; var += d * d; }
        float cv = (mean > 1e-6f) ? sqrtf(var / p->amp_n) / mean : 1.0f;
        float s = 100.0f * clamp01(1.0f - cv / 0.5f);
        acc += c->w_morph * s; wsum += c->w_morph;
    }
    /* D. inter-beat consistency: normalized robust spread of the IBI window */
    if (p->ibi_n >= 3) {
        float med = medianf(p->ibi, p->ibi_n);
        float r = (med > 1) ? 1.4826f * madf(p->ibi, p->ibi_n, med) / med : 1.0f;
        float s = 100.0f * clamp01(1.0f - r / 0.3f);
        acc += c->w_ibi * s; wsum += c->w_ibi;
    }
    /* E. clipping: leaky count of near-ceiling samples */
    {
        float s = (p->clip_recent == 0) ? 100.0f : (p->clip_recent >= 10 ? 0.0f : 100.0f - 10.0f * p->clip_recent);
        acc += c->w_clip * s; wsum += c->w_clip;
    }
    /* F. motion: only when an accelerometer feed is CURRENT — a value older than
       2 s is stale (accel streaming stopped) and must not vouch for stillness */
    if (p->motion_g >= 0 && p->idx - p->motion_at_idx <= 2.0 * c->fs_hz) {
        float s = 100.0f * clamp01(1.0f - (p->motion_g - 0.03f) / 0.27f);
        acc += c->w_motion * s; wsum += c->w_motion;
    }
    return (wsum > 0) ? acc / wsum : 0;
}

/* ---------------- beat acceptance (IBI path, §7–§11) ---------------- */

static void ibi_push(ww_hr_t *p, float ibi) {
    ring_pushf(p->ibi, p->cfg.ibi_window, &p->ibi_head, &p->ibi_n, ibi);
}

static void accept_beat(ww_hr_t *p, double t_idx, float amp, float ibi_ms) {
    const ww_hr_config_t *c = &p->cfg;
    if (ibi_ms > 0) ibi_push(p, ibi_ms);
    ring_pushf(p->amps, WW_HR_AMP_RING, &p->amp_head, &p->amp_n, amp);
    p->last_beat_idx = t_idx;
    p->have_last_beat = true;
    p->last_good_idx = t_idx;
    p->last_accept_idx = t_idx;
    p->valid_streak++;
    p->diag.beats_accepted++;
    if (p->ibi_n >= 1) {
        p->hr_robust = 60000.0f / medianf(p->ibi, p->ibi_n);   /* §10: HR from IBIs */
        if (!p->hr_seeded) {
            if (p->valid_streak >= c->min_valid_beats) {   /* §15: N valid IBIs first
                (valid_streak increments once per ACCEPTED IBI — the anchor beat
                 doesn't count, so no +1 here) */
                p->hr_display = p->hr_robust;
                p->hr_seeded = true;
                /* Publish the first reading at once rather than waiting up to a full
                   period for the next tick — the estimate is already earned. */
                p->next_publish_idx = p->idx;
            }
        } else {
            float a = (p->transition_boost > 0) ? c->ema_alpha_transition : c->ema_alpha_stable;
            p->hr_display += a * (p->hr_robust - p->hr_display);
            if (p->transition_boost > 0) p->transition_boost -= 1.0f;
        }
    }
}

/* A morphologically confirmed peak arrives here; every gate names its reason (§24). */
/* Log-and-return helper so every rejection path reports identically. */
#define REJECT(reason_) do { p->diag.rejects[(reason_)]++; \
    beat_report(p, t_idx, amp, width_ms, 0, 0, (reason_)); return; } while (0)

static void on_peak(ww_hr_t *p, double t_idx, float amp, float width_ms) {
    const ww_hr_config_t *c = &p->cfg;
    p->diag.beats_detected++;

    if (p->idx < p->settle_until)        REJECT(WW_REJ_SETTLING);
    if (p->clip_recent >= 10)            REJECT(WW_REJ_SATURATION);

    /* Contact gate: off-skin "beats" are ambient/electronic noise. Without this,
       noise intervals seed the IBI ring before a finger ever lands (observed on
       hardware: det/acc > 0 in NO_CONTACT). DC bounds are instantaneous — do not
       wait for the 1 Hz state machine. */
    if (!p->contact_flag) REJECT(WW_REJ_NO_CONTACT);   /* fast-tracked contact state */

    float pi = (p->dc_ir > 1) ? 100.0f * sqrtf(p->ir_ac_pow) / p->dc_ir : 0;
    if (pi < c->pi_min_pct)              REJECT(WW_REJ_LOW_AMPLITUDE);
    /* Upper perfusion bound: a real PPG pulse is a small ripple on a large DC (a few
       percent at most). Anything larger is a step or motion artifact, not blood volume —
       observed at 15-24% during finger placement. Rejecting these keeps a transient from
       ever capturing the amplitude reference. */
    if (pi > c->pi_max_pct)              REJECT(WW_REJ_BAD_MORPHOLOGY);
    if (width_ms < c->pulse_width_min_ms || width_ms > c->pulse_width_max_ms)
        REJECT(WW_REJ_BAD_MORPHOLOGY);
    /* Prominence: a secondary lobe (dicrotic wave, small artifact) rides well below
       the systolic amplitude — reject it WITHOUT moving the beat anchor, so it can
       neither count as a beat nor corrupt the next genuine interval.
       SELF-CORRECTING: a rejected lobe still pulls the reference DOWN. Otherwise one
       oversized transient (e.g. the step when a finger lands) pins the reference high
       and every real beat is rejected forever — a one-way ratchet, since a rejected
       beat used to leave the reference untouched. Pulling down means a sustained
       train of smaller-but-real beats reclaims the reference within ~20 beats. */
    /* NOTE: an explicit prominence gate used to sit here. It was dead code — its
       fraction (0.25) was below thr_frac (0.30), so any lobe that crossed the adaptive
       threshold had already cleared it. Raising it instead would re-reject the naturally
       weaker alternate beats that caused half-rate lock. The adaptive threshold IS the
       prominence test; dicrotic notches are handled by it plus the refractory and IBI
       bounds. The amplitude reference is kept honest by its idle decay below. */
    p->sqi = sqi_compute(p);
    if (p->sqi < SQI_ACCEPT_MIN)         REJECT(WW_REJ_LOW_SQI);

    /* Amplitude reference adapts ONLY from beats that passed every gate above —
       an off-wrist transient can no longer poison the adaptive threshold. */
    p->peak_amp_ema += c->peak_amp_alpha * (amp - p->peak_amp_ema);

    if (!p->have_last_beat) {            /* first beat only anchors the clock */
        p->last_beat_idx = t_idx;
        p->have_last_beat = true;
        p->last_good_idx = t_idx;
        beat_report(p, t_idx, amp, width_ms, 0, 1, -1);   /* anchor */
        return;
    }

    float ibi = (float)((t_idx - p->last_beat_idx) * 1000.0 / c->fs_hz);
    float ibi_min = 60000.0f / c->hr_max_bpm, ibi_max = 60000.0f / c->hr_min_bpm;

    if (ibi < ibi_min) {                 /* faster than 220 BPM ⇒ double-detection:
                                            keep the previous anchor so the NEXT real
                                            peak still forms a correct interval */
        p->diag.rejects[WW_REJ_IBI_OUT_OF_RANGE]++;
        beat_report(p, t_idx, amp, width_ms, ibi, 0, WW_REJ_IBI_OUT_OF_RANGE);
        return;
    }
    if (ibi > ibi_max) {                 /* slower than 30 BPM ⇒ we missed beats:
                                            restart interval timing from this beat */
        p->diag.rejects[WW_REJ_IBI_OUT_OF_RANGE]++;
        beat_report(p, t_idx, amp, width_ms, ibi, 0, WW_REJ_IBI_OUT_OF_RANGE);
        p->last_beat_idx = t_idx;
        p->valid_streak = 0;
        return;
    }

    /* §9 robust outlier gate + §11 transition persistence */
    if (p->ibi_n >= 3) {
        float med = medianf(p->ibi, p->ibi_n);
        /* HARMONIC GUARD: an interval ≈2× the median is a missed beat (a real beat
           failed a gate in between) and ≈0.5× is a double-detection. Neither may
           enter the transition path — chains of them would otherwise be accepted
           as a confident half/double-rate "transition". */
        float ratio = ibi / med;
        if (ratio > 1.7f && ratio < 2.4f) {          /* missed beat: this peak is real */
            p->diag.rejects[WW_REJ_IBI_OUTLIER]++;
            beat_report(p, t_idx, amp, width_ms, ibi, 0, WW_REJ_IBI_OUTLIER);
            p->last_beat_idx = t_idx;                /* re-anchor; don't pend */
            return;
        }
        if (ratio > 0.38f && ratio < 0.62f) {
            /* Half the current median. Usually a double-detection of one pulse — but if
               it keeps happening, the truth is the opposite: WE are locked on a
               subharmonic (every other beat) and these are the real beats. Without this
               escape the lock is self-sealing: each true beat looks like an outlier and
               is discarded, which is exactly how a ~90 BPM pulse gets reported as ~45.
               Consistent half-intervals in a row re-lock onto the faster, true rate. */
            bool chains = p->half_n > 0 &&
                fabsf(ibi - p->half_pend[p->half_n - 1]) <= c->transition_tol * p->half_pend[p->half_n - 1];
            if (!chains) p->half_n = 0;
            if (p->half_n < 4) p->half_pend[p->half_n++] = ibi;
            if (p->half_n >= c->transition_beats) {
                p->ibi_n = 0; p->ibi_head = 0;
                for (int i = 0; i < p->half_n; i++) ibi_push(p, p->half_pend[i]);
                p->half_n = 0; p->pend_n = 0;
                p->hr_robust = 60000.0f / medianf(p->ibi, p->ibi_n);
                p->transition_boost = (float)c->transition_beats;
                beat_report(p, t_idx, amp, width_ms, ibi, 1, -1);
                accept_beat(p, t_idx, amp, 0);       /* window already reloaded */
                return;
            }
            p->diag.rejects[WW_REJ_IBI_OUTLIER]++;
            beat_report(p, t_idx, amp, width_ms, ibi, 0, WW_REJ_IBI_OUTLIER);
            /* ADVANCE the anchor. Keeping it (the obvious choice for a suspected
               double-detection) made this escape unreachable: the next real beat then
               measured ~1.0x the inflated median from the stale anchor, was accepted as
               in-family, and cleared the chain — so half_n never passed 1 and a half-rate
               lock was permanent. Advancing means successive true beats read as a
               consistent run of half-intervals, which is exactly the evidence needed. */
            p->last_beat_idx = t_idx;
            return;
        }
        p->half_n = 0;                               /* in-family interval — chain broken */
        float scale = 1.4826f * madf(p->ibi, p->ibi_n, med);
        if (scale < c->mad_floor_ms) scale = c->mad_floor_ms;
        if (fabsf(ibi - med) > c->mad_gate * scale) {
            /* outlier — but is it the START of a genuine HR change? */
            bool continues = p->pend_n > 0 &&
                fabsf(ibi - p->pend[p->pend_n - 1]) <= c->transition_tol * p->pend[p->pend_n - 1];
            if (!continues) p->pend_n = 0;
            if (p->pend_n < 4) p->pend[p->pend_n++] = ibi;
            if (p->pend_n >= c->transition_beats) {
                /* §11: several consecutive consistent IBIs ⇒ real transition —
                   reload the window with the new rhythm and track it fast */
                p->ibi_n = 0; p->ibi_head = 0;
                for (int i = 0; i < p->pend_n; i++) ibi_push(p, p->pend[i]);
                p->pend_n = 0;
                p->transition_boost = (float)c->transition_beats;
                p->hr_robust = 60000.0f / medianf(p->ibi, p->ibi_n);
                beat_report(p, t_idx, amp, width_ms, ibi, 1, -1);
                accept_beat(p, t_idx, amp, 0);   /* window already loaded */
                return;
            }
            p->diag.rejects[WW_REJ_IBI_OUTLIER]++;
            beat_report(p, t_idx, amp, width_ms, ibi, 0, WW_REJ_IBI_OUTLIER);
            /* Re-anchor only when this peak has full beat amplitude — a small
               artifact must not steal the anchor and corrupt the next interval. */
            if (amp >= 0.6f * p->peak_amp_ema) p->last_beat_idx = t_idx;
            return;
        }
        p->pend_n = 0;                            /* back in-family — clear pending */
    }
    beat_report(p, t_idx, amp, width_ms, ibi, 1, -1);
    accept_beat(p, t_idx, amp, ibi);
}

/* ---------------- rhythm cross-check (1 Hz, inside publish) ---------------- */

/* The beat counter was off by a whole factor (every other beat missed, or every beat
   counted twice) while the pulse wave plainly repeats at `bpm`: reload the rhythm
   memory at that rate. For a half-rate lock the weaker beats were below threshold, so
   the amplitude reference is halved to let them through again. */
static void rhythm_relock(ww_hr_t *p, float bpm, bool was_half) {
    const ww_hr_config_t *c = &p->cfg;
    float ibi = 60000.0f / bpm;
    p->ibi_n = 0; p->ibi_head = 0;
    for (int k = 0; k < 3; k++) ibi_push(p, ibi);
    p->pend_n = 0; p->half_n = 0;
    p->hr_robust = bpm;
    p->hr_display = bpm;                 /* a correction, not a trend: jump to it */
    p->transition_boost = (float)c->transition_beats;
    p->last_good_idx = p->idx;           /* the rhythm itself is the evidence */
    if (was_half) { p->peak_amp_ema *= 0.5f; p->diag.rhythm_relock_half++; }
    else p->diag.rhythm_relock_double++;
}

static void rhythm_check(ww_hr_t *p) {
    const ww_hr_config_t *c = &p->cfg;
    ww_rhythm_est_t e = ww_rhythm_estimate(&p->rhythm, c->hr_min_bpm, c->hr_max_bpm);
    p->rhythm_ready = e.ready;
    p->rhythm_bpm = e.periodic ? e.bpm : 0;
    p->rhythm_strength = e.strength;
    p->rhythm_override = false;
    if (!p->hr_seeded || !e.ready || !e.periodic) { p->rhythm_harm_streak = p->rhythm_dis_streak = 0; return; }

    float ratio = p->hr_robust / e.bpm;   /* beat counter ÷ rhythm */
    if (fabsf(ratio - 1.0f) <= RC_AGREE_TOL) { p->rhythm_harm_streak = p->rhythm_dis_streak = 0; return; }

    /* Before the first reading has been shown, correct at once — the point is never to
       show the wrong number. Once readings are flowing, require persistence. */
    int persist = (p->state == WW_HR_VALID || p->state == WW_HR_DEGRADED) ? RC_PERSIST : 1;
    bool half = ratio > 0.42f && ratio < 0.58f;
    bool dbl  = ratio > 1.70f && ratio < 2.40f;
    if ((half || dbl) && e.strength >= RC_RELOCK_MIN) {
        p->rhythm_dis_streak = 0;
        if (++p->rhythm_harm_streak >= persist) { rhythm_relock(p, e.bpm, half); p->rhythm_harm_streak = 0; }
        return;
    }
    p->rhythm_harm_streak = 0;
    /* Not a clean factor (e.g. a pressure artifact making beats look faster): don't
       rebuild anything, just publish the rhythm's value while it is this clear. */
    if (e.strength >= RC_OVERRIDE_MIN) {
        if (++p->rhythm_dis_streak >= persist) { p->rhythm_override = true; p->diag.rhythm_overrides++; }
    } else {
        p->rhythm_dis_streak = 0;
    }
}

/* ---------------- 1 Hz publish (§13–§14): states + wire outputs ---------------- */

static void publish(ww_hr_t *p) {
    const ww_hr_config_t *c = &p->cfg;
    p->sqi = sqi_compute(p);
    bool contact = p->contact_flag;   /* decided per-sample on the fast tracker */
    if (contact) rhythm_check(p);

    /* Re-contact: the DC step through the HP filter is a huge transient — arm a
       settle window so it cannot be mistaken for pulses while filters re-seat. */
    /* (the settle window is armed per-sample in ww_hr_push — see contact_flag) */

    if (!contact) {
        if (p->state != WW_HR_NO_CONTACT) {
            /* FULL re-acquisition: estimator, rings, polarity AND the detector's
               adaptation state — leaving peak_amp_ema/noise_floor/thr behind lets
               the take-off transient poison the threshold permanently. */
            p->hr_seeded = false; p->valid_streak = 0;
            p->ibi_n = 0; p->ibi_head = 0; p->pend_n = 0;
            p->amp_n = 0; p->amp_head = 0;
            p->have_last_beat = false;
            p->pos_ema = p->neg_ema = 0;
            p->spo2_seeded = false;
            p->peak_amp_ema = 0; p->noise_floor = 0; p->thr = 0;
            p->last_accept_idx = p->idx;
            p->det_state = 0; p->cand_max = 0;
            p->prev1 = p->prev2 = 0;
            p->ir_ac_pow = p->red_ac_pow = 0;
            /* Re-seed the DC tracker and clear the filter memories on the NEXT sample.
               Without this, putting the sensor back on drives a ~10^5-count step into
               the 0.5 Hz high-pass, which rings for seconds; those wide transient lobes
               fail the pulse-width gate, so no beat is ever accepted and the threshold
               never bootstraps — the sensor appears dead until reboot. Re-seeding means
               the filters simply restart at the new operating point. */
            p->seeded = false;
            p->hp_ir.z1 = p->hp_ir.z2 = 0; p->lp_ir.z1 = p->lp_ir.z2 = 0;
            p->hp_red.z1 = p->hp_red.z2 = 0; p->lp_red.z1 = p->lp_red.z2 = 0;
            ww_rhythm_reset(&p->rhythm);
        }
        p->state = WW_HR_NO_CONTACT;
    } else if (!p->hr_seeded || (!p->rhythm_ready && p->state == WW_HR_ACQUIRING)) {
        /* The FIRST reading also waits for the rhythm window (4 s of pulse), so it can
           be cross-checked before anything is shown — at most a second or two later
           than before, and it stops a half-rate start (e.g. 44 for a real 87). */
        p->state = WW_HR_ACQUIRING;
    } else {
        float dropout_s = (float)((p->idx - p->last_good_idx) / c->fs_hz);
        if (dropout_s <= DROPOUT_VALID_S && p->sqi >= SQI_VALID_MIN) {
            p->state = WW_HR_VALID;
        } else if (dropout_s <= c->degraded_hold_s) {
            p->state = WW_HR_DEGRADED;      /* hold last HR, confidence degraded */
        } else {
            /* §14: persistent low quality — stop presenting an HR as current, and
               clear the rhythm memory so re-acquisition starts from evidence, not
               from a stale ring that would outlier-reject the new rhythm. */
            p->state = WW_HR_ACQUIRING;
            p->hr_seeded = false;
            p->valid_streak = 0;
            p->ibi_n = 0; p->ibi_head = 0; p->pend_n = 0; p->half_n = 0;
            p->amp_n = 0; p->amp_head = 0; p->spo2_seeded = false;
            p->have_last_beat = false;
        }
    }

    /* publish only when we have something defensible; the app renders absence */
    if (p->state == WW_HR_VALID || p->state == WW_HR_DEGRADED)
        ring_pushf(p->out_hr, WW_HR_OUT_RING, &p->hr_head, &p->hr_count,
                   p->rhythm_override ? p->rhythm_bpm : p->hr_display);

    /* SpO2: ratio-of-ratios on band-passed RMS, gated by beat validity + SQI */
    if (p->state == WW_HR_VALID && p->sqi >= c->spo2_min_sqi &&
        p->dc_red > c->dc_contact_min && p->dc_red < c->dc_contact_max &&
        p->ir_ac_pow > 1e-6f) {
        float r_ir = sqrtf(p->ir_ac_pow) / p->dc_ir;
        float r_red = sqrtf(p->red_ac_pow) / p->dc_red;
        if (r_ir > 1e-9f) {
            float R = r_red / r_ir;
            if (R > 0.3f && R < 3.0f) {
                float s = 110.0f - 25.0f * R;   /* uncalibrated textbook curve */
                if (s > 100) s = 100;
                if (s < 70) s = 70;
                if (!p->spo2_seeded) { p->spo2_display = s; p->spo2_seeded = true; }
                else p->spo2_display += c->spo2_alpha * (s - p->spo2_display);
                ring_pushf(p->out_spo2, WW_HR_OUT_RING, &p->spo2_head, &p->spo2_count, p->spo2_display);
            }
        }
    }
    p->clip_recent /= 2;                     /* leaky clipping window */
}

/* ---------------- the per-sample hot path ---------------- */

void ww_hr_push(ww_hr_t *p, uint32_t ir_raw, uint32_t red_raw) {
    const ww_hr_config_t *c = &p->cfg;
    float ir = (float)ir_raw, red = (float)red_raw;
    p->diag.samples++;

    if (!p->seeded) {                        /* seed DC so nothing rails at start */
        p->dc_ir = ir; p->dc_red = red; p->dc_fast = ir;
        p->seeded = true;
    }
    p->dc_fast += 0.05f * (ir - p->dc_fast);  /* tau ~0.2 s — contact edges only */
    /* DC tracker (10× faster during a settle window so an LED step re-seats fast) */
    float a_dc = (p->idx < p->settle_until) ? c->dc_alpha * 10.0f : c->dc_alpha;
    p->dc_ir += a_dc * (ir - p->dc_ir);
    p->dc_red += a_dc * (red - p->dc_red);

    /* RED saturation matters too: it silently invalidates SpO2's ratio. */
    if (ir >= c->clip_level || red >= c->clip_level) { p->clip_recent++; p->diag.clipped_samples++; }

    /* Contact is evaluated EVERY sample, not at the 1 Hz publish: waiting for the tick
       added up to a second of dead time to every finger placement. The settle window is
       short because the DC tracker and filters are re-seeded on contact loss, so there
       is no longer a large step to ride out. */
    {
        /* HYSTERESIS + DEBOUNCE. A bare threshold on dc_fast chattered when the level
           parked near a bound: each spurious rising edge tore down a good estimate and
           re-armed a settle window (which also froze the AGC — the one thing that could
           move the level away from the bound). Contact must now be asserted above the
           bound and released below 60% of it, and either way sustained for 0.1 s. */
        bool on_now  = p->dc_fast > c->dc_contact_min && p->dc_fast < c->dc_contact_max;
        bool off_now = p->dc_fast < c->dc_contact_min * 0.6f || p->dc_fast > c->dc_contact_max;
        bool contact_now = p->contact_flag;
        if (p->contact_flag) {
            p->contact_debounce = off_now ? p->contact_debounce + 1 : 0;
            if (p->contact_debounce >= 10) { contact_now = false; p->contact_debounce = 0; }
        } else {
            p->contact_debounce = on_now ? p->contact_debounce + 1 : 0;
            if (p->contact_debounce >= 10) { contact_now = true; p->contact_debounce = 0; }
        }
        if (!contact_now && p->contact_flag) {
            /* LIFT-OFF, noticed within ~0.2 s instead of the ~3 s the slow DC took.
               Tear down the estimate here rather than waiting for the 1 Hz publish, so
               readings stop promptly instead of trailing after the finger is gone. */
            p->hr_seeded = false; p->valid_streak = 0;
            p->ibi_n = 0; p->ibi_head = 0; p->pend_n = 0; p->half_n = 0;
            p->amp_n = 0; p->amp_head = 0;
            p->have_last_beat = false;
            p->spo2_seeded = false;
            p->peak_amp_ema = 0; p->noise_floor = 0; p->thr = 0;
            p->pos_ema = p->neg_ema = 0;
            p->det_state = 0; p->cand_max = 0;
            p->prev1 = p->prev2 = 0;
            p->ir_ac_pow = p->red_ac_pow = 0;
            p->last_accept_idx = p->idx;
            p->clip_recent = 0;                /* off-skin saturation must not linger */
            ww_rhythm_reset(&p->rhythm);
            p->rhythm_harm_streak = p->rhythm_dis_streak = 0; p->rhythm_override = false;
            p->seeded = false;                 /* snap the slow DC to the off-skin level
                                                  next sample, else the AGC spends ~12 s
                                                  walking the LED up chasing a stale DC */
            p->state = WW_HR_NO_CONTACT;
            p->next_publish_idx = p->idx;      /* reflect it at once */
        }
        if (contact_now && !p->contact_flag) {
            /* RE-SEED the DC tracker to the live level the moment skin is detected.
               Otherwise the EMA has to climb from the off-skin dark current (~700) to
               the on-skin level (~10^5), which takes seconds; until it arrives,
               (raw - dc) is huge and the band-pass emits enormous fake "beats" that
               capture the amplitude reference and blind the detector to real pulses
               until it decays. That was the 5-30 s wait before a reading appeared. */
            p->dc_ir = ir;
            p->dc_red = red;
            p->hp_ir.z1 = p->hp_ir.z2 = 0; p->lp_ir.z1 = p->lp_ir.z2 = 0;
            p->hp_red.z1 = p->hp_red.z2 = 0; p->lp_red.z1 = p->lp_red.z2 = 0;
            p->ir_ac_pow = p->red_ac_pow = 0;
            p->peak_amp_ema = 0; p->noise_floor = 0; p->thr = 0;
            p->pos_ema = p->neg_ema = 0;
            p->det_state = 0; p->prev1 = p->prev2 = 0;
            p->clip_recent = 0; p->half_n = 0; p->pend_n = 0;
            ww_rhythm_reset(&p->rhythm);
            p->rhythm_harm_streak = p->rhythm_dis_streak = 0; p->rhythm_override = false;
            /* 1.2 s: re-seeding removes the ELECTRICAL step, but the finger itself is
               still settling under pressure for about a second, and that motion produces
               lobes ~25x a real pulse. Accepting one sets the amplitude reference so high
               that genuine beats stay below threshold until it decays — which cost ~5 s.
               Beats inside the window are rejected and, crucially, do not train the
               reference, so the first real pulse bootstraps it correctly. */
            double until = p->idx + 1.2 * c->fs_hz;
            if (until > p->settle_until) p->settle_until = until;
        }
        p->contact_flag = contact_now;
    }

    /* band-limit both channels; RMS trackers feed PI + SpO2 (τ ≈ 2.5 s) */
    float f_ir = biquad_run(&p->lp_ir, biquad_run(&p->hp_ir, ir - p->dc_ir));
    float f_red = biquad_run(&p->lp_red, biquad_run(&p->hp_red, red - p->dc_red));
    /* AC power feeds the perfusion index. Inside a settle window the signal is a
       placement artifact — accumulating it there loaded the tracker with a huge value
       that then decayed slowly, so the pi_max gate rejected the first seconds of REAL
       beats. Skip the window entirely, then converge fast until the rhythm is locked. */
    if (p->idx >= p->settle_until) {
        float a_ac = p->hr_seeded ? 0.004f : 0.04f;
        p->ir_ac_pow += a_ac * (f_ir * f_ir - p->ir_ac_pow);
        p->red_ac_pow += a_ac * (f_red * f_red - p->red_ac_pow);
    }

    /* preserve raw + filtered for offline debugging (§2) and stream PPG */
    p->dbg_raw[p->dbg_head] = ir;
    p->dbg_filt[p->dbg_head] = f_ir;
    p->dbg_head = (p->dbg_head + 1) % WW_HR_DBG_RING;
    ring_pushf(p->out_ppg, WW_HR_PPG_RING, &p->ppg_head, &p->ppg_count, f_ir);
    /* Rhythm cross-check window. The raw filtered IR, not the polarity-corrected y:
       autocorrelation is blind to sign, and y can still flip while acquiring, which would
       splice an inverted half into the window. Settle windows are skipped (transients). */
    if (p->idx >= p->settle_until) ww_rhythm_push(&p->rhythm, f_ir);

    /* polarity auto-detect while acquiring (systole may be a dip or a rise
       depending on optics/orientation); locked once the estimator is seeded */
    /* Polarity from PEAK excursion, not mean: a PPG's systolic peak is tall but brief
       while the diastolic trough is shallow and broad, so comparing MEANS favours the
       trough and inverts detection (observed on hardware: beats missed, never locks).
       Decaying peak-holds compare like with like. */
    if (!p->hr_seeded) {
        if (p->idx < p->settle_until) {
            /* Inside a settle window the signal is a filter transient, not pulses.
               Letting it into the envelope would set the bootstrap threshold from the
               transient — then only the strongest beats cross it, every other beat is
               missed, and the estimator locks onto HALF the true rate. */
            p->pos_ema = p->neg_ema = 0;
        } else {
            /* Peak-holds with a ~2 s decay: long enough to span a beat interval, short
               enough to forget a one-off artifact instead of shadowing real beats.
               PHYSIOLOGICAL CAP: the pulsatile part of a PPG is at most a few percent of
               the DC level, so anything larger is a pressure/motion artifact and must not
               enter the envelope — it feeds the bootstrap threshold, and a single spike
               there raised thr ~10x and hid real beats for 5-24 s while it decayed. */
            float ac_limit = 0.01f * c->pi_max_pct * p->dc_ir;
            p->pos_ema *= 0.995f;
            p->neg_ema *= 0.995f;
            if (f_ir < ac_limit && f_ir > -ac_limit) {
                if (f_ir > p->pos_ema) p->pos_ema = f_ir;
                if (-f_ir > p->neg_ema) p->neg_ema = -f_ir;
            }
        }
        /* Polarity DECISION only between lobes, so it can never flip mid-pulse. */
        if (p->det_state == 0) p->pol = (p->pos_ema >= p->neg_ema) ? 1.0f : -1.0f;
    }
    float y = p->pol * f_ir;

    /* adaptive threshold (§6): noise floor + fraction of recent peak amplitude;
       bootstrap on the noise floor alone until the first peaks exist */
    /* Noise floor = the QUIET baseline between pulses. Learning from everything below
       thr still includes the pulse shoulders, which pulled the floor to ~30% of beat
       amplitude on hardware and pushed thr to ~64% of a real beat — half the beats
       were then invisible. Learning only well below thr estimates true rest noise. */
    if (p->det_state == 0 && fabsf(y) < 0.3f * p->thr)
        p->noise_floor += c->noise_alpha * (fabsf(y) - p->noise_floor);

    /* Threshold is driven by the RECENT BEAT AMPLITUDE once one is known, with the
       noise floor only as a lower bound (so pure noise can't trigger). Previously the
       floor was ADDED to the fraction, double-counting it into the threshold. */
    float from_peak = c->thr_frac * p->peak_amp_ema;
    float from_noise = 2.5f * p->noise_floor;
    p->thr = (from_peak > from_noise) ? from_peak : from_noise;
    /* BOOTSTRAP: with no accepted beat yet, both terms above are 0 and the threshold
       would sit at ~0 — which makes every lobe run to the next zero crossing, so its
       width fails the gate and no beat can ever be accepted (a self-locking deadlock).
       Fall back to a fraction of the live signal envelope, which is already tracked
       for polarity, so the threshold is sane from the very first pulse. */
    if (p->peak_amp_ema <= 1e-6f) {
        float env = (p->pos_ema > p->neg_ema) ? p->pos_ema : p->neg_ema;
        float from_env = c->thr_frac * env;
        if (from_env > p->thr) p->thr = from_env;
    }
    if (p->thr < 1e-6f) p->thr = 1e-6f;      /* never exactly zero */

    double refr_samples = c->refractory_ms * c->fs_hz / 1000.0;

    /* HOLD the detector idle for the whole settle window. Rejecting a beat inside the
       window is not enough: with the threshold reset to ~0 a lobe only ends when the
       signal falls below 0.5*thr, so a placement transient formed ONE lobe that spanned
       the entire window and was judged just after it expired — no longer "settling", and
       its ~25x amplitude then captured the reference and blinded the detector for
       seconds. Starting no lobe until the window closes makes that impossible. */
    if (p->idx < p->settle_until) {
        p->det_state = 0;
        p->cand_max = 0;
        p->prev2 = p->prev1;
        p->prev1 = y;
        p->idx += 1.0;
        if (p->idx >= p->next_publish_idx) {
            p->next_publish_idx = p->idx + c->publish_period_s * c->fs_hz;
            publish(p);
        }
        return;
    }

    switch (p->det_state) {
        case 0: /* SEARCH_RISE */
            if (y > p->thr && y > p->prev1) {
                p->det_state = 1;
                p->rise_idx = p->idx;
                p->fall_idx = 0;               /* 0 = not yet crossed back down */
                p->cand_max = y;
                p->cand_max_idx = p->idx;
            }
            break;
        case 1: /* PEAK_CANDIDATE — ride the lobe, refine the apex sub-sample */
            if (y > p->cand_max) {
                p->cand_max = y;
                p->cand_max_idx = p->idx;
            } else if (p->idx == p->cand_max_idx + 1) {
                /* quadratic interpolation through (max-1, max, max+1): at 100 Hz an
                   integer-sample IBI quantizes to ±3 BPM at 180 BPM — sub-sample
                   timing removes most of that (§21). */
                float denom = p->prev2 - 2.0f * p->prev1 + y;
                if (denom < -1e-9f) {
                    float off = 0.5f * (p->prev2 - y) / denom;
                    if (off > 0.5f) off = 0.5f;
                    if (off < -0.5f) off = -0.5f;
                    p->cand_max_idx = (p->idx - 1) + off;
                }
            }
            if (p->fall_idx == 0 && y < p->thr) p->fall_idx = p->idx;   /* lobe width mark */
            if (y < 0.5f * p->thr) {         /* fell through hysteresis: lobe over */
                /* Width is measured between the THRESHOLD crossings, not down to the
                   0.5×thr hysteresis exit: the exit lags well past the systolic lobe
                   (the diastolic decay is slow), which inflated widths past the gate
                   and rejected perfectly good beats at higher heart rates. */
                double fall = (p->fall_idx > 0) ? p->fall_idx : p->idx;
                float width_ms = (float)((fall - p->rise_idx) * 1000.0 / c->fs_hz);
                float amp = p->cand_max;
                p->last_lobe_idx = p->idx;
                on_peak(p, p->cand_max_idx, amp, width_ms);   /* EMA updates inside,
                                                                 gated — see on_peak */
                p->det_state = 2;
            }
            break;
        case 2: /* REFRACTORY — hard floor against double-counting one pulse.
                   TIME-ONLY exit: waiting for y < thr as well would extend the
                   refractory past the next systole at high heart rates and lock
                   onto every other beat. SEARCH still needs a rising edge above
                   thr, so the tail of the same lobe cannot re-trigger. */
        default:
            if (p->idx - p->cand_max_idx >= refr_samples)
                p->det_state = 0;
            break;
    }

    /* Decay the amplitude reference whenever no beat has been ACCEPTED recently
       (τ ≈ 10 s). Keyed on acceptance, not on lobes: lobes keep completing while the
       gates reject them, so a lobe-keyed decay would never fire exactly when the
       reference is wrong and needs to come down. */
    if (p->idx - p->last_accept_idx > 2.0 * c->fs_hz)
        p->peak_amp_ema *= 0.999f;

    p->prev2 = p->prev1;
    p->prev1 = y;
    p->idx += 1.0;

    if (p->idx >= p->next_publish_idx) {
        p->next_publish_idx += c->publish_period_s * c->fs_hz;
        publish(p);
    }
}

/* ---------------- introspection + drains ---------------- */

ww_hr_state_t ww_hr_state(const ww_hr_t *p) { return p->state; }
float ww_hr_sqi(const ww_hr_t *p) { return p->sqi; }
float ww_hr_display(const ww_hr_t *p) { return p->hr_display; }
float ww_hr_dc_ir(const ww_hr_t *p) { return p->dc_ir; }
float ww_hr_rhythm_bpm(const ww_hr_t *p) { return p->rhythm_bpm; }
float ww_hr_rhythm_strength(const ww_hr_t *p) { return p->rhythm_strength; }
const ww_hr_diag_t *ww_hr_diag(const ww_hr_t *p) { return &p->diag; }

uint16_t ww_hr_drain_hr(ww_hr_t *p, float *out, uint16_t max) {
    return ring_drainf(p->out_hr, WW_HR_OUT_RING, &p->hr_head, &p->hr_count, out, max);
}
uint16_t ww_hr_drain_spo2(ww_hr_t *p, float *out, uint16_t max) {
    return ring_drainf(p->out_spo2, WW_HR_OUT_RING, &p->spo2_head, &p->spo2_count, out, max);
}
uint16_t ww_hr_drain_ppg(ww_hr_t *p, float *out, uint16_t max) {
    return ring_drainf(p->out_ppg, WW_HR_PPG_RING, &p->ppg_head, &p->ppg_count, out, max);
}

void ww_hr_flush_outputs(ww_hr_t *p) {
    p->hr_head = p->hr_count = 0;
    p->spo2_head = p->spo2_count = 0;
    p->ppg_head = p->ppg_count = 0;
}
