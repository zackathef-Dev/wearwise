#include "RhythmCheck.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* Pick rules (tuned on synthetic PPG, see the header):
   - a candidate period is a local maximum of the autocorrelation with r >= PICK_ABS
     and r >= PICK_REL x the strongest local maximum; the SHORTEST such lag wins, so the
     2-, 3-beat lags (which also correlate) never beat the 1-beat lag;
   - HALF-PERIOD CHECK: strong beat-to-beat amplitude alternation makes the 2-beat lag
     the strongest. A genuinely slow pulse has its trough at half a period (r < 0 there),
     so a local maximum with r >= HALF_MIN near half the picked lag means the true period
     is the shorter one. */
#define PICK_ABS 0.50f
#define PICK_REL 0.60f
#define HALF_MIN 0.30f

void ww_rhythm_reset(ww_rhythm_t *r) { memset(r, 0, sizeof *r); }

void ww_rhythm_push(ww_rhythm_t *r, float y) {
    r->acc += y;
    if (++r->acc_k < WW_RC_DECIM) return;
    r->buf[r->head] = r->acc / (float)WW_RC_DECIM;
    r->head = (r->head + 1) % WW_RC_N;
    if (r->n < WW_RC_N) r->n++;
    r->acc = 0; r->acc_k = 0;
}

ww_rhythm_est_t ww_rhythm_estimate(const ww_rhythm_t *r, float hr_min_bpm, float hr_max_bpm) {
    ww_rhythm_est_t e = { .ready = r->n >= WW_RC_MIN_N, .periodic = false, .bpm = 0, .strength = 0 };
    if (!e.ready) return e;

    /* oldest → newest, mean removed. Static, not on the stack: ~1 KB would be a real
       share of the sensor task's stack. The pipeline is single-threaded. */
    static float x[WW_RC_N];
    int n = r->n, start = (r->head - n + WW_RC_N) % WW_RC_N;
    float mean = 0;
    for (int i = 0; i < n; i++) { x[i] = r->buf[(start + i) % WW_RC_N]; mean += x[i]; }
    mean /= (float)n;
    for (int i = 0; i < n; i++) x[i] -= mean;

    int lmin = (int)floorf(WW_RC_FS * 60.0f / hr_max_bpm);
    int lmax = (int)ceilf(WW_RC_FS * 60.0f / hr_min_bpm);
    if (lmax > n / 2) lmax = n / 2;
    if (lmin < 2) lmin = 2;
    if (lmax - lmin < 2) return e;

    /* normalised autocorrelation over the overlapping segments: r(L) in -1..1 */
    static float rr[WW_RC_N / 2 + 2];
    for (int L = lmin - 1; L <= lmax + 1; L++) {
        double ab = 0, aa = 0, bb = 0;
        for (int i = 0; i + L < n; i++) { ab += (double)x[i] * x[i + L]; aa += (double)x[i] * x[i]; bb += (double)x[i + L] * x[i + L]; }
        double den = sqrt(aa * bb);
        rr[L] = den > 0 ? (float)(ab / den) : 0.0f;
    }

    float gmax = -1.0f;
    for (int L = lmin; L <= lmax; L++)
        if (rr[L] > rr[L - 1] && rr[L] >= rr[L + 1] && rr[L] > gmax) gmax = rr[L];
    e.strength = gmax > 0 ? gmax : 0;
    if (gmax <= 0) return e;

    int pick = -1;
    for (int L = lmin; L <= lmax; L++) {
        if (rr[L] > rr[L - 1] && rr[L] >= rr[L + 1] && rr[L] >= PICK_ABS && rr[L] >= PICK_REL * gmax) { pick = L; break; }
    }
    if (pick < 0) return e;

    for (int pass = 0; pass < 2; pass++) {               /* half-period check */
        float half = pick / 2.0f, tol = 0.12f * half + 1.0f;
        int best = -1;
        for (int L = lmin; L <= lmax; L++) {
            if (fabsf(L - half) > tol) continue;
            if (!(rr[L] > rr[L - 1] && rr[L] >= rr[L + 1]) || rr[L] < HALF_MIN) continue;
            if (best < 0 || rr[L] > rr[best]) best = L;
        }
        if (best < 0) break;
        pick = best;
    }

    /* sub-lag refinement: parabola through the peak and its neighbours */
    float y0 = rr[pick - 1], y1 = rr[pick], y2 = rr[pick + 1];
    float den = y0 - 2.0f * y1 + y2, off = 0;
    if (den < -1e-6f) { off = 0.5f * (y0 - y2) / den; if (off > 0.5f) off = 0.5f; if (off < -0.5f) off = -0.5f; }
    e.periodic = true;
    e.bpm = 60.0f * WW_RC_FS / ((float)pick + off);
    e.strength = y1;
    return e;
}

/* ---------------- self-test on synthetic PPG ---------------- */

/* Same 0.5-4 Hz Butterworth front end as HRPipeline (kept local so this file stands
   alone). */
