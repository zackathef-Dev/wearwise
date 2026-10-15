/* Factory configuration — what the patch-setup page writes when a patch is set up.
 *
 * The `wwcfg` partition (data subtype 0x40, the last 4 KB of flash, partitions.csv)
 * holds one 32-byte record. It sits outside NVS on purpose: erasing the settings
 * (bonds, Wi-Fi, TLS identity) must never change the PIN printed on the patch's label.
 *
 * Layout, little-endian. Mirrored in apps/dashboard/src/patch/factory-record.ts and
 * pinned by the shared vector in test/host/test_factory_config.c.
 *    0  u32  magic           "WWCF"
 *    4  u16  version         1 — bump only for an incompatible change; new fields
 *                            go in the reserved bytes and keep version 1
 *    6  u16  reserved        0
 *    8  u32  passkey         the Bluetooth pairing PIN, 0..999999
 *   12  u32  provisioned_at  Unix seconds, from the setup page's clock
 *   16  12 B reserved        0
 *   28  u32  crc             CRC-32 (ww_crc32) of bytes 0..27
 *
 * PURE C, no ESP-IDF: the partition read lives in ble_pairing.c.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#define WW_FACTORY_PARTITION_LABEL   "wwcfg"
#define WW_FACTORY_PARTITION_SUBTYPE 0x40
#define WW_FACTORY_RECORD_SIZE       32

typedef struct {
    uint32_t passkey;
    uint32_t provisioned_at;
} ww_factory_config_t;

/* False for a blank sector, a corrupt or unknown record, or an out-of-range PIN. */
bool ww_factory_parse(const uint8_t *buf, size_t len, ww_factory_config_t *out);
