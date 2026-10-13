/* WearWise sensor protocol v1 — the firmware side of packages/sensor-protocol.
 *
 * The byte layout is documented once, in codec.ts; this header mirrors it and
 * fixtures/v1.json is the contract between the two. Never renumber a sensor
 * code or change a header offset without bumping PROTOCOL_VERSION on both sides.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#define WW_PROTOCOL_VERSION 1

enum ww_sensor_type {
    WW_SENSOR_ECG = 1,
    WW_SENSOR_SPO2 = 2,
    WW_SENSOR_TEMPERATURE = 3,
    WW_SENSOR_HEARTRATE = 4,
    WW_SENSOR_ACCELEROMETER = 5,  /* MMA8452Q magnitude |a| in g — powers fall detection */
    WW_SENSOR_PPG = 6,            /* MAX30102 photoplethysmogram (AC-coupled IR), counts */
};
/* Count of SIMULATED signals (sim fallback only). The real path builds its capability
   list dynamically from detected sensors, so it is not bound by this. */
#define WW_SENSOR_COUNT 5

#define WW_ENCODING_INT16LE 1

#define WW_FLAG_SIMULATED     0x01
#define WW_FLAG_LAST_IN_BURST 0x02
#define WW_FLAG_LEADS_OFF     0x04  /* ECG: an electrode was off during this packet; samples are not a signal */

#define WW_HEADER_BYTES 58
#define WW_CHECKSUM_BYTES 4
#define WW_MAX_SAMPLES_PER_PACKET 200
#define WW_MAX_PACKET_BYTES (WW_HEADER_BYTES + WW_MAX_SAMPLES_PER_PACKET * 2 + WW_CHECKSUM_BYTES) /* 462 */

/* Physical value = raw * scale. The encoder divides by these. */
float ww_sample_scale(uint8_t sensor_type);
const char *ww_sample_unit(uint8_t sensor_type);

typedef struct {
    uint8_t device_id[16];
    uint32_t boot_id;
    uint8_t session_id[16];
    uint8_t sensor_type;
    uint32_t sequence_number;
    uint64_t device_timestamp_us;
    uint16_t sample_rate_hz;
    uint8_t flags;
    const float *samples;   /* physical units */
    uint16_t sample_count;  /* 1..WW_MAX_SAMPLES_PER_PACKET */
} ww_packet_input_t;

/* CRC-32/IEEE (poly 0xEDB88320, init 0xFFFFFFFF, final xor), identical to
   packages/sensor-protocol/src/crc32.ts. Check vector: "123456789" → 0xCBF43926. */
uint32_t ww_crc32(const uint8_t *data, size_t len);

/* Encode into `out` (capacity ≥ WW_MAX_PACKET_BYTES). Returns bytes written or 0
   on invalid input. Out-of-range samples clamp to int16, never wrap. */
size_t ww_encode_packet(const ww_packet_input_t *in, uint8_t *out, size_t out_cap);

/* Boot-time self-test against the recorded fixture. Logs and returns pass/fail. */
bool ww_protocol_self_test(void);
