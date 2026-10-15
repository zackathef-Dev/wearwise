#include "MAX30205Sensor.h"
#include "i2c_bus.h"
#include "Logger.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "ww-max30205";

#define REG_TEMP   0x00
#define REG_CONFIG 0x01
#define REG_THYST  0x02
#define REG_TOS    0x03
#define CONFIG_CONTINUOUS 0x00  /* continuous conversion, comparator mode (matches ProtoCentral) */
#define SAMPLE_MS  500          /* ~2 Hz — body temperature moves slowly */
#define MAX_FAILS  5

typedef struct {
    uint8_t addr;
    bool present;
    int fails;
    int64_t last_us;
    float latest_c;
    bool has_new;
    bool extended;   /* CONFIG D5: extended format adds a 64 C offset */
    int log_div;
} max30205_t;

static max30205_t s_state;

static int64_t now_us(void) { return esp_timer_get_time(); }

/* Decode per the datasheet: 16-bit two's complement, 1 LSB = 1/256 C, plus a 64 C
   offset ONLY in extended format. The mode is read from CONFIG D5 rather than assumed —
   this part reports extended even though we write D5 clear, and hard-coding the offset
   would read 64 C wrong the moment a part (or a power cycle) landed in normal mode.
   Cross-checked against ProtoCentral's reference library, which uses raw/256 with no
   offset after writing config 0x00. */
static bool read_temp_at(uint8_t addr, bool extended, int16_t *raw_out, float *out) {
    uint8_t b[2];
    if (!ww_i2c_read_reg(addr, REG_TEMP, b, 2)) return false;
    int16_t raw = (int16_t)((b[0] << 8) | b[1]);
    if (raw_out) *raw_out = raw;
    *out = ((float)raw / 256.0f) + (extended ? 64.0f : 0.0f);
    return true;
}

static bool m_begin(ww_sensor_t *self) {
    max30205_t *st = self->impl;
    st->present = false;
    st->fails = 0;
    for (uint8_t a = MAX30205_ADDR_LO; a <= MAX30205_ADDR_HI; a++) {
        if (!ww_i2c_probe(a)) continue;
        if (!ww_i2c_write_reg(a, REG_CONFIG, CONFIG_CONTINUOUS)) continue;
        vTaskDelay(pdMS_TO_TICKS(120));
        uint8_t cfg = 0xFF;
        /* Read the config back. The +64 C offset this driver applies belongs to the
           datasheet's EXTENDED format (D5 set), yet we write D5 clear — so either the
           write does not stick, the part powers up extended, or this module is not a
           genuine MAX30205. Logging D5 tells us which, instead of guessing. */
        {
            /* Fingerprint the part. A genuine MAX30205 powers up with THYST(0x02)=0x4B00
               (75 C) and TOS(0x03)=0x5000 (80 C); those defaults plus the config we just
               wrote identify the silicon. This matters because ProtoCentral's reference
               library and the datasheet both convert as raw/256 with NO offset after
               writing config 0x00 — the +64 this driver applies is therefore a
               compensation for something, and the fingerprint says what. */
            uint8_t hy[2] = {0}, os[2] = {0};
            bool cfg_ok = ww_i2c_read_reg(a, REG_CONFIG, &cfg, 1);
            bool hy_ok  = ww_i2c_read_reg(a, REG_THYST, hy, 2);
            bool os_ok  = ww_i2c_read_reg(a, REG_TOS, os, 2);
            WW_LOGD(TAG, "fingerprint 0x%02X: cfg(ok=%d)=0x%02X D5=%d | THYST(ok=%d)=0x%02X%02X (MAX30205:0x4B00) | TOS(ok=%d)=0x%02X%02X (MAX30205:0x5000)",
                    a, (int)cfg_ok, cfg, (int)((cfg >> 5) & 1),
                    (int)hy_ok, hy[0], hy[1], (int)os_ok, os[0], os[1]);
        }
        /* Retry the identity read. Capabilities are built once at startup, so a single
           marginal first conversion (seen on hardware: an ACK at 0x48 that produced no
           temperature capability for the whole session) would silently cost temperature
           until the next reboot. Three attempts across ~360 ms is still fast at boot. */
        bool ext = ((cfg >> 5) & 1) != 0;
        float t = 0; int16_t raw = 0; bool got = false;
        for (int attempt = 0; attempt < 3 && !got; attempt++) {
            if (attempt) vTaskDelay(pdMS_TO_TICKS(120));
            got = read_temp_at(a, ext, &raw, &t) && t > -20.0f && t < 80.0f;
            WW_LOGD(TAG, "probe 0x%02X try %d: ok=%d raw=0x%04X ext=%d -> %.2f C",
                    a, attempt, (int)got, (unsigned)(uint16_t)raw, (int)ext, t);
        }
        /* If the reported mode yields nonsense but the OTHER mode is plausible, trust the
           data over the register and say so loudly — that is a real discrepancy worth
           seeing in the log, not something to paper over silently. */
        if (!got) {
            float alt = ((float)raw / 256.0f) + (ext ? 0.0f : 64.0f);
            if (alt > -20.0f && alt < 80.0f) {
                WW_LOGW(TAG, "0x%02X: CONFIG says extended=%d but that decodes to %.2f C; "
                             "using the opposite mode (%.2f C). Verify against a reference thermometer.",
                        a, (int)ext, t, alt);
                ext = !ext; t = alt; got = true;
            }
        }
        if (got) {
            st->extended = ext;
            st->addr = a;
            st->present = true;
            st->latest_c = t;
            st->has_new = true;
            st->last_us = now_us();
            WW_LOGI(TAG, "0x%02X detected -> MAX30205 (%.2f C, %s format)", a, t, ext ? "extended" : "normal");
            return true;
        }
    }
    return false;
}

