/* Shared I2C master bus for all WearWise I2C sensors.
 *
 * One bus (WW_I2C_SDA/SCL), created once at boot. Sensors address it through these
 * helpers rather than each opening their own driver, so bus init, timeouts and error
 * handling live in one place. Every call is bounded by WW_I2C_TIMEOUT_MS — a wedged
 * device can never stall the firmware (§17).
 *
 * All calls are thread-safe for the single stream task; do not call from an ISR.
 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Create the master bus on the configured pins. Idempotent; returns true on success
   (or if already initialised). false means no I2C is available (drivers then stay
   absent — the firmware still boots). */
bool ww_i2c_init(void);

/* Does a device ACK its address? Used by the bus scan. */
bool ww_i2c_probe(uint8_t addr);

/* Write one register address, then read `len` bytes (repeated-start). */
bool ww_i2c_read_reg(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len);

/* Write a single [reg, value] pair. */
bool ww_i2c_write_reg(uint8_t addr, uint8_t reg, uint8_t value);

/* Read one register byte (convenience over ww_i2c_read_reg). Returns false on error. */
bool ww_i2c_read_u8(uint8_t addr, uint8_t reg, uint8_t *out);
