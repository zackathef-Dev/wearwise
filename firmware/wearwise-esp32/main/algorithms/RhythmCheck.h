/* Rhythm cross-check for the PPG heart-rate pipeline.
 *
 * A second, independent heart-rate estimate from how regularly the pulse wave repeats
 * (normalised autocorrelation of the band-passed PPG over the last 6 s), used to catch
 * the beat detector counting every other beat (half rate) or extra beats (double or
 * off rate). Beat counting and a periodicity estimate failing in different ways is the
 * point: agreement is confidence; strong, persistent disagreement is a miscount.
 *
 * Standard technique (time-domain beat detection cross-checked against a
 * periodicity estimate, cf. TROIKA, Zhang et al., IEEE TBME 2015; octave-error
 * handling as in YIN, de Cheveigné & Kawahara 2002). Thresholds were chosen on
 * synthetic PPG (clean, noisy, large dicrotic wave, beat-amplitude alternation,
 * irregular rhythm, noise only) — see ww_rhythm_selftest().
 *
 * PURE C, no ESP-IDF dependency, like HRPipeline.
 */
#pragma once
#include <stdbool.h>

#define WW_RC_DECIM   4                     /* 100 Hz → 25 Hz (average of 4)        */
#define WW_RC_FS      25.0f
#define WW_RC_N       150                   /* 6 s window at 25 Hz                  */
#define WW_RC_MIN_N   100                   /* 4 s of signal before an estimate     */

typedef struct {
    float buf[WW_RC_N];
    int head, n;
    float acc; int acc_k;                   /* decimation accumulator */
} ww_rhythm_t;

typedef struct {
    bool  ready;                            /* enough signal in the window          */
    bool  periodic;                         /* a clear repeating period was found   */
    float bpm;                              /* rate of that period (0 if none)      */
    float strength;                         /* normalised autocorrelation, -1..1    */
} ww_rhythm_est_t;

void ww_rhythm_reset(ww_rhythm_t *r);
/* Push one 100 Hz band-passed, polarity-corrected sample. */
void ww_rhythm_push(ww_rhythm_t *r, float y);
ww_rhythm_est_t ww_rhythm_estimate(const ww_rhythm_t *r, float hr_min_bpm, float hr_max_bpm);

/* Runs the estimator on built-in synthetic pulse waves; returns the number of failed
   cases (0 = pass). `log` (may be NULL) receives one line per case. */
int ww_rhythm_selftest(void (*log)(const char *line));
