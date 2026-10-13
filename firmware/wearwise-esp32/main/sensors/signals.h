/* Simulated physiology — a C port of apps/mobile/src/data/simulation/signals.ts.
 *
 * No sensor front-end is attached to this board yet, so the firmware produces
 * the same deterministic shapes the phone's own simulation does, and flags every
 * packet WW_FLAG_SIMULATED. When an AFE lands, ww_signal_at() is what gets
 * replaced by a driver read; nothing above it changes.
 */
#pragma once
#include <stdint.h>

typedef struct {
    uint8_t sensor_type;
    uint16_t sample_rate_hz;
    uint32_t seed;
    float *noise;
    uint32_t noise_len;
} ww_signal_t;

/* Allocates the noise table once; seed determines the stream forever after. */
void ww_signal_init(ww_signal_t *s, uint8_t sensor_type, uint32_t seed);

/* Value at absolute sample index i, in physical units. Pure. */
float ww_signal_at(const ww_signal_t *s, uint32_t i);

uint16_t ww_default_rate(uint8_t sensor_type);
