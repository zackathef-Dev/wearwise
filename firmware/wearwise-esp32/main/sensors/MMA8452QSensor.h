/* MMA8452Q — 3-axis I2C accelerometer. Maps to WearWise ACCELERATION (code 5), streamed
 * as the magnitude |a| = sqrt(x^2+y^2+z^2) in g so the existing app + fall detection are
 * unchanged. Real identity check via WHO_AM_I (0x0D == 0x2A). Address 0x1C or 0x1D.
 * The per-sample magnitudes are also handed to the fall-detection algorithm (§13).
 */
#pragma once
#include "WearWiseSensor.h"

#define MMA8452Q_ADDR_A 0x1C
#define MMA8452Q_ADDR_B 0x1D
#define MMA8452Q_WHOAMI 0x2A

ww_sensor_t *ww_mma8452q_sensor(void);
