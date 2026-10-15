/* WearWiseSensor — the common driver interface every sensor implements.
 *
 * C has no classes, so the "base class" is a vtable (a struct of function pointers)
 * plus an opaque `impl` for the driver's private state. Conceptually identical to the
 * brief's WearWiseSensor { begin(); update(); isAvailable(); getName(); getType(); }.
 *
 * Two-phase data model so nothing blocks:
 *   - update()  is called often (every scheduler tick). The driver does its NON-BLOCKING
 *               I2C/ADC work here and pushes samples into its own internal buffer.
 *   - read()    is called once per stream burst to drain up-to-`max` fresh samples for
 *               one wire code, in physical units. Slow scalars return 0 or 1; high-rate
 *               streams (ECG/PPG/accel) return however many accumulated since last read.
 */
#pragma once
#include <stdbool.h>
#include "MeasurementTypes.h"

typedef struct ww_sensor ww_sensor_t;

typedef struct {
    /* One-time init: probe/verify the chip (chip-ID register where possible), configure
       it, return true only if the device is really present and healthy. */
    bool (*begin)(ww_sensor_t *self);
    /* Non-blocking acquisition tick. Must never delay(); drains FIFOs / reads registers
       and buffers results. Safe to call when the sensor is absent (no-op). */
    void (*update)(ww_sensor_t *self);
    /* True while the sensor is present and last I/O succeeded (drops false on repeated
       I2C errors so the manager can degrade gracefully instead of crashing). */
    bool (*available)(ww_sensor_t *self);
    const char *(*name)(ww_sensor_t *self);
    /* Fill `out` (capacity `max`) with the wire codes + rates this driver streams.
       Returns the count written. */
    size_t (*capabilities)(ww_sensor_t *self, ww_capability_t *out, size_t max);
    /* Drain up to `max` fresh samples for `wire_code` into `out` (physical units).
       Returns count written (0 if none ready or code not provided). Non-blocking. */
    uint16_t (*read)(ww_sensor_t *self, uint8_t wire_code, float *out, uint16_t max);
    /* Discard buffered samples so a new session starts fresh (drivers keep acquiring
       while idle to stay warm, so their rings must be emptied at START or the stream
       opens with stale data and a permanent latency). May be NULL (no buffering). */
    void (*flush)(ww_sensor_t *self);
    /* Read-and-clear status bits (WW_SENSOR_STATUS_*) latched since the last call for
       `wire_code`. Called once per stream burst, after read(). May be NULL. */
    uint8_t (*status)(ww_sensor_t *self, uint8_t wire_code);
} ww_sensor_vtable_t;

/* Sensor status bits — the stream task maps these onto packet flags. */
#define WW_SENSOR_STATUS_LEADS_OFF 0x01   /* ECG electrode(s) detached at some point */

struct ww_sensor {
    const ww_sensor_vtable_t *vt;
    void *impl;    /* driver-private state */
};

/* Thin dispatch helpers (readability at call sites). */
static inline bool        ww_sensor_begin(ww_sensor_t *s)                 { return s->vt->begin(s); }
static inline void        ww_sensor_update(ww_sensor_t *s)                { s->vt->update(s); }
static inline bool        ww_sensor_available(ww_sensor_t *s)             { return s->vt->available(s); }
static inline const char *ww_sensor_name(ww_sensor_t *s)                  { return s->vt->name(s); }
static inline size_t      ww_sensor_caps(ww_sensor_t *s, ww_capability_t *o, size_t m) { return s->vt->capabilities(s, o, m); }
static inline uint16_t    ww_sensor_read(ww_sensor_t *s, uint8_t code, float *o, uint16_t m) { return s->vt->read(s, code, o, m); }
static inline void        ww_sensor_flush(ww_sensor_t *s) { if (s->vt->flush) s->vt->flush(s); }
static inline uint8_t     ww_sensor_status(ww_sensor_t *s, uint8_t code) { return s->vt->status ? s->vt->status(s, code) : 0; }
