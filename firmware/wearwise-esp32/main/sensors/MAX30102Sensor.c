#include "MAX30102Sensor.h"
#include "HRPipeline.h"
#include "FirmwareConfig.h"
#include "i2c_bus.h"
#include "Logger.h"
#include <string.h>
#include <stdio.h>

static const char *TAG = "ww-max30102";

/* Registers */
#define REG_INT_STATUS 0x00
#define REG_OVF_CNT    0x05
#define REG_FIFO_WR    0x04
#define REG_FIFO_RD    0x06
#define REG_FIFO_DATA  0x07
#define REG_FIFO_CFG   0x08
#define REG_MODE_CFG   0x09
#define REG_SPO2_CFG   0x0A
#define REG_LED1_PA    0x0C
#define REG_LED2_PA    0x0D
#define REG_PART_ID    0xFF

/* Acquisition configuration (§1, §19):
 *  - SPO2_CFG 0x27 = ADC range 4096 nA · 100 Hz · 411 µs / 18-bit
 *  - FIFO_CFG 0x10 = SMP_AVE=1 (hardware averaging DISABLED — averaging halves the
 *    effective bandwidth and smears pulse timing; all filtering is deliberate and
 *    digital in HRPipeline where its response is known), rollover enabled.
 *  - LED current is NOT pinned at maximum: it starts mid-range and a slow AGC
 *    walks it toward a DC target with hysteresis (§18). */
#define FS_HZ            100
#define CFG_SPO2         0x27
#define CFG_FIFO         0x10
#define LED_START        0x24     /* ~7.2 mA */
#define LED_MIN          0x08     /* ~1.6 mA */
#define LED_MAX          0x50     /* ~16 mA — well under the 50 mA ceiling */
#define AGC_PERIOD_SMPL  (FS_HZ * 2)          /* evaluate every 2 s — slow on purpose */
#define AGC_DC_LO        40000.0f             /* raise LED below this */
#define AGC_DC_HI        180000.0f            /* lower LED above this (headroom) */
#define DIAG_PERIOD_SMPL (FS_HZ * 30)         /* summary log every 30 s */
#define TRACE_PERIOD_SMPL (FS_HZ * 2)         /* WW_HR_DEBUG: HR vs rhythm every 2 s */

typedef struct {
    bool present; int fails;
    uint8_t led;
    uint32_t since_agc, since_diag, since_trace;
    ww_hr_t hr;                                /* the entire measurement pipeline */
} max_t;

static max_t s_state;

static bool cfg_write(uint8_t reg, uint8_t v) { return ww_i2c_write_reg(MAX30102_ADDR, reg, v); }

static bool configure(max_t *st) {
    if (!cfg_write(REG_MODE_CFG, 0x40)) return false;      /* RESET */
    for (int i = 0; i < 50; i++) {                          /* poll RESET clear (boot only) */
        uint8_t m;
        if (ww_i2c_read_u8(MAX30102_ADDR, REG_MODE_CFG, &m) && !(m & 0x40)) break;
    }
    bool ok = true;
    ok &= cfg_write(REG_FIFO_WR, 0x00);
    ok &= cfg_write(REG_FIFO_RD, 0x00);
    ok &= cfg_write(REG_OVF_CNT, 0x00);
    ok &= cfg_write(REG_FIFO_CFG, CFG_FIFO);
    ok &= cfg_write(REG_SPO2_CFG, CFG_SPO2);
    ok &= cfg_write(REG_LED1_PA, st->led);                 /* RED */
    ok &= cfg_write(REG_LED2_PA, st->led);                 /* IR */
    ok &= cfg_write(REG_MODE_CFG, 0x03);                   /* SpO2 mode (RED+IR) */
    return ok;
}

/* §18: slow automatic signal-level control with hysteresis. One small step per
   2 s window at most; every step opens a settle window in the pipeline so the
   moved baseline can't masquerade as pulses. */
