/* WearWise hardware pin map — the single place board wiring is defined.
 *
 * These are the WearWise DEFAULT pins for an ESP-WROOM-32. A different board only
 * needs a different copy of this header (or overrides in FirmwareConfig.h). Two
 * exceptions are fixed in their drivers: the BOOT button (GPIO0, ble_pairing.c) and the
 * ECG ADC channel (ADC_CHANNEL_6 = GPIO34, AD8232Sensor.c), so moving WW_ECG_ADC also
 * needs the channel changed there.
 */
#pragma once

/* ---- I2C bus (shared by all I2C sensors: MAX30102, MAX30205, MMA8452Q, ...) ---- */
#define WW_I2C_PORT       0        /* ESP-IDF I2C peripheral number */
#define WW_I2C_SDA        21       /* GPIO21 */
#define WW_I2C_SCL        22       /* GPIO22 */
#define WW_I2C_FREQ_HZ    400000   /* 400 kHz fast-mode; sensors above tolerate it */
#define WW_I2C_TIMEOUT_MS 50       /* per-transaction ceiling so one dead device can't stall the bus */

/* ---- AD8232 analog ECG front-end (NOT on I2C — cannot self-identify) ---- */
#define WW_ECG_ADC        34       /* GPIO34 — ADC1_CH6, input-only, ECG output */
#define WW_ECG_LO_PLUS    32       /* GPIO32 — LO+ lead-off detect */
#define WW_ECG_LO_MINUS   33       /* GPIO33 — LO- lead-off detect */

/* ---- Motion interrupt (MMA8452Q INT1, optional) ---- */
#define WW_MOTION_INT     27       /* GPIO27 */

/* ---- SPI (reserved for future digital sensors, e.g. MAX30003 ECG) ---- */
#define WW_SPI_SCK        18       /* GPIO18 */
#define WW_SPI_MISO       19       /* GPIO19 */
#define WW_SPI_MOSI       23       /* GPIO23 */

/* ---- Battery monitor (optional; needs a divider on an ADC pin) ---- */
#define WW_BATTERY_ADC    (-1)     /* -1 = not fitted on this board */
