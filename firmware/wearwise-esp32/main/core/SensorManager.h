/* SensorManager — boots the sensor layer and presents a uniform view to the BLE/stream
 * code. It initialises I2C, asks each compiled-in driver to detect its chip (auto-detect
 * for I2C via chip-ID; config-gated for AD8232), aggregates the capabilities of whatever
 * is actually present, and dispatches per-code sample reads to the owning driver. The
 * accelerometer magnitude it streams is also fed to the fall detector.
 *
 * A board with no sensors initialises cleanly and reports zero capabilities (Profile D).
 */
#pragma once
#include "MeasurementTypes.h"

/* I2C up, scan the bus, begin() every enabled driver, build the capability list. */
void ww_sensors_init(void);

/* Copy the aggregated capability list (one entry per streamable wire code). Returns count. */
size_t ww_sensors_capabilities(ww_capability_t *out, size_t max);

/* Acquisition tick — call frequently (every stream tick). Non-blocking. */
void ww_sensors_update(void);

/* Discard every sensor's buffered samples — call at session START so streaming opens with
   fresh data instead of the backlog that accrued while idle. */
void ww_sensors_flush(void);

/* Drain up to `max` fresh samples (physical units) for `wire_code` from its owning driver.
   Accelerometer samples are additionally fed to fall detection here. Returns count. */
uint16_t ww_sensors_read(uint8_t wire_code, float *out, uint16_t max);

/* Read-and-clear the owning driver's WW_SENSOR_STATUS_* bits for `wire_code`. */
uint8_t ww_sensors_status(uint8_t wire_code);

/* Number of physical sensors detected (for the startup banner / status). */
int ww_sensors_present_count(void);
