#include "factory_config.h"
#include "protocol.h"   /* ww_crc32 */

#define MAGIC   0x46435757u   /* "WWCF" */
#define VERSION 1
#define CRC_AT  28

static uint32_t get_u32(const uint8_t *p) {
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

bool ww_factory_parse(const uint8_t *buf, size_t len, ww_factory_config_t *out) {
    if (len < WW_FACTORY_RECORD_SIZE) return false;
    if (get_u32(buf) != MAGIC || (buf[4] | buf[5] << 8) != VERSION) return false;
    if (ww_crc32(buf, CRC_AT) != get_u32(buf + CRC_AT)) return false;
    uint32_t passkey = get_u32(buf + 8);
    if (passkey > 999999) return false;
    out->passkey = passkey;
    out->provisioned_at = get_u32(buf + 12);
    return true;
}
