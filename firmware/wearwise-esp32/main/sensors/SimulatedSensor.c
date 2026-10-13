#include "SimulatedSensor.h"
#include "FirmwareConfig.h"
#include "signals.h"
#include "protocol.h"

/* The 5 classic simulated codes and their generators. */
#define NSIM 5
typedef struct {
    ww_signal_t sig[NSIM];
    uint8_t     code[NSIM];
    uint32_t    idx[NSIM];   /* advancing sample index per code */
    bool started;
} sim_t;

static sim_t s_state;

static const uint8_t CODES[NSIM] = {
    WW_SENSOR_ECG, WW_SENSOR_SPO2, WW_SENSOR_TEMPERATURE, WW_SENSOR_HEARTRATE, WW_SENSOR_ACCELEROMETER
};

static int slot_for(sim_t *st, uint8_t code) {
    for (int i = 0; i < NSIM; i++) if (st->code[i] == code) return i;
    return -1;
}

static bool m_begin(ww_sensor_t *self) {
    sim_t *st = self->impl;
    for (int i = 0; i < NSIM; i++) {
        st->code[i] = CODES[i];
        st->idx[i] = 0;
        ww_signal_init(&st->sig[i], CODES[i], 0x51ULL ^ CODES[i]);
    }
    st->started = true;
    return true;   /* the "sensor" is always present */
}

static void m_update(ww_sensor_t *self) { (void)self; /* generated on demand in read() */ }
static bool m_available(ww_sensor_t *self) { return ((sim_t *)self->impl)->started; }
static const char *m_name(ww_sensor_t *self) { (void)self; return "Simulated"; }

static size_t m_caps(ww_sensor_t *self, ww_capability_t *out, size_t max) {
    sim_t *st = self->impl;
    static const ww_capability_type_t CAP[NSIM] = {
        WW_CAP_ECG, WW_CAP_SPO2, WW_CAP_TEMPERATURE, WW_CAP_HEART_RATE, WW_CAP_ACCELERATION };
    static const ww_unit_t UNIT[NSIM] = {
        WW_UNIT_MILLIVOLT, WW_UNIT_PERCENT, WW_UNIT_CELSIUS, WW_UNIT_BPM, WW_UNIT_G };
    size_t n = 0;
    for (int i = 0; i < NSIM && n < max; i++)
        out[n++] = (ww_capability_t){ CAP[i], st->code[i], st->sig[i].sample_rate_hz, UNIT[i] };
    return n;
}

static uint16_t m_read(ww_sensor_t *self, uint8_t code, float *out, uint16_t max) {
    sim_t *st = self->impl;
    int slot = slot_for(st, code);
    if (slot < 0) return 0;
    uint16_t rate = st->sig[slot].sample_rate_hz;
    uint16_t want = (uint16_t)((uint32_t)rate * WW_BURST_MS / 1000);
    if (want < 1) want = 1;
    if (want > max) want = max;
    for (uint16_t k = 0; k < want; k++) out[k] = ww_signal_at(&st->sig[slot], st->idx[slot] + k);
    st->idx[slot] += want;
    return want;
}

static const ww_sensor_vtable_t VT = { m_begin, m_update, m_available, m_name, m_caps, m_read, NULL /* generated on demand */, NULL /* no status bits */ };
static ww_sensor_t s_sensor = { &VT, &s_state };

ww_sensor_t *ww_simulated_sensor(void) { return &s_sensor; }
