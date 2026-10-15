#include "tls_identity.h"
#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "nvs.h"
#include "mbedtls/pk.h"
#include "mbedtls/ecp.h"
#include "mbedtls/x509_crt.h"
#include "mbedtls/entropy.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/sha256.h"

static const char *TAG = "ww-tls";

#define NVS_NS  "wwtls"
#define KEY_MAX 320    /* PEM EC private key ≈ 230 B */
#define CRT_MAX 1024   /* PEM self-signed P-256 cert ≈ 600 B */

static char g_key_pem[KEY_MAX];
static char g_crt_pem[CRT_MAX];
static uint8_t g_fp[32];
static bool g_ready = false;

static bool load(void) {
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) return false;
    size_t kl = sizeof g_key_pem, cl = sizeof g_crt_pem;
    bool ok = nvs_get_str(h, "key", g_key_pem, &kl) == ESP_OK && nvs_get_str(h, "crt", g_crt_pem, &cl) == ESP_OK;
    nvs_close(h);
    return ok;
}

static bool save(void) {
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) return false;
    bool ok = nvs_set_str(h, "key", g_key_pem) == ESP_OK && nvs_set_str(h, "crt", g_crt_pem) == ESP_OK
              && nvs_commit(h) == ESP_OK;
    nvs_close(h);
    return ok;
}

/* P-256 key + self-signed certificate. Runs once per patch (≈1 s on the ESP32).
   mbedtls_entropy_func draws on the hardware RNG, which is only truly random with
   the radio up or bootloader_random_enable() on — main.c calls this inside the
   latter, before Wi-Fi/BT start. */
static bool generate(const char *cn) {
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_pk_context key;
    mbedtls_x509write_cert crt;
    mbedtls_entropy_init(&entropy);
    mbedtls_ctr_drbg_init(&drbg);
    mbedtls_pk_init(&key);
    mbedtls_x509write_crt_init(&crt);

    bool ok = false;
    static const char pers[] = "wearwise-tls-identity";
    char subject[96];
    snprintf(subject, sizeof subject, "CN=%s,O=WearWise", cn);
    unsigned char serial[16];

    if (mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy, (const unsigned char *)pers, sizeof pers - 1) != 0) goto done;
    if (mbedtls_pk_setup(&key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY)) != 0) goto done;
    if (mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(key), mbedtls_ctr_drbg_random, &drbg) != 0) goto done;
    if (mbedtls_pk_write_key_pem(&key, (unsigned char *)g_key_pem, sizeof g_key_pem) != 0) goto done;

    if (mbedtls_ctr_drbg_random(&drbg, serial, sizeof serial) != 0) goto done;
    serial[0] &= 0x7F;   /* positive INTEGER */
    mbedtls_x509write_crt_set_version(&crt, MBEDTLS_X509_CRT_VERSION_3);
    mbedtls_x509write_crt_set_md_alg(&crt, MBEDTLS_MD_SHA256);
    mbedtls_x509write_crt_set_subject_key(&crt, &key);
    mbedtls_x509write_crt_set_issuer_key(&crt, &key);
    if (mbedtls_x509write_crt_set_serial_raw(&crt, serial, sizeof serial) != 0) goto done;
    /* The patch has no clock, and the phone pins the certificate rather than
       checking dates, so the validity window is simply wide. */
    if (mbedtls_x509write_crt_set_validity(&crt, "20250101000000", "20491231235959") != 0) goto done;
    if (mbedtls_x509write_crt_set_subject_name(&crt, subject) != 0) goto done;
    if (mbedtls_x509write_crt_set_issuer_name(&crt, subject) != 0) goto done;
    if (mbedtls_x509write_crt_set_basic_constraints(&crt, 0, -1) != 0) goto done;
    /* digitalSignature only: the key signs ECDHE handshakes. keyAgreement would also
       let static-ECDH suites (no forward secrecy) use it. Certificates made by older
       firmware keep keyAgreement — the phone pins them, so they are not reissued —
       and sdkconfig.defaults disables those suites anyway. */
    if (mbedtls_x509write_crt_set_key_usage(&crt, MBEDTLS_X509_KU_DIGITAL_SIGNATURE) != 0) goto done;
    if (mbedtls_x509write_crt_pem(&crt, (unsigned char *)g_crt_pem, sizeof g_crt_pem, mbedtls_ctr_drbg_random, &drbg) != 0) goto done;
    ok = true;

done:
    if (!ok) { memset(g_key_pem, 0, sizeof g_key_pem); memset(g_crt_pem, 0, sizeof g_crt_pem); }
    mbedtls_x509write_crt_free(&crt);
    mbedtls_pk_free(&key);
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    return ok;
}

/* Fingerprint = SHA-256 over the certificate's DER bytes — the same bytes the phone
   receives in the TLS handshake, so both sides hash exactly the same thing. */
static bool fingerprint(void) {
    mbedtls_x509_crt c;
    mbedtls_x509_crt_init(&c);
    bool ok = mbedtls_x509_crt_parse(&c, (const unsigned char *)g_crt_pem, strlen(g_crt_pem) + 1) == 0
              && mbedtls_sha256(c.raw.p, c.raw.len, g_fp, 0) == 0;
    mbedtls_x509_crt_free(&c);
    return ok;
}

bool ww_tls_identity_init(const char *common_name) {
    bool loaded = load();
    if (!loaded) {
        ESP_LOGI(TAG, "no TLS identity yet; generating a P-256 key and certificate");
        if (!generate(common_name)) { ESP_LOGE(TAG, "TLS identity generation failed; Wi-Fi stream disabled"); return false; }
        if (!save()) ESP_LOGW(TAG, "could not persist TLS identity; a new one will be made next boot");
    }
    if (!fingerprint()) { ESP_LOGE(TAG, "TLS certificate unreadable; Wi-Fi stream disabled"); return false; }
    g_ready = true;
    /* The fingerprint is public (it is what the phone pins); the key is never logged. */
    ESP_LOGI(TAG, "TLS identity %s, cert sha256 %02x%02x%02x%02x%02x%02x%02x%02x...",
             loaded ? "loaded" : "created", g_fp[0], g_fp[1], g_fp[2], g_fp[3], g_fp[4], g_fp[5], g_fp[6], g_fp[7]);
    return true;
}

bool ww_tls_ready(void) { return g_ready; }
const char *ww_tls_cert_pem(void) { return g_crt_pem; }
const char *ww_tls_key_pem(void) { return g_key_pem; }
const uint8_t *ww_tls_cert_sha256(void) { return g_fp; }
