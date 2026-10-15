#include "protocol.h"
#include <string.h>
#include <math.h>
#include <inttypes.h>
#include "esp_log.h"

static const char *TAG = "ww-proto";

float ww_sample_scale(uint8_t t) {
    switch (t) {
        case WW_SENSOR_ECG: return 0.001f;        /* 1 µV per unit, value in mV */
        case WW_SENSOR_SPO2: return 0.01f;        /* 0.01 % */
        case WW_SENSOR_TEMPERATURE: return 0.01f; /* 0.01 °C */
        case WW_SENSOR_HEARTRATE: return 0.1f;    /* 0.1 bpm */
        case WW_SENSOR_ACCELEROMETER: return 0.001f; /* 0.001 g */
        case WW_SENSOR_PPG: return 1.0f;             /* 1 count (AC-coupled, fits int16) */
        default: return 0.0f;
    }
}

const char *ww_sample_unit(uint8_t t) {
    switch (t) {
        case WW_SENSOR_ECG: return "mV";
        case WW_SENSOR_SPO2: return "%";
        case WW_SENSOR_TEMPERATURE: return "°C";
        case WW_SENSOR_HEARTRATE: return "bpm";
        case WW_SENSOR_ACCELEROMETER: return "g";
        case WW_SENSOR_PPG: return "counts";
        default: return "";
    }
}

/* ---- CRC-32/IEEE, table-driven, same table construction as crc32.ts ---- */
static uint32_t crc_table[256];
static bool crc_ready = false;

static void crc_init(void) {
    for (uint32_t n = 0; n < 256; n++) {
        uint32_t c = n;
        for (int k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        crc_table[n] = c;
    }
    crc_ready = true;
}

uint32_t ww_crc32(const uint8_t *data, size_t len) {
    if (!crc_ready) crc_init();
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++) c = crc_table[(c ^ data[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}

/* ---- little-endian writers (the ESP32 is LE, but be explicit) ---- */
static inline void put_u16(uint8_t *p, uint16_t v) { p[0] = v & 0xFF; p[1] = v >> 8; }
static inline void put_u32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (v >> (8 * i)) & 0xFF; }
static inline void put_u64(uint8_t *p, uint64_t v) { for (int i = 0; i < 8; i++) p[i] = (v >> (8 * i)) & 0xFF; }

size_t ww_encode_packet(const ww_packet_input_t *in, uint8_t *out, size_t out_cap) {
    if (!in || !out) return 0;
    if (in->sample_count < 1 || in->sample_count > WW_MAX_SAMPLES_PER_PACKET) return 0;
    const float scale = ww_sample_scale(in->sensor_type);
    if (scale == 0.0f) return 0;
    const size_t total = WW_HEADER_BYTES + (size_t)in->sample_count * 2 + WW_CHECKSUM_BYTES;
    if (out_cap < total) return 0;

    out[0] = 0x57; out[1] = 0x57;           /* 'W' 'W' */
    out[2] = WW_PROTOCOL_VERSION;
    out[3] = in->sensor_type;
    out[4] = WW_ENCODING_INT16LE;
    out[5] = in->flags;
    memcpy(out + 6, in->device_id, 16);
    put_u32(out + 22, in->boot_id);
    memcpy(out + 26, in->session_id, 16);
    put_u32(out + 42, in->sequence_number);
    put_u64(out + 46, in->device_timestamp_us);
    put_u16(out + 54, in->sample_rate_hz);
    put_u16(out + 56, in->sample_count);

    for (uint16_t i = 0; i < in->sample_count; i++) {
        /* Round half away from zero like JS Math.round for positives; the
           difference at exactly .5 is below any sensor's noise floor. */
        float q = in->samples[i] / scale;
        long r = lroundf(q);
        if (r > 32767) r = 32767;
        if (r < -32768) r = -32768;
        put_u16(out + WW_HEADER_BYTES + i * 2, (uint16_t)(int16_t)r);
    }

    put_u32(out + total - WW_CHECKSUM_BYTES, ww_crc32(out, total - WW_CHECKSUM_BYTES));
    return total;
}

/* fixtures/v1.json → "ecg-5-samples". If this ever disagrees, the phone will
   reject every packet with bad-checksum, so fail loudly at boot instead. */
static const uint8_t FIXTURE_ECG5[72] = {
    0x57,0x57,0x01,0x01,0x01,0x01,
    0x0f,0x2b,0x3c,0x4d,0x5e,0x6f,0x4a,0x7b,0x8c,0x9d,0x0e,0x1f,0x2a,0x3b,0x4c,0x5d,
    0x07,0x00,0x00,0x00,
    0xa1,0xb2,0xc3,0xd4,0xe5,0xf6,0x4a,0x7b,0x8c,0x9d,0x1e,0x2f,0x3a,0x4b,0x5c,0x6d,
    0x2a,0x00,0x00,0x00,
    0xd2,0x02,0x96,0x49,0x00,0x00,0x00,0x00,
    0x46,0x00,
    0x05,0x00,
    0x00,0x00, 0x7d,0x00, 0x0c,0xfe, 0xb0,0x04, 0x2e,0xfb,
    0x61,0x7e,0x56,0x89,
};

bool ww_protocol_self_test(void) {
    bool ok = true;
    uint32_t c = ww_crc32((const uint8_t *)"123456789", 9);
    if (c != 0xCBF43926u) { ESP_LOGE(TAG, "CRC check vector failed: %08" PRIx32, c); ok = false; }

    const float samples[5] = { 0.0f, 0.125f, -0.5f, 1.2f, -1.234f };
    ww_packet_input_t in = {
        .device_id = {0x0f,0x2b,0x3c,0x4d,0x5e,0x6f,0x4a,0x7b,0x8c,0x9d,0x0e,0x1f,0x2a,0x3b,0x4c,0x5d},
        .boot_id = 7,
        .session_id = {0xa1,0xb2,0xc3,0xd4,0xe5,0xf6,0x4a,0x7b,0x8c,0x9d,0x1e,0x2f,0x3a,0x4b,0x5c,0x6d},
        .sensor_type = WW_SENSOR_ECG, .sequence_number = 42, .device_timestamp_us = 1234567890ULL,
        .sample_rate_hz = 70, .flags = WW_FLAG_SIMULATED, .samples = samples, .sample_count = 5,
    };
    uint8_t buf[WW_MAX_PACKET_BYTES];
    size_t n = ww_encode_packet(&in, buf, sizeof buf);
    if (n != sizeof FIXTURE_ECG5 || memcmp(buf, FIXTURE_ECG5, n) != 0) {
        ESP_LOGE(TAG, "fixture ecg-5-samples mismatch (%u bytes)", (unsigned)n);
        ESP_LOG_BUFFER_HEX(TAG, buf, n);
        ok = false;
    }
    ESP_LOGI(TAG, "protocol self-test %s", ok ? "PASS" : "FAIL");
    return ok;
}
