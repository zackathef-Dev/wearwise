#include "FallDetection.h"

/* Same defaults as the app's DEFAULT_FALL_CONFIG (ms converted to samples at init). */
void ww_fall_init(ww_fall_t *f, int rate) {
    if (rate <= 0) rate = 1;
    f->cfg.freefall_g = 0.6f;
    f->cfg.impact_g = 2.5f;
    f->cfg.freefall_to_impact = 1000 * rate / 1000;   /* 1000 ms */
    f->cfg.settle = 250 * rate / 1000;                 /* 250 ms */
    f->cfg.still  = 1200 * rate / 1000;                /* 1200 ms */
    f->cfg.still_lo_g = 0.75f;
    f->cfg.still_hi_g = 1.30f;
    f->phase = 0; f->i = 0; f->freefall_start = 0; f->freefall_min = 1.0f;
    f->impact_at = 0; f->impact_peak = 0.0f; f->still_count = 0;
}

static void reset(ww_fall_t *f) { f->phase = 0; f->freefall_min = 1.0f; f->impact_peak = 0.0f; f->still_count = 0; }

bool ww_fall_push(ww_fall_t *f, float mag, ww_fall_event_t *out) {
    long i = f->i++;
    const ww_fall_config_t *c = &f->cfg;
    switch (f->phase) {
        case 0: /* idle */
            if (mag < c->freefall_g) { f->phase = 1; f->freefall_start = i; f->freefall_min = mag; }
            return false;
        case 1: /* freefall */
            if (mag < f->freefall_min) f->freefall_min = mag;
            if (mag > c->impact_g) { f->phase = 2; f->impact_at = i; f->impact_peak = mag; f->still_count = 0; return false; }
            if (i - f->freefall_start > c->freefall_to_impact) reset(f);
            return false;
        case 2: /* confirm stillness */
            if (mag > f->impact_peak) f->impact_peak = mag;
            if (i - f->impact_at < c->settle) return false;
            if (mag >= c->still_lo_g && mag <= c->still_hi_g) {
                if (++f->still_count >= c->still) {
                    if (out) { out->freefall_min_g = f->freefall_min; out->impact_peak_g = f->impact_peak; }
                    reset(f);
                    return true;
                }
            } else {
                reset(f);
            }
            return false;
    }
    return false;
}
