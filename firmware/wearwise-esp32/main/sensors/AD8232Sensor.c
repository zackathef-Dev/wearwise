#include "AD8232Sensor.h"
#include "HardwareConfig.h"
#include "FirmwareConfig.h"
#include "Logger.h"
#include "freertos/FreeRTOS.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_rom_sys.h"

static const char *TAG = "ww-ad8232";

/* AD8232 has a fixed instrumentation gain (~1100). We report ELECTRODE-referred mV so
   the waveform lands in the app's ECG range; the exact figure is board-dependent and
   this is a prototype approximation, not a calibrated measurement. */
#define ECG_GAIN     1100.0f
#define ADC_MAX_MV   3300.0f
#define ADC_MAX_RAW  4095.0f
#define RING 256          /* >= one 200 ms burst at 250 Hz (=50), with slack */

typedef struct {
    bool present;
    adc_oneshot_unit_handle_t adc;
    adc_channel_t chan;
    esp_timer_handle_t timer;
    float baseline_mv;     /* running DC estimate, removed to centre the AC ECG */
    /* SPSC ring: producer = 250 Hz timer callback, consumer = stream task. Guarded by a
       spinlock; critical sections are a few instructions so 250 Hz contention is trivial. */
    portMUX_TYPE lock;
    float ring[RING];
    volatile int head, count;
    volatile bool lead_off;
    volatile bool lead_off_seen;   /* latched by the sampler, cleared by m_status() */
} ad8232_t;

static ad8232_t s_state;

/* Does anything drive this pin? The AD8232 drives LO+ and LO- itself (high while an
   electrode is off, low while both are on), and the ESP32's weak internal pulls can't
   move a driven pin. With no module the pin floats and simply follows the pull. */
static bool pin_follows_pulls(gpio_num_t pin) {
    int follows = 0;
    for (int i = 0; i < 3; i++) {
        gpio_set_pull_mode(pin, GPIO_PULLDOWN_ONLY);
        esp_rom_delay_us(200);
        int low = gpio_get_level(pin);
        gpio_set_pull_mode(pin, GPIO_PULLUP_ONLY);
        esp_rom_delay_us(200);
        int high = gpio_get_level(pin);
        if (low == 0 && high == 1) follows++;
    }
    gpio_set_pull_mode(pin, GPIO_FLOATING);
    return follows == 3;
}

static bool leads_off(void) {
    return gpio_get_level(WW_ECG_LO_PLUS) || gpio_get_level(WW_ECG_LO_MINUS);
}

/* 250 Hz sampler. Reads one ADC sample, removes the slow baseline, converts to
   electrode-referred mV, and pushes to the ring. Runs in the esp_timer task. */
static void sample_cb(void *arg) {
    ad8232_t *st = arg;
    int raw = 0;
    if (adc_oneshot_read(st->adc, st->chan, &raw) != ESP_OK) return;
    float mv = (float)raw * (ADC_MAX_MV / ADC_MAX_RAW);
    st->baseline_mv += (mv - st->baseline_mv) * 0.002f;   /* ~1st-order HPF, cutoff well below ECG */
    float ecg_mv = st->lead_off ? 0.0f : (mv - st->baseline_mv) / ECG_GAIN;

    /* refresh lead-off roughly every sample is cheap (two GPIO reads) */
    st->lead_off = leads_off();

    portENTER_CRITICAL(&st->lock);
    if (st->lead_off) st->lead_off_seen = true;
    st->ring[st->head] = ecg_mv;
    st->head = (st->head + 1) % RING;
    if (st->count < RING) st->count++;
    portEXIT_CRITICAL(&st->lock);
}