typedef struct { float b0, b1, b2, a1, a2, z1, z2; } bq_t;
static void bq_init(bq_t *f, bool hp, float fc, float fs) {
    float w = 2.0f * (float)M_PI * fc / fs, c = cosf(w), al = sinf(w) / (2.0f * 0.70710678f), a0 = 1 + al;
    if (hp) { f->b0 = (1 + c) / 2 / a0; f->b1 = -(1 + c) / a0; f->b2 = (1 + c) / 2 / a0; }
    else    { f->b0 = (1 - c) / 2 / a0; f->b1 = (1 - c) / a0;  f->b2 = (1 - c) / 2 / a0; }
    f->a1 = (-2 * c) / a0; f->a2 = (1 - al) / a0; f->z1 = f->z2 = 0;
}
static float bq_run(bq_t *f, float x) {
    float y = f->b0 * x + f->z1;
    f->z1 = f->b1 * x - f->a1 * y + f->z2;
    f->z2 = f->b2 * x - f->a2 * y;
    return y;
}

/* Deterministic pseudo-random (xorshift) so the self-test is repeatable. */
static unsigned s_rng = 12345u;
static float urand(void) { s_rng ^= s_rng << 13; s_rng ^= s_rng >> 17; s_rng ^= s_rng << 5; return (s_rng & 0xFFFFFF) / 16777216.0f; }
static float nrand(void) { float s = 0; for (int i = 0; i < 6; i++) s += urand(); return (s - 3.0f) * 1.41f; }

/* 8 s of PPG at 100 Hz: systolic Gaussian + dicrotic Gaussian per beat. */
static ww_rhythm_t s_rc;   /* self-test scratch (boot only) */
static ww_rhythm_est_t run_case(float bpm, float dicrotic, float alt, float noise, float irregular) {
    ww_rhythm_reset(&s_rc);
    bq_t hp, lp; bq_init(&hp, true, 0.5f, 100.0f); bq_init(&lp, false, 4.0f, 100.0f);
    float beat_t[40], beat_p[40], beat_a[40]; int nb = 0;
    for (float t = 0; t < 8.5f && nb < 40; nb++) {
        float P = 60.0f / bpm * (1.0f + irregular * (2.0f * urand() - 1.0f));
        beat_t[nb] = t; beat_p[nb] = P; beat_a[nb] = (alt > 0 && (nb & 1)) ? alt : 1.0f;
        t += P;
    }
    for (int i = 0; i < 800; i++) {
        float t = i / 100.0f, v = 0;
        for (int k = 0; k < nb; k++) {
            float P = beat_p[k], d1 = (t - beat_t[k] - 0.15f * P) / (0.07f * P), d2 = (t - beat_t[k] - 0.45f * P) / (0.09f * P);
            if (d1 > -6 && d1 < 6) v += beat_a[k] * expf(-0.5f * d1 * d1);
            if (d2 > -6 && d2 < 6) v += beat_a[k] * dicrotic * expf(-0.5f * d2 * d2);
        }
        v += noise * nrand();
        ww_rhythm_push(&s_rc, bq_run(&lp, bq_run(&hp, v)));
    }
    return ww_rhythm_estimate(&s_rc, 30.0f, 220.0f);
}

int ww_rhythm_selftest(void (*log)(const char *line)) {
    struct { const char *name; float bpm, dicrotic, alt, noise, irregular; float want; } cases[] = {
        { "clean 87",              87, 0.3f, 0,    0,     0,    87 },
        { "clean 44 (slow)",       44, 0.3f, 0,    0,     0,    44 },
        { "clean 150",            150, 0.3f, 0,    0,     0,   150 },
        { "dicrotic 0.6 at 60",    60, 0.6f, 0,    0,     0,    60 },
        { "slow 40 dicrotic 0.8",  40, 0.8f, 0,    0,     0,    40 },
        { "alternating 0.5 at 87", 87, 0.3f, 0.5f, 0,     0,    87 },
        { "noisy 87",              87, 0.3f, 0,    0.15f, 0,    87 },
        { "noise only",            87, 0,    0,    -1,    0,     0 },   /* want: not periodic */
    };
    int fails = 0;
    char line[120];
    for (unsigned i = 0; i < sizeof cases / sizeof cases[0]; i++) {
        ww_rhythm_est_t e;
        if (cases[i].noise < 0) {
            ww_rhythm_reset(&s_rc);
            bq_t hp, lp; bq_init(&hp, true, 0.5f, 100.0f); bq_init(&lp, false, 4.0f, 100.0f);
            for (int k = 0; k < 800; k++) ww_rhythm_push(&s_rc, bq_run(&lp, bq_run(&hp, 0.4f * nrand())));
            e = ww_rhythm_estimate(&s_rc, 30.0f, 220.0f);
        } else {
            e = run_case(cases[i].bpm, cases[i].dicrotic, cases[i].alt, cases[i].noise, cases[i].irregular);
        }
        bool ok = cases[i].want == 0 ? (!e.periodic || e.strength < 0.5f)
                                     : (e.periodic && fabsf(e.bpm - cases[i].want) <= 2.0f);
        if (!ok) fails++;
        if (log) {
            snprintf(line, sizeof line, "rhythm self-test %-22s -> %5.1f BPM r=%.2f %s",
                     cases[i].name, e.bpm, e.strength, ok ? "ok" : "FAIL");
            log(line);
        }
    }
    return fails;
}
