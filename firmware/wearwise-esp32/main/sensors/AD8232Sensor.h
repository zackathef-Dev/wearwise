/* AD8232 — analog single-lead ECG front-end. Maps to WearWise ECG (code 1).
 *
 * NOT an I2C device and CANNOT self-identify (§6): it is only registered when
 * WW_ENABLE_AD8232 is set. Sampled at WW_ECG_SAMPLE_RATE_HZ (default 250 Hz) by a
 * periodic esp_timer + adc_oneshot on WW_ECG_ADC — non-blocking, no delay(). Lead-off
 * is read from WW_ECG_LO_PLUS / WW_ECG_LO_MINUS; while a lead is off the sample is
 * flagged and flat-lined rather than streaming amplifier noise.
 *
 * SAFETY (§21): research/education only, NOT a diagnostic device. When electrodes are
 * on a person, run the board from a battery / power bank, not mains-connected USB.
 */
#pragma once
#include "WearWiseSensor.h"

ww_sensor_t *ww_ad8232_sensor(void);