static bool m_begin(ww_sensor_t *self) {
    ad8232_t *st = self->impl;
    st->present = false;
    st->head = st->count = 0;
    st->baseline_mv = ADC_MAX_MV / 2.0f;   /* AD8232 idles near Vcc/2 */
    st->lock = (portMUX_TYPE)portMUX_INITIALIZER_UNLOCKED;

    /* Lead-off pins as inputs. */
    gpio_config_t io = { .pin_bit_mask = (1ULL << WW_ECG_LO_PLUS) | (1ULL << WW_ECG_LO_MINUS),
                         .mode = GPIO_MODE_INPUT, .pull_up_en = 0, .pull_down_en = 0, .intr_type = GPIO_INTR_DISABLE };
    if (gpio_config(&io) != ESP_OK) { WW_LOGE(TAG, "LO GPIO config failed"); return false; }

#if WW_AD8232_DETECT
    /* The ECG input is analog, so nothing on the I2C bus says whether the module is
       fitted. Without this check a board with no AD8232 advertised an ECG signal and
       recorded ADC noise as ECG. Both lead-off pins floating = no module. */
    bool plus_floats = pin_follows_pulls(WW_ECG_LO_PLUS);
    bool minus_floats = pin_follows_pulls(WW_ECG_LO_MINUS);
    if (plus_floats && minus_floats) {
        WW_LOGI(TAG, "AD8232 not fitted (LO+ GPIO%d and LO- GPIO%d float): no ECG", WW_ECG_LO_PLUS, WW_ECG_LO_MINUS);
        return false;
    }
    if (plus_floats || minus_floats) {
        WW_LOGW(TAG, "AD8232: LO%c GPIO%d floats; check its wire (lead-off detection needs both)",
                plus_floats ? '+' : '-', plus_floats ? WW_ECG_LO_PLUS : WW_ECG_LO_MINUS);
    }
#endif

    /* ADC1 oneshot on the ECG pin. GPIO34 = ADC1_CH6 on the classic ESP32. */
    adc_oneshot_unit_init_cfg_t ucfg = { .unit_id = ADC_UNIT_1 };
    if (adc_oneshot_new_unit(&ucfg, &st->adc) != ESP_OK) { WW_LOGE(TAG, "ADC unit init failed"); return false; }
    st->chan = ADC_CHANNEL_6;   /* GPIO34 */
    adc_oneshot_chan_cfg_t ccfg = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12 };
    if (adc_oneshot_config_channel(st->adc, st->chan, &ccfg) != ESP_OK) {
        WW_LOGE(TAG, "ADC channel config failed"); adc_oneshot_del_unit(st->adc); return false;
    }

    const esp_timer_create_args_t targs = { .callback = sample_cb, .arg = st, .name = "ww_ecg" };
    if (esp_timer_create(&targs, &st->timer) != ESP_OK) { adc_oneshot_del_unit(st->adc); return false; }
    if (esp_timer_start_periodic(st->timer, 1000000ULL / WW_ECG_SAMPLE_RATE_HZ) != ESP_OK) {
        esp_timer_delete(st->timer); adc_oneshot_del_unit(st->adc); return false;
    }
    st->present = true;
    WW_LOGI(TAG, "AD8232 enabled: ECG ADC GPIO%d @ %d Hz (LO+ GPIO%d, LO- GPIO%d)",
            WW_ECG_ADC, WW_ECG_SAMPLE_RATE_HZ, WW_ECG_LO_PLUS, WW_ECG_LO_MINUS);
    return true;
}

static void m_update(ww_sensor_t *self) { (void)self; /* sampling is timer-driven */ }
static bool m_available(ww_sensor_t *self) { return ((ad8232_t *)self->impl)->present; }
static const char *m_name(ww_sensor_t *self) { (void)self; return "AD8232"; }

static size_t m_caps(ww_sensor_t *self, ww_capability_t *out, size_t max) {
    if (!((ad8232_t *)self->impl)->present || max < 1) return 0;
    out[0] = (ww_capability_t){ WW_CAP_ECG, WW_SENSOR_ECG, WW_ECG_SAMPLE_RATE_HZ, WW_UNIT_MILLIVOLT };
    return 1;
}

static uint16_t m_read(ww_sensor_t *self, uint8_t code, float *out, uint16_t max) {
    ad8232_t *st = self->impl;
    if (code != WW_SENSOR_ECG || !st->present) return 0;
    uint16_t n = 0;
    portENTER_CRITICAL(&st->lock);
    while (st->count > 0 && n < max) {
        int tail = (st->head - st->count + RING) % RING;
        out[n++] = st->ring[tail];
        st->count--;
    }
    portEXIT_CRITICAL(&st->lock);
    return n;
}

static void m_flush(ww_sensor_t *self) {
    ad8232_t *st = self->impl;
    if (!st->present) return;
    portENTER_CRITICAL(&st->lock);
    st->head = 0; st->count = 0;
    portEXIT_CRITICAL(&st->lock);
}

/* Leads-off is reported per burst: if any sample since the last call was taken with an
   electrode detached, the packet is flagged so the app shows "not attached", not 0 mV. */
static uint8_t m_status(ww_sensor_t *self, uint8_t code) {
    ad8232_t *st = self->impl;
    if (code != WW_SENSOR_ECG || !st->present) return 0;
    portENTER_CRITICAL(&st->lock);
    bool seen = st->lead_off_seen || st->lead_off;
    st->lead_off_seen = false;
    portEXIT_CRITICAL(&st->lock);
    return seen ? WW_SENSOR_STATUS_LEADS_OFF : 0;
}

static const ww_sensor_vtable_t VT = { m_begin, m_update, m_available, m_name, m_caps, m_read, m_flush, m_status };
static ww_sensor_t s_sensor = { &VT, &s_state };

ww_sensor_t *ww_ad8232_sensor(void) { return &s_sensor; }
