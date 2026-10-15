/* MAX30205 — I2C human-body temperature sensor. Maps to WearWise TEMPERATURE (code 3).
 *
 * No WHO_AM_I register exists, so identity is inferred from an ACK on a known address
 * PLUS a plausible temperature reading (§5: prefer real verification over address alone).
 * Default address 0x48; the driver scans the A0-A2 range 0x48..0x4F.
 */
#pragma once
#include "WearWiseSensor.h"

#define MAX30205_ADDR_LO 0x48
#define MAX30205_ADDR_HI 0x4F

/* Returns the (static, single) MAX30205 sensor instance with its vtable wired. */
ww_sensor_t *ww_max30205_sensor(void);
