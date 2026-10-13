/* WearWise GATT service — the BLE face of the sensor protocol.
 *
 * Service   57570000-5757-4b57-8000-574541525753
 *   0001  Device info   READ     deviceId[16] · bootId u32 LE · protocolVersion u8 · fwVersion "x.y.z\0"
 *   0002  Capabilities  READ     N × { sensorType u8, reporting u8, sampleRateHz u16 LE }
 *   0003  Control       WRITE    op u8: 1=START { sessionId[16], sensorMask u8 } · 2=STOP
 *   0004  Data          NOTIFY   one protocol-v1 packet per notification (≤ MTU-3 bytes)
 *
 * sensorMask bit (sensorType-1): bit0 ECG, bit1 SpO₂, bit2 temperature.
 * Documented for the app side in docs/firmware/ble-gatt.md.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "device_identity.h"
#include "FirmwareConfig.h"   /* WW_FW_VERSION lives here now (single source) */

typedef struct {
    bool streaming;
    uint8_t session_id[16];
    uint8_t sensor_mask;
    uint32_t generation;  /* bumps on every START/STOP so the stream task can detect a change */
} ww_stream_request_t;

void ww_gatt_init(const ww_identity_t *identity);

/* Publish the Wi-Fi WebSocket proof-of-possession over the Info characteristic,
   so only a BLE-paired phone can learn it. */
void ww_gatt_set_pop(const uint8_t pop[4]);

/* Snapshot of what the phone last asked for. Safe to call from any task. */
void ww_gatt_get_request(ww_stream_request_t *out);

/* True while a central is connected and subscribed to Data. */
bool ww_gatt_can_notify(void);

/* Largest notification payload the current connection carries (ATT MTU − 3). */
uint16_t ww_gatt_max_payload(void);

/* Send one packet. Returns false if not connected / not subscribed / buffers full. */
bool ww_gatt_notify(const uint8_t *bytes, size_t len);
