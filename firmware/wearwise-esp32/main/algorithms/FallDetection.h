/* On-device "possible fall" detector — a C port of the app's FallDetector state machine
 * (free-fall -> impact -> stillness), fed accelerometer MAGNITUDE (g) one sample at a time.
 *
 * This is a PROTOTYPE motion heuristic, not clinical fall detection. It is intentionally
 * kept separate from the accelerometer driver so thresholds can be tuned in one place. The
 * app already runs the same detector on the accel stream; the firmware copy just lets a
 * board log/flag a possible fall locally (§13). It does NOT add a new wire code.
 */
#pragma once
#include <stdbool.h>

typedef struct {
    float freefall_g;            /* below this = free-fall */
    float impact_g;              /* above this = impact */
    int   freefall_to_impact;    /* impact must follow within this many samples */
    int   settle;                /* ignore this many samples of ring-down after impact */
    int   still;                 /* this many continuous still samples confirms */
    float still_lo_g, still_hi_g;/* stillness band */
} ww_fall_config_t;

typedef struct {
    float freefall_min_g;        /* lowest g during free-fall */
    float impact_peak_g;         /* peak g at impact */
} ww_fall_event_t;

typedef struct {
    ww_fall_config_t cfg;
    int  phase;                  /* 0 idle, 1 freefall, 2 confirm */
    long i;
    long freefall_start;
    float freefall_min;
    long impact_at;
    float impact_peak;
    int  still_count;
} ww_fall_t;

/* Initialise with the accelerometer's sample rate (used to convert the ms thresholds). */
void ww_fall_init(ww_fall_t *f, int sample_rate_hz);

/* Feed one magnitude sample (g). Returns true and fills `out` when a fall confirms. */
bool ww_fall_push(ww_fall_t *f, float mag, ww_fall_event_t *out);
