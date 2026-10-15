/* WearWise sensor patch — application entry (generic, multi-sensor).
 *
 * Boot -> self-test the protocol -> derive identity -> detect whatever sensors are wired
 * (SensorManager) -> bring up NimBLE and advertise -> run the streaming task. The task
 * honours the phone's START/STOP and emits protocol-v1 packets on the Data characteristic,
 * one per streamed capability, at each sensor's own rate, flushed every WW_BURST_MS. The
 * wire format is byte-identical to v0.6 — the app is unchanged; only the DATA now comes
 * from real sensors instead of the built-in simulation.
 */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "esp_random.h"
#include "bootloader_random.h"
#include "nvs_flash.h"

#include "FirmwareConfig.h"
#include "HardwareConfig.h"
#include "protocol.h"
#include "gatt.h"
#include "wifi.h"
#include "ws_server.h"
#include "DeviceManager.h"
#include "tls_identity.h"
#include "ble_pairing.h"
#include "SensorManager.h"
#include "WearWiseSensor.h"
#include "MeasurementTypes.h"
#include "Logger.h"

static const char *TAG = "ww-main";

#define SEQ_MAX 32   /* index seq/sent by wire code (codes are 1..6) */

static const ww_identity_t *g_id;

static void stream_task(void *arg) {
    (void)arg;
    ww_capability_t caps[12];
    size_t ncaps = ww_sensors_capabilities(caps, 12);

    uint32_t seq[SEQ_MAX] = {0};    /* per code, resets each session */
    /* Packets the Wi-Fi send queue had no room for while a phone was streaming over it,
       per code; logged every 10 s when there are any. A real-device test once lost
       ECG and movement over Wi-Fi for minutes while temperature got through: this says
       whether the queue is the cause if it happens again. */
    uint32_t ws_dropped[SEQ_MAX] = {0};
    int64_t ws_drop_logged_us = 0;
    uint32_t sent[SEQ_MAX] = {0};   /* per code absolute sample count -> device timestamp */
    const uint8_t data_flags = (WW_SIM_FALLBACK) ? WW_FLAG_SIMULATED : 0;

    uint8_t packet[WW_MAX_PACKET_BYTES];
    float samples[WW_MAX_SAMPLES_PER_PACKET];

    uint32_t last_generation = 0;
    bool active = false;
    uint8_t session_id[16] = {0};
    uint8_t mask = 0;
    int64_t last_flush_us = 0;
    int64_t session_start_us = 0;   /* clock origin for gappy channels' timestamps */

    TickType_t wake = xTaskGetTickCount();
    while (1) {
        ww_stream_request_t req;
        ww_gatt_get_request(&req);
        if (req.generation != last_generation) {
            last_generation = req.generation;
            if (req.streaming) {
                /* Only a genuinely-new session restarts sequence numbers. A same-session
                   reconnect (app resends START with the SAME sessionId) must CONTINUE them,
                   or the app's SequenceTracker sees the restarted low numbers as stale/dup
                   and drops the whole resumed stream. */
                bool new_session = memcmp(session_id, req.session_id, 16) != 0;
                memcpy(session_id, req.session_id, 16);
                mask = req.sensor_mask;
                if (new_session) {
                    for (int i = 0; i < SEQ_MAX; i++) seq[i] = 0;
                    for (int i = 0; i < SEQ_MAX; i++) sent[i] = 0;   /* timestamps restart
                        with the session — a resumed session keeps both (continuity) */
                    session_start_us = esp_timer_get_time();
                }
                ww_sensors_flush();   /* stream from fresh samples, not the idle backlog */
                active = true;
                WW_LOGI(TAG, "streaming session %s, mask=0x%02x", new_session ? "started" : "resumed", mask);
            } else {
                active = false;
                WW_LOGI(TAG, "streaming stopped");
            }
        }

        /* Acquire from every sensor every tick (non-blocking). */
        ww_sensors_update();

        if (active && ww_gatt_can_notify()) {
            int64_t now = esp_timer_get_time();
            if (now - last_flush_us >= (int64_t)WW_BURST_MS * 1000) {
                /* Advance by exactly one burst so the cadence stays locked to 200 ms.
                   `last_flush_us = now` let every burst slip by up to a tick (~210 ms
                   average), while each burst drained only one burst's worth — the ring
                   then overflowed and ~5% of ECG/PPG/accel samples were silently lost. */
                last_flush_us += (int64_t)WW_BURST_MS * 1000;
                if (now - last_flush_us >= (int64_t)WW_BURST_MS * 1000) last_flush_us = now;  /* far behind: resync */
                uint16_t max_payload = ww_gatt_max_payload();
                /* Largest sample count whose packet fits one notification. */
                uint16_t fit = WW_MAX_SAMPLES_PER_PACKET;
                if (max_payload && max_payload < WW_MAX_PACKET_BYTES)
                    fit = max_payload > WW_HEADER_BYTES + WW_CHECKSUM_BYTES
                        ? (uint16_t)((max_payload - WW_HEADER_BYTES - WW_CHECKSUM_BYTES) / 2) : 1;
                for (size_t i = 0; i < ncaps; i++) {
                    uint8_t code = caps[i].wire_code;
                    uint16_t rate = caps[i].sample_rate_hz ? caps[i].sample_rate_hz : 1;
                    if (code == 0 || code >= SEQ_MAX) continue;
                    if (!(mask & (1u << (code - 1)))) continue;

                    /* Drain the whole backlog (up to one packet), not just one nominal
                       burst, so no sample is ever left to be overwritten in the ring. */
                    uint16_t n = ww_sensors_read(code, samples, fit);
                    if (n == 0) continue;   /* nothing fresh this burst (e.g. slow temperature) */
                    uint8_t status = ww_sensors_status(code);

                    /* A low-rate channel only emits when it has something to say, so its
                       stream has real gaps (HR/SpO2 stay silent while quality is poor). */
                    bool gappy = (rate <= 5);

                    ww_packet_input_t in = {
                        .boot_id = g_id->boot_id,
                        .sensor_type = code,
                        .sequence_number = seq[code],
                        /* Timestamp of the FIRST sample in this packet.
                           Continuous channels (ECG/PPG/accel) derive it from the sample
                           count: the sensor's own crystal is far steadier than task
                           timing, so counting samples IS the truth.
                           GAPPY channels (HR/SpO2 publish only when the estimate is
                           valid) must not: sample-count time would compress a 5 s
                           dropout into 1 s and distort every stored/graphed timeline.
                           They use the real elapsed clock instead. */
                        .device_timestamp_us = gappy
                            ? (uint64_t)(now - session_start_us) - (uint64_t)((double)(n - 1) / rate * 1e6)
                            : (uint64_t)((double)sent[code] / rate * 1e6),
                        .sample_rate_hz = rate,
                        .flags = (uint8_t)(data_flags | ((status & WW_SENSOR_STATUS_LEADS_OFF) ? WW_FLAG_LEADS_OFF : 0)),
                        .samples = samples,
                        .sample_count = n,
                    };
                    memcpy(in.device_id, g_id->device_id, 16);
                    memcpy(in.session_id, session_id, 16);

                    size_t len = ww_encode_packet(&in, packet, sizeof packet);
                    if (len == 0) { WW_LOGW(TAG, "encode failed (code %u)", code); continue; }

                    bool ble_ok = (!max_payload || len <= max_payload) ? ww_gatt_notify(packet, len) : false;
                    bool ws_ok = ww_ws_send(packet, len);
                    if (!ws_ok && ww_ws_client_ready()) ws_dropped[code]++;
                    if (ble_ok || ws_ok) { seq[code]++; sent[code] += n; }
                }
            }
        }

        int64_t t_now = esp_timer_get_time();
        if (t_now - ws_drop_logged_us >= 10 * 1000000LL) {
            ws_drop_logged_us = t_now;
            uint32_t total = 0;
            for (int i = 0; i < SEQ_MAX; i++) total += ws_dropped[i];
            if (total) {
                WW_LOGW(TAG, "wi-fi queue full: %u packets not sent in 10 s (ecg %u, spo2 %u, temp %u, hr %u, accel %u, ppg %u)",
                        (unsigned)total, (unsigned)ws_dropped[1], (unsigned)ws_dropped[2], (unsigned)ws_dropped[3],
                        (unsigned)ws_dropped[4], (unsigned)ws_dropped[5], (unsigned)ws_dropped[6]);
                for (int i = 0; i < SEQ_MAX; i++) ws_dropped[i] = 0;
            }
        }

        vTaskDelayUntil(&wake, pdMS_TO_TICKS(WW_STREAM_TICK_MS));
    }
}

