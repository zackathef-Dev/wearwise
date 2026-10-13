#include "device_identity.h"
#include <stdio.h>
#include <string.h>
#include "esp_mac.h"
#include "esp_random.h"
#include "mbedtls/sha256.h"

void ww_identity_init(ww_identity_t *id) {
    uint8_t mac[6] = {0};
    esp_efuse_mac_get_default(mac);

    uint8_t msg[6 + 16];
    memcpy(msg, "wearwise-device:", 16);
    memcpy(msg + 16, mac, 6);
    uint8_t digest[32];
    mbedtls_sha256(msg, sizeof msg, digest, 0);
    memcpy(id->device_id, digest, 16);
    id->device_id[6] = (id->device_id[6] & 0x0F) | 0x40; /* version 4 */
    id->device_id[8] = (id->device_id[8] & 0x3F) | 0x80; /* RFC 4122 variant */

    const uint8_t *b = id->device_id;
    snprintf(id->device_id_str, sizeof id->device_id_str,
             "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
             b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);

    id->boot_id = esp_random();
    if (id->boot_id == 0) id->boot_id = 1;
    snprintf(id->ble_name, sizeof id->ble_name, "WearWise-%02X%02X", mac[4], mac[5]);
}
