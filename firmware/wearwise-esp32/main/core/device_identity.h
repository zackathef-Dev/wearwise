/* The device's persistent WearWise identity (protocol deviceId).
 *
 * Derived from the factory MAC by SHA-256, so it is stable across reflashes and
 * NVS erases, and is NOT the BLE address (which the phone sees differently per
 * platform and which may rotate). bootId is random per power-up.
 */
#pragma once
#include <stdint.h>

typedef struct {
    uint8_t device_id[16];   /* RFC 4122 v4-shaped UUID bytes */
    char device_id_str[37];  /* "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx" */
    uint32_t boot_id;
    char ble_name[16];       /* "WearWise-XXXX" from the last two MAC bytes */
} ww_identity_t;

void ww_identity_init(ww_identity_t *id);
