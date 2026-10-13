/* WearWise generic measurement model.
 *
 * The firmware thinks in CAPABILITY types (what is measured), while the BLE wire and
 * the app think in numeric SensorType codes. This header is the single bridge between
 * the two: a capability enum, its human name, its unit, and the wire code it maps to.
 *
 * IMPORTANT compatibility rule: the wire codes are FROZEN and shared with the app via
 * packages/sensor-protocol. A physical sensor's output is mapped onto an EXISTING wire
 * code wherever one exists (so the app needs no change); only genuinely-new streams get
 * a new code, appended, never renumbered.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "protocol.h"   /* WW_SENSOR_ECG..WW_SENSOR_PPG wire codes (resolved via INCLUDE_DIRS) */

/* Generic capability vocabulary the app understands (labels/units live app-side too). */
typedef enum {
    WW_CAP_HEART_RATE,
    WW_CAP_SPO2,
    WW_CAP_TEMPERATURE,
    WW_CAP_ECG,
    WW_CAP_PPG,
    WW_CAP_ACCELERATION,   /* streamed as magnitude |a| on the wire (fall detection consumes it) */
    WW_CAP_MOTION,         /* derived/status, not a scalar stream */
    WW_CAP_FALL_EVENT,     /* derived on-device, not a scalar stream */
    WW_CAP_BATTERY,        /* device status, not a scalar stream */
    WW_CAP_DEVICE_STATUS,  /* exposed via GATT INFO/WIFI reads, not a packet */
    WW_CAP_UNKNOWN,
} ww_capability_type_t;

typedef enum {
    WW_UNIT_NONE, WW_UNIT_BPM, WW_UNIT_PERCENT, WW_UNIT_CELSIUS, WW_UNIT_MILLIVOLT,
    WW_UNIT_G, WW_UNIT_COUNT,
} ww_unit_t;

/* What a driver advertises: a wire code it will stream and the rate it streams at.
 * `cap` is the generic type (for logs/README); `wire_code` is what CAPS/DATA carry. */
typedef struct {
    ww_capability_type_t cap;
    uint8_t  wire_code;      /* WW_SENSOR_* — 0 means "not streamed on the wire" */
    uint16_t sample_rate_hz;
    ww_unit_t unit;
} ww_capability_t;

/* One generic measurement (used for low-rate scalars and for logging). High-rate
 * streams (ECG/PPG/accel) are moved as sample buffers via the sensor read() path,
 * never one struct per sample. */
typedef struct {
    uint8_t  wire_code;
    uint32_t timestamp_ms;
    float    value;
    ww_unit_t unit;
    uint8_t  quality;       /* 0..100, driver-defined confidence (0 = unknown) */
} ww_measurement_t;

static inline const char *ww_capability_name(ww_capability_type_t c) {
    switch (c) {
        case WW_CAP_HEART_RATE:    return "heart_rate";
        case WW_CAP_SPO2:          return "spo2";
        case WW_CAP_TEMPERATURE:   return "temperature";
        case WW_CAP_ECG:           return "ecg";
        case WW_CAP_PPG:           return "ppg";
        case WW_CAP_ACCELERATION:  return "acceleration";
        case WW_CAP_MOTION:        return "motion";
        case WW_CAP_FALL_EVENT:    return "fall_event";
        case WW_CAP_BATTERY:       return "battery";
        case WW_CAP_DEVICE_STATUS: return "device_status";
        default:                   return "unknown";
    }
}