static void agc(max_t *st) {
    float dc = ww_hr_dc_ir(&st->hr);
    uint8_t led = st->led;
    /* Never judge the DC while it is still converging (settle window): at finger
       placement the level sweeps up through the "too low" band, and the AGC used to
       chase it with repeated LED steps — each one arming another settle window that
       rejected beats. That feedback loop was the long tail on acquisition time. */
    if (st->hr.idx < st->hr.settle_until) return;
    if (ww_hr_diag(&st->hr)->clipped_samples > 0 && st->hr.clip_recent > 0 && led > LED_MIN) {
        led = (led >= LED_MIN + 2) ? led - 2 : LED_MIN;    /* clipping: back off faster */
    } else if (dc > AGC_DC_HI && led > LED_MIN) {
        led -= 1;
    } else if (dc < AGC_DC_LO && dc > 1000.0f && led < LED_MAX) {
        led += 1;                                          /* dc<=1000 ≈ off-skin: don't blast the LED */
    }
    if (led != st->led) {
        st->led = led;
        cfg_write(REG_LED1_PA, led);
        cfg_write(REG_LED2_PA, led);
        ww_hr_note_led_change(&st->hr);
        WW_LOGD(TAG, "AGC: LED -> 0x%02X (dc %.0f)", led, dc);
    }
}

#if WW_HR_DEBUG
/* §22 per-BEAT tuning telemetry (~1.5 lines/s — negligible UART load, unlike a
   per-sample dump which would block acquisition). Columns are documented in
   docs/HRValidation.md; capture with `idf.py monitor` and analyse offline. */
static const char *REASON_NAME[] = { "refractory", "low_amplitude", "bad_morphology",
    "low_sqi", "ibi_out_of_range", "ibi_outlier", "saturation", "settling",
    "prominence", "no_contact" };

static void beat_logger(const ww_hr_beat_log_t *b) {
    printf("HRBEAT,%.0f,%.1f,%.0f,%.1f,%.1f,%.1f,%.3f,%.0f,%.0f,%.1f,%d,%s\n",
           b->idx, b->amp, b->width_ms, b->thr, b->noise_floor, b->peak_amp_ema,
           b->pi_pct, b->dc, b->sqi, b->ibi_ms, b->accepted,
           b->accepted ? "accepted" : (b->reason >= 0 && b->reason < 10 ? REASON_NAME[b->reason] : "?"));
}
#endif

static void rc_log(const char *line) { (void)line; WW_LOGI(TAG, "%s", line); }

static bool m_begin(ww_sensor_t *self) {
    max_t *st = self->impl;
    memset(st, 0, sizeof(*st));
    st->led = LED_START;
    uint8_t part;
    if (!ww_i2c_probe(MAX30102_ADDR)) return false;
    if (!ww_i2c_read_u8(MAX30102_ADDR, REG_PART_ID, &part) || part != MAX30102_PARTID) return false;
    if (!configure(st)) return false;
    ww_hr_init(&st->hr, NULL);                             /* documented defaults */
    /* Prove the rhythm cross-check on THIS chip's float maths before trusting it. */
    int rc_fails = ww_rhythm_selftest(rc_log);
    if (rc_fails) WW_LOGW(TAG, "rhythm cross-check self-test: %d case(s) FAILED", rc_fails);
    else WW_LOGI(TAG, "rhythm cross-check self-test PASS");
#if WW_HR_DEBUG
    ww_hr_set_beat_logger(&st->hr, beat_logger);
    printf("HRBEAT,idx,amp,width_ms,thr,noise,peak_ema,pi_pct,dc,sqi,ibi_ms,accepted,reason\n");
#endif
    st->present = true;
    WW_LOGI(TAG, "0x%02X detected -> MAX30102 (PART_ID 0x%02X), %d Hz, HR pipeline on", MAX30102_ADDR, part, FS_HZ);
    return true;
}

