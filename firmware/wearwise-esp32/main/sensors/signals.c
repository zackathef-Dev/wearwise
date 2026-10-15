#include "signals.h"
#include "protocol.h"
#include <math.h>
#include <stdlib.h>

/* mulberry32, bit-for-bit the JS version. */
static uint32_t mulberry_next(uint32_t *a) {
    *a += 0x6d2b79f5u;
    uint32_t t = *a;
    t = (t ^ (t >> 15)) * (t | 1u);
    t ^= t + ((t ^ (t >> 7)) * (t | 61u));
    return t ^ (t >> 14);
}
static float mulberry_unit(uint32_t *a) { return (float)((double)mulberry_next(a) / 4294967296.0); }

static float bump(float t, float centre, float width, float amp) {
    float d = t - centre;
    return amp * expf(-(d * d) / (2.0f * width * width));
}

uint16_t ww_default_rate(uint8_t t) {
    switch (t) {
        case WW_SENSOR_ECG: return 70;
        case WW_SENSOR_SPO2: return 25;
        case WW_SENSOR_TEMPERATURE: return 1;
        case WW_SENSOR_HEARTRATE: return 1;
        case WW_SENSOR_ACCELEROMETER: return 50;
        default: return 1;
    }
}

/* Index-hash jitter for the accelerometer, bit-for-bit the JS accelGenerator's
   hash(i) = frac(sin((i+seed)*12.9898)*43758.5453). Kept in double to match JS. */
static float accel_hash(uint32_t i, uint32_t seed) {
    double x = sin(((double)i + (double)seed) * 12.9898) * 43758.5453;
    return (float)(x - floor(x));
}

void ww_signal_init(ww_signal_t *s, uint8_t sensor_type, uint32_t seed) {
    s->sensor_type = sensor_type;
    s->sample_rate_hz = ww_default_rate(sensor_type);
    s->seed = seed;
    if (sensor_type == WW_SENSOR_ACCELEROMETER) {
        /* Accel jitter comes from accel_hash(i), not a noise table — nothing to allocate. */
        s->noise = NULL;
        s->noise_len = 0;
        return;
    }
    uint32_t a; float amp;
    switch (sensor_type) {
        case WW_SENSOR_ECG:         a = seed;          s->noise_len = 4096; amp = 0.02f; break;
        case WW_SENSOR_SPO2:        a = seed ^ 0x5b02; s->noise_len = 1024; amp = 0.15f; break;
        case WW_SENSOR_HEARTRATE:   a = seed ^ 0x0b60; s->noise_len = 256;  amp = 1.2f;  break;
        default:                    a = seed ^ 0x7e3f; s->noise_len = 256;  amp = 0.02f; break;
    }
    s->noise = calloc(s->noise_len, sizeof(float));
    for (uint32_t i = 0; i < s->noise_len; i++) s->noise[i] = (mulberry_unit(&a) - 0.5f) * amp;
}

float ww_signal_at(const ww_signal_t *s, uint32_t i) {
    const float t = (float)i / (float)s->sample_rate_hz;
    const float n = s->noise ? s->noise[i % s->noise_len] : 0.0f;
    switch (s->sensor_type) {
        case WW_SENSOR_ECG: {
            const float bpm = 72.0f + 4.0f * sinf(t / 5.3f) + 2.0f * sinf(t / 17.0f);
            const float beat = 60.0f / bpm;
            const float phase = fmodf(t, beat) / beat;
            const float wave =
                bump(phase, 0.16f, 0.025f, 0.12f) +
                bump(phase, 0.36f, 0.010f, -0.15f) +
                bump(phase, 0.40f, 0.012f, 1.10f) +
                bump(phase, 0.44f, 0.012f, -0.25f) +
                bump(phase, 0.68f, 0.045f, 0.30f);
            return wave + 0.04f * sinf(t / 3.1f) + n;
        }
        case WW_SENSOR_SPO2: {
            const float m = fmodf(t, 240.0f);
            const float dip = (m > 200.0f && m < 212.0f) ? -2.5f * sinf((m - 200.0f) / 12.0f * (float)M_PI) : 0.0f;
            return 97.5f + 0.6f * sinf(t / 41.0f) + dip + n;
        }
        case WW_SENSOR_HEARTRATE:
            return 68.0f + 5.0f * sinf(t / 12.0f) + 2.5f * sinf(t / 3.3f) + n;
        case WW_SENSOR_ACCELEROMETER: {
            /* ~1 g with gentle sway, plus a textbook fall injected ~12 s in and every
               ~25 s after: free-fall dip -> impact spike -> a few seconds lying still.
               A C port of accelGenerator() in the phone's signals.ts. Replace this case
               with the MMA8452Q driver read (|a| = sqrt(x²+y²+z²)) when the AFE lands. */
            const uint16_t rate = s->sample_rate_hz;
            const long period = lroundf(25.0f * rate);
            const long first  = lroundf(12.0f * rate);
            const long ff     = lroundf(0.3f * rate);
            const long imp    = 3;
            const long still  = lroundf(3.0f * rate);
            const float h = accel_hash(i, s->seed);
            const long rel = (long)i - first;
            if (rel >= 0) {
                const long p = rel % period;
                if (p < ff) return 0.25f + 0.12f * h;                 /* free-fall ~0 g */
                if (p < ff + imp) return 4.6f + 2.2f * h;             /* impact spike */
                if (p < ff + imp + still) return 1.0f + 0.02f * (h - 0.5f); /* lying still ~1 g */
            }
            return 1.0f + 0.06f * sinf((float)i * 0.35f) + 0.03f * (h - 0.5f); /* everyday sway */
        }
        default:
            return 36.7f + 0.25f * sinf(t / 900.0f) + 0.05f * sinf(t / 61.0f) + n;
    }
}
