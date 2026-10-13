#include "SensorManager.h"
#include "FirmwareConfig.h"
#include "Logger.h"
#include "i2c_bus.h"
#include "WearWiseSensor.h"
#include "FallDetection.h"

#if WW_ENABLE_MAX30102
#include "MAX30102Sensor.h"
#endif
#if WW_ENABLE_MAX30205
#include "MAX30205Sensor.h"
#endif
#if WW_ENABLE_MMA8452Q
#include "MMA8452QSensor.h"
#endif
#if WW_ENABLE_AD8232
#include "AD8232Sensor.h"
#endif
#if WW_SIM_FALLBACK
#include "SimulatedSensor.h"
#endif

static const char *TAG = "ww-sensors";

#define MAX_SENSORS 6
#define MAX_CAPS    12
#define CODE_MAX    32   /* wire codes are small (1..6); index owner map by code */

static ww_sensor_t *s_active[MAX_SENSORS];
static int s_active_n;
static ww_capability_t s_caps[MAX_CAPS];
static int s_caps_n;
static ww_sensor_t *s_owner[CODE_MAX];   /* wire_code -> owning driver */
static ww_fall_t s_fall;
static bool s_fall_ready;

static void try_register(ww_sensor_t *s) {
    if (!s || s_active_n >= MAX_SENSORS) return;
    if (!ww_sensor_begin(s)) return;   /* not present / failed to init — skip silently */
    s_active[s_active_n++] = s;

    ww_capability_t tmp[6];
    size_t n = ww_sensor_caps(s, tmp, 6);
    for (size_t i = 0; i < n; i++) {
        uint8_t code = tmp[i].wire_code;
        if (code == 0 || code >= CODE_MAX) continue;          /* not streamed / out of range */
        if (s_owner[code]) continue;                          /* first owner of a code wins */
        if (s_caps_n >= MAX_CAPS) break;
        s_owner[code] = s;
        s_caps[s_caps_n++] = tmp[i];
        WW_LOGI(TAG, "  capability %s (code %u, %u Hz) via %s",
                ww_capability_name(tmp[i].cap), code, tmp[i].sample_rate_hz, ww_sensor_name(s));
#if WW_ENABLE_FALL_DETECTION
        if (code == WW_SENSOR_ACCELEROMETER && !s_fall_ready) {
            ww_fall_init(&s_fall, tmp[i].sample_rate_hz ? tmp[i].sample_rate_hz : 50);
            s_fall_ready = true;
        }
#endif
    }
}

void ww_sensors_init(void) {
    s_active_n = 0; s_caps_n = 0; s_fall_ready = false;
    for (int i = 0; i < CODE_MAX; i++) s_owner[i] = NULL;

    bool i2c = ww_i2c_init();
    WW_LOGI(TAG, "Scanning I2C...%s", i2c ? "" : " (bus unavailable)");
    /* Probing empty addresses makes the IDF i2c driver log a scary ERROR per NACK/timeout.
       Silence it during the scan; a real fault during streaming is caught by each driver's
       fail counter and reported via WW_LOGW. */
    esp_log_level_set("i2c.master", ESP_LOG_NONE);

#if WW_DEBUG
    /* Full-bus address dump — every device that ACKs. Helps diagnose a missing sensor
       (wrong address, not wired, or a detection-gate reject vs. a bus/wiring fault). */
    if (i2c) {
        int found = 0;
        for (uint8_t a = 0x08; a <= 0x77; a++)
            if (ww_i2c_probe(a)) { WW_LOGI(TAG, "  bus: device ACK at 0x%02X", a); found++; }
        WW_LOGI(TAG, "  bus: %d device(s) responding", found);
    }
#endif

#if WW_ENABLE_MAX30102
    if (i2c) try_register(ww_max30102_sensor());
#endif
#if WW_ENABLE_MAX30205
    if (i2c) try_register(ww_max30205_sensor());
#endif
#if WW_ENABLE_MMA8452Q
    if (i2c) try_register(ww_mma8452q_sensor());
#endif
#if WW_ENABLE_AD8232
    try_register(ww_ad8232_sensor());   /* not I2C — config-gated, not auto-detected */
#else
    WW_LOGI(TAG, "AD8232: disabled");
#endif
#if WW_SIM_FALLBACK
    try_register(ww_simulated_sensor());
#endif

    esp_log_level_set("i2c.master", ESP_LOG_WARN);   /* restore for runtime */
    WW_LOGI(TAG, "%d sensor(s) present, %d capability(ies)", s_active_n, s_caps_n);
}

size_t ww_sensors_capabilities(ww_capability_t *out, size_t max) {
    size_t n = ((size_t)s_caps_n < max) ? (size_t)s_caps_n : max;
    for (size_t i = 0; i < n; i++) out[i] = s_caps[i];
    return n;
}

void ww_sensors_update(void) {
    for (int i = 0; i < s_active_n; i++) ww_sensor_update(s_active[i]);
}

void ww_sensors_flush(void) {
    for (int i = 0; i < s_active_n; i++) ww_sensor_flush(s_active[i]);
}

uint8_t ww_sensors_status(uint8_t code) {
    if (code >= CODE_MAX || !s_owner[code]) return 0;
    return ww_sensor_status(s_owner[code], code);
}

uint16_t ww_sensors_read(uint8_t code, float *out, uint16_t max) {
    if (code >= CODE_MAX || !s_owner[code]) return 0;
    uint16_t n = ww_sensor_read(s_owner[code], code, out, max);
    if (code == WW_SENSOR_ACCELEROMETER && n > 0) {
        if (s_fall_ready) {
            for (uint16_t i = 0; i < n; i++) {
                ww_fall_event_t ev;
                if (ww_fall_push(&s_fall, out[i], &ev))
                    WW_LOGW(TAG, "possible fall detected (free-fall %.2f g, impact %.1f g)", ev.freefall_min_g, ev.impact_peak_g);
            }
        }
#if WW_ENABLE_MAX30102
        /* Motion → HR pipeline SQI (§16): EMA of |mag − 1 g| is a cheap motion-
           intensity proxy. Only flows while the accelerometer is being streamed;
           the pipeline treats silence as "motion unknown". */
        {
            static float s_motion;
            for (uint16_t i = 0; i < n; i++) {
                float dev = out[i] > 1.0f ? out[i] - 1.0f : 1.0f - out[i];
                s_motion += 0.05f * (dev - s_motion);
            }
            ww_max30102_report_motion(s_motion);
        }
#endif
    }
    return n;
}

int ww_sensors_present_count(void) { return s_active_n; }
