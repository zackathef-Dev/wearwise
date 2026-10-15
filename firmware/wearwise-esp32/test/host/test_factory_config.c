/* Host test for core/factory_config.c: the firmware must read the exact bytes the
 * patch-setup page writes. VECTOR is shared with
 * apps/dashboard/src/patch/__tests__/patch.test.ts; if one side changes, both fail.
 *
 *   cc -std=c11 -Wall -Wextra -Werror -Imain/core -Imain/communication \
 *      test/host/test_factory_config.c main/core/factory_config.c -o /tmp/t && /tmp/t
 */
#include <stdio.h>
#include <string.h>
#include "factory_config.h"
#include "protocol.h"

/* protocol.c needs ESP-IDF; the same CRC-32, bitwise, stands in for ww_crc32. */
uint32_t ww_crc32(const uint8_t *data, size_t len) {
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++) {
        c ^= data[i];
        for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
    }
    return c ^ 0xFFFFFFFFu;
}

static const char *VECTOR = "575743460100000040e201000078e76800000000000000000000000036cbc013";
static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { printf("FAIL line %d: %s\n", __LINE__, #cond); failures++; } } while (0)

static void from_hex(const char *s, uint8_t *out) {
    for (size_t i = 0; s[2 * i]; i++) sscanf(s + 2 * i, "%2hhx", &out[i]);
}

int main(void) {
    uint8_t rec[WW_FACTORY_RECORD_SIZE];
    ww_factory_config_t cfg = {0};

    from_hex(VECTOR, rec);
    CHECK(ww_factory_parse(rec, sizeof rec, &cfg));
    CHECK(cfg.passkey == 123456);
    CHECK(cfg.provisioned_at == 1760000000u);

    uint8_t blank[WW_FACTORY_RECORD_SIZE];
    memset(blank, 0xFF, sizeof blank);                    /* never set up: erased flash */
    CHECK(!ww_factory_parse(blank, sizeof blank, &cfg));

    from_hex(VECTOR, rec); rec[9] ^= 1;                   /* one flipped bit in the PIN */
    CHECK(!ww_factory_parse(rec, sizeof rec, &cfg));

    from_hex(VECTOR, rec); rec[4] = 2;                    /* a future, incompatible version */
    CHECK(!ww_factory_parse(rec, sizeof rec, &cfg));

    from_hex(VECTOR, rec);
    CHECK(!ww_factory_parse(rec, sizeof rec - 1, &cfg));  /* short read */

    /* A PIN above 999999 with a valid CRC is still refused. */
    from_hex(VECTOR, rec);
    rec[8] = 0x40; rec[9] = 0x42; rec[10] = 0x0F; rec[11] = 0x00;   /* 1000000 */
    uint32_t crc = ww_crc32(rec, 28);
    for (int i = 0; i < 4; i++) rec[28 + i] = (crc >> (8 * i)) & 0xFF;
    CHECK(!ww_factory_parse(rec, sizeof rec, &cfg));

    printf(failures ? "%d failure(s)\n" : "factory_config: all checks passed\n", failures);
    return failures != 0;
}
