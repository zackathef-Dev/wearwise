/* SimulatedSensor — wraps the existing deterministic signal generators (signals.c) in the
 * WearWiseSensor interface, so a board with no hardware can still stream the 5 classic
 * signals for app testing. Only compiled in when WW_SIM_FALLBACK is set (Profile 'S').
 * This keeps the proven simulation code alive without it being on the default real-HW path.
 */
#pragma once
#include "WearWiseSensor.h"

ww_sensor_t *ww_simulated_sensor(void);
