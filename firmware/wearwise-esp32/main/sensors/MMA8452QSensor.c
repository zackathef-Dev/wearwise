#include "MMA8452QSensor.h"
#include "i2c_bus.h"
#include "Logger.h"
#include <math.h>

static const char *TAG = "ww-mma8452q";

#define REG_STATUS       0x00
#define REG_OUT_X_MSB    0x01
#define REG_WHO_AM_I     0x0D
#define REG_XYZ_DATA_CFG 0x0E
#define REG_CTRL_REG1    0x2A

#define RANGE_8G         0x02   /* XYZ_DATA_CFG[1:0]: ±8 g -> 256 counts/g, headroom for impacts */
#define COUNTS_PER_G     256.0f
#define ODR_50HZ         (0x04 << 3)  /* CTRL_REG1 data-rate field = 100b (50 Hz) */
#define CTRL_ACTIVE      0x01

#define RING 32
#define MAX_FAILS 5

typedef struct {
    uint8_t addr;
    bool present;
    int fails;
    float ring[RING];
    int head, count;
} mma_t;

static mma_t s_state;

static void ring_push(mma_t *st, float v) {
    st->ring[st->head] = v;
    st->head = (st->head + 1) % RING;
    if (st->count < RING) st->count++;   /* full ring overwrites oldest */
}

static bool configure(uint8_t addr) {
    /* Must be in standby (ACTIVE=0) to change config registers. */
    if (!ww_i2c_write_reg(addr, REG_CTRL_REG1, 0x00)) return false;
    if (!ww_i2c_write_reg(addr, REG_XYZ_DATA_CFG, RANGE_8G)) return false;
    if (!ww_i2c_write_reg(addr, REG_CTRL_REG1, ODR_50HZ | CTRL_ACTIVE)) return false;
    return true;
}

static bool m_begin(ww_sensor_t *self) {
    mma_t *st = self->impl;
    st->present = false; st->fails = 0; st->head = 0; st->count = 0;
    const uint8_t addrs[2] = { MMA8452Q_ADDR_A, MMA8452Q_ADDR_B };
    for (int i = 0; i < 2; i++) {
        uint8_t who;
        if (!ww_i2c_probe(addrs[i])) continue;
        if (!ww_i2c_read_u8(addrs[i], REG_WHO_AM_I, &who) || who != MMA8452Q_WHOAMI) continue;
        if (!configure(addrs[i])) continue;
        st->addr = addrs[i];
        st->present = true;
        WW_LOGI(TAG, "0x%02X detected -> MMA8452Q (WHO_AM_I 0x%02X)", addrs[i], who);
        return true;
    }
    return false;
}

static void m_update(ww_sensor_t *self) {
    mma_t *st = self->impl;
    if (!st->present) return;
    uint8_t b[6];
    if (!ww_i2c_read_reg(st->addr, REG_OUT_X_MSB, b, 6)) {
        if (++st->fails >= MAX_FAILS) { st->present = false; WW_LOGW(TAG, "lost MMA8452Q"); }
        return;
    }
    st->fails = 0;
    /* 12-bit left-justified, two's complement. */
    int16_t x = (int16_t)(((uint16_t)b[0] << 8) | b[1]) >> 4;
    int16_t y = (int16_t)(((uint16_t)b[2] << 8) | b[3]) >> 4;
    int16_t z = (int16_t)(((uint16_t)b[4] << 8) | b[5]) >> 4;
    float gx = x / COUNTS_PER_G, gy = y / COUNTS_PER_G, gz = z / COUNTS_PER_G;
    ring_push(st, sqrtf(gx * gx + gy * gy + gz * gz));
}

static bool m_available(ww_sensor_t *self) { return ((mma_t *)self->impl)->present; }
static const char *m_name(ww_sensor_t *self) { (void)self; return "MMA8452Q"; }

static size_t m_caps(ww_sensor_t *self, ww_capability_t *out, size_t max) {
    if (!((mma_t *)self->impl)->present || max < 1) return 0;
    out[0] = (ww_capability_t){ WW_CAP_ACCELERATION, WW_SENSOR_ACCELEROMETER, 50, WW_UNIT_G };
    return 1;
}

static uint16_t m_read(ww_sensor_t *self, uint8_t code, float *out, uint16_t max) {
    mma_t *st = self->impl;
    if (code != WW_SENSOR_ACCELEROMETER || !st->present) return 0;
    uint16_t n = 0;
    while (st->count > 0 && n < max) {
        int tail = (st->head - st->count + RING) % RING;
        out[n++] = st->ring[tail];
        st->count--;
    }
    return n;
}

static void m_flush(ww_sensor_t *self) { mma_t *st = self->impl; st->head = 0; st->count = 0; }

static const ww_sensor_vtable_t VT = { m_begin, m_update, m_available, m_name, m_caps, m_read, m_flush, NULL /* no status bits */ };
static ww_sensor_t s_sensor = { &VT, &s_state };

ww_sensor_t *ww_mma8452q_sensor(void) { return &s_sensor; }