static void m_update(ww_sensor_t *self) {
    max30205_t *st = self->impl;
    if (!st->present) return;
    if (now_us() - st->last_us < (int64_t)SAMPLE_MS * 1000) return;
    st->last_us = now_us();
    float t;
    if (read_temp_at(st->addr, st->extended, NULL, &t)) {
        st->latest_c = t;
        st->has_new = true;
        st->fails = 0;
        if (++st->log_div >= 10) { st->log_div = 0; WW_LOGD(TAG, "temperature %.2f C", t); }
    } else if (++st->fails >= MAX_FAILS) {
        st->present = false;   /* degrade gracefully — manager drops the capability */
        WW_LOGW(TAG, "lost MAX30205 after %d I2C errors", st->fails);
    }
}

static bool m_available(ww_sensor_t *self) { return ((max30205_t *)self->impl)->present; }
static const char *m_name(ww_sensor_t *self) { (void)self; return "MAX30205"; }

static size_t m_caps(ww_sensor_t *self, ww_capability_t *out, size_t max) {
    if (!((max30205_t *)self->impl)->present || max < 1) return 0;
    out[0] = (ww_capability_t){ WW_CAP_TEMPERATURE, WW_SENSOR_TEMPERATURE, 2, WW_UNIT_CELSIUS };
    return 1;
}

static uint16_t m_read(ww_sensor_t *self, uint8_t code, float *out, uint16_t max) {
    max30205_t *st = self->impl;
    if (code != WW_SENSOR_TEMPERATURE || !st->present || !st->has_new || max < 1) return 0;
    out[0] = st->latest_c;
    st->has_new = false;
    return 1;
}

static const ww_sensor_vtable_t VT = { m_begin, m_update, m_available, m_name, m_caps, m_read, NULL /* no ring to flush */, NULL /* no status bits */ };
static ww_sensor_t s_sensor = { &VT, &s_state };

ww_sensor_t *ww_max30205_sensor(void) { return &s_sensor; }
