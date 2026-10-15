/* MAX30102 — I2C pulse-oximeter / heart-rate optical sensor (RED + IR).
 *
 * Acquisition layer ONLY: FIFO drain at 100 Hz, automatic LED-current control, and
 * chip identity (PART_ID 0xFF == 0x15, address 0x57). All physiology lives in
 * algorithms/HRPipeline (accuracy-first beat detection → IBI statistics → HR/SpO2),
 * which this driver feeds one sample pair at a time.
 *
 * Wire mapping: HEART_RATE (code 4, 1 Hz, published only when the pipeline judges
 * the estimate valid), SPO2 (code 2, 1 Hz, same gating), PPG (code 6, 100 Hz — the
 * band-passed IR waveform). HR/SpO2 silence during poor signal is intentional: the
 * app renders the gap as "—" instead of a fabricated number.
 */
#pragma once
#include "WearWiseSensor.h"

#define MAX30102_ADDR   0x57
#define MAX30102_PARTID 0x15

ww_sensor_t *ww_max30102_sensor(void);

/* Motion feed (optional): RMS-ish deviation of |a| from 1 g, from the accelerometer.
   Improves the pipeline's SQI during movement; safe to never call. */
void ww_max30102_report_motion(float g_dev);