void app_main(void) {
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    if (!ww_protocol_self_test()) {
        WW_LOGE(TAG, "protocol self-test failed — refusing to advertise bad packets");
        return;
    }

    /* Secrets first, while the RNG is truly random. The ESP32's hardware RNG only
       draws real entropy once Wi-Fi/BT is running; before that, esp_random() is merely
       pseudo-random. Rather than defer every secret until after the radio is up, the
       SAR-ADC entropy source is switched on for this block. It must be OFF again before
       anything initialises the ADC (AD8232, in ww_sensors_init), Wi-Fi or Bluetooth —
       so nothing below the disable may move above it. Generated in here: boot_id
       (ww_device_init), the Wi-Fi PoP, the first-boot TLS key (ww_tls_identity_init)
       and the NVS fallback pairing passkey (ww_pairing_init). */
    bootloader_random_enable();
    g_id = ww_device_init();
    /* Per-boot proof-of-possession for the Wi-Fi WebSocket. Random, never logged. */
    uint8_t pop[4];
    esp_fill_random(pop, sizeof pop);
    /* Before Wi-Fi: the wss:// server starts on GOT_IP and needs the certificate. */
    ww_tls_identity_init(g_id->ble_name);
    ww_pairing_init();     /* passkey + BOOT-button pairing window, before BLE starts */
    bootloader_random_disable();

    WW_LOGI(TAG, "WearWise fw %s  device %s  boot 0x%08x  adv %s",
            WW_FW_VERSION, g_id->device_id_str, (unsigned)g_id->boot_id, g_id->ble_name);
    WW_LOGI(TAG, "I2C SDA:%d SCL:%d", WW_I2C_SDA, WW_I2C_SCL);

    ww_ws_init(pop);
    ww_wifi_init();
    ww_sensors_init();           /* detect sensors before GATT so CAPS reflects reality */
    ww_gatt_init(g_id);
    ww_gatt_set_pop(pop);

    xTaskCreate(stream_task, "ww_stream", 6144, NULL, 5, NULL);
}