static void m_update(ww_sensor_t *self) {
    max_t *st = self->impl;
    if (!st->present) return;

    /* §20: overflow visibility. Empirically the latched OVF_COUNTER register
       double-counts at our poll cadence (hardware showed ovf≈2632/30 s while the
       sample counter proved an exact, loss-free 100 Hz) — so the register is NOT
       trusted. The reliable starvation signal at a 20 ms poll is the FIFO being at
       (or wrapping past) capacity when we arrive: count near-full drains instead. */
    uint8_t wr, rd;
    if (!ww_i2c_read_u8(MAX30102_ADDR, REG_FIFO_WR, &wr) || !ww_i2c_read_u8(MAX30102_ADDR, REG_FIFO_RD, &rd)) {
        if (++st->fails >= 5) { st->present = false; WW_LOGW(TAG, "lost MAX30102"); }
        return;
    }
    st->fails = 0;
    int avail = (wr - rd) & 0x1F;
    if (avail == 0 && wr == rd) {
        /* wr==rd is ambiguous: empty OR exactly full after a rollover wrap. Only
           here is the OVF register consulted — non-zero reliably means a wrap
           happened, so the FIFO holds a full 32 samples, not none. */
        uint8_t ovf = 0;
        if (ww_i2c_read_u8(MAX30102_ADDR, REG_OVF_CNT, &ovf) && ovf) {
            avail = 32;
            ww_hr_note_overflow(&st->hr, 1);
        }
    }
    if (avail >= 30) ww_hr_note_overflow(&st->hr, 1);   /* ≥300 ms behind at 100 Hz */
    for (int s = 0; s < avail; s++) {
        uint8_t b[6];
        if (!ww_i2c_read_reg(MAX30102_ADDR, REG_FIFO_DATA, b, 6)) break;
        uint32_t red = (((uint32_t)(b[0] & 0x03)) << 16) | ((uint32_t)b[1] << 8) | b[2];
        uint32_t ir  = (((uint32_t)(b[3] & 0x03)) << 16) | ((uint32_t)b[4] << 8) | b[5];
        ww_hr_push(&st->hr, ir, red);

        if (++st->since_agc >= AGC_PERIOD_SMPL) {
            /* Only consume the tick if the AGC can actually run. Zeroing the counter
               before a settle-window skip DISCARDED the evaluation and cost another
               full period — with contact chatter re-arming windows, the AGC could be
               starved indefinitely, leaving the LED stuck at exactly the level that
               caused the chatter. Retrying next sample breaks that loop. */
            if (st->hr.idx >= st->hr.settle_until) {
                st->since_agc = 0;
                agc(st);
            }
        }
#if WW_DEBUG && WW_HR_DEBUG
        /* HR validation builds: what the beat counter says vs the rhythm cross-check, so
           a miscount and its correction can be watched live on the serial log. These are
           the wearer's heart-rate values, so ordinary builds (WW_DEBUG alone) never print
           them: anyone with the UART could otherwise read them. */
        if (++st->since_trace >= TRACE_PERIOD_SMPL) {
            st->since_trace = 0;
            ww_hr_state_t hs = ww_hr_state(&st->hr);
            if (hs != WW_HR_NO_CONTACT) {
                const ww_hr_diag_t *d = ww_hr_diag(&st->hr);
                WW_LOGI(TAG, "hr: state=%d beats=%.0f rhythm=%.0f r=%.2f sqi=%.0f%s fix[half=%u dbl=%u ovr=%u]",
                        (int)hs, st->hr.hr_robust, ww_hr_rhythm_bpm(&st->hr), ww_hr_rhythm_strength(&st->hr),
                        ww_hr_sqi(&st->hr), st->hr.rhythm_override ? " OVERRIDE" : "",
                        (unsigned)d->rhythm_relock_half, (unsigned)d->rhythm_relock_double, (unsigned)d->rhythm_overrides);
            }
        }
#endif
        if (++st->since_diag >= DIAG_PERIOD_SMPL) {
            st->since_diag = 0;
            const ww_hr_diag_t *d = ww_hr_diag(&st->hr);
            /* Pipeline health only (counts, LED, signal level, quality); the heart-rate
               values themselves are added in WW_HR_DEBUG builds, see above. */
            WW_LOGI(TAG, "diag: smp=%u ovf=%u det=%u acc=%u rej[refr=%u pi=%u morph=%u sqi=%u range=%u outl=%u sat=%u settle=%u prom=%u nocon=%u] led=0x%02X dc=%.0f state=%d sqi=%.0f fix[half=%u dbl=%u ovr=%u]",
                    (unsigned)d->samples, (unsigned)d->fifo_overflows, (unsigned)d->beats_detected,
                    (unsigned)d->beats_accepted, (unsigned)d->rejects[0], (unsigned)d->rejects[1],
                    (unsigned)d->rejects[2], (unsigned)d->rejects[3], (unsigned)d->rejects[4],
                    (unsigned)d->rejects[5], (unsigned)d->rejects[6], (unsigned)d->rejects[7],
                    (unsigned)d->rejects[8], (unsigned)d->rejects[9],
                    st->led, ww_hr_dc_ir(&st->hr), (int)ww_hr_state(&st->hr), ww_hr_sqi(&st->hr),
                    (unsigned)d->rhythm_relock_half, (unsigned)d->rhythm_relock_double, (unsigned)d->rhythm_overrides);
#if WW_HR_DEBUG
            WW_LOGI(TAG, "diag: hr=%.0f rhythm=%.0f r=%.2f",
                    ww_hr_display(&st->hr), ww_hr_rhythm_bpm(&st->hr), ww_hr_rhythm_strength(&st->hr));
#endif
        }
    }
}

static bool m_available(ww_sensor_t *self) { return ((max_t *)self->impl)->present; }
static const char *m_name(ww_sensor_t *self) { (void)self; return "MAX30102"; }

static size_t m_caps(ww_sensor_t *self, ww_capability_t *out, size_t max) {
    if (!((max_t *)self->impl)->present || max < 3) return 0;
    out[0] = (ww_capability_t){ WW_CAP_HEART_RATE, WW_SENSOR_HEARTRATE, 1, WW_UNIT_BPM };
    out[1] = (ww_capability_t){ WW_CAP_SPO2,       WW_SENSOR_SPO2,      1, WW_UNIT_PERCENT };
    out[2] = (ww_capability_t){ WW_CAP_PPG,        WW_SENSOR_PPG,       FS_HZ, WW_UNIT_COUNT };
    return 3;
}

static uint16_t m_read(ww_sensor_t *self, uint8_t code, float *out, uint16_t max) {
    max_t *st = self->impl;
    if (!st->present) return 0;
    switch (code) {
        case WW_SENSOR_HEARTRATE: return ww_hr_drain_hr(&st->hr, out, max);
        case WW_SENSOR_SPO2:      return ww_hr_drain_spo2(&st->hr, out, max);
        case WW_SENSOR_PPG:       return ww_hr_drain_ppg(&st->hr, out, max);
        default: return 0;
    }
}

static void m_flush(ww_sensor_t *self) {
    ww_hr_flush_outputs(&((max_t *)self->impl)->hr);       /* outputs only — the
        analysis state (DC, IBIs, HR estimate) survives so a session start doesn't
        force a cold re-acquisition */
}

void ww_max30102_report_motion(float g_dev) {
    if (s_state.present) ww_hr_set_motion(&s_state.hr, g_dev);
}

static const ww_sensor_vtable_t VT = { m_begin, m_update, m_available, m_name, m_caps, m_read, m_flush, NULL /* no status bits */ };
static ww_sensor_t s_sensor = { &VT, &s_state };

ww_sensor_t *ww_max30102_sensor(void) { return &s_sensor; }
