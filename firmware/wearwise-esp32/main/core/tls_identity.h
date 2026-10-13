/* The patch's TLS identity — what makes the Wi-Fi stream wss:// instead of ws://.
 *
 * On first boot the patch generates its own P-256 key pair and a self-signed X.509
 * certificate and keeps both in NVS, so the certificate (and its fingerprint) is
 * stable across reboots and reflashes of the app partition. No shared key ships in
 * the firmware image: every patch has its own, and it never leaves the device.
 *
 * The phone cannot validate a self-signed certificate against a public CA, so it
 * PINS it instead: it reads the SHA-256 fingerprint of the certificate over the BLE
 * link it already trusts (TLS fingerprint characteristic) and accepts the Wi-Fi
 * connection only if the server presents exactly that certificate.
 */
#pragma once
#include <stdint.h>
#include <stdbool.h>

/* Load the key + certificate from NVS, generating and storing them on first boot.
   `common_name` goes into the certificate subject (e.g. "WearWise-6280").
   Returns false only if generation itself failed (the Wi-Fi server then stays off). */
bool ww_tls_identity_init(const char *common_name);

bool ww_tls_ready(void);
const char *ww_tls_cert_pem(void);     /* NUL-terminated PEM */
const char *ww_tls_key_pem(void);      /* NUL-terminated PEM — never logged or sent */
/* SHA-256 of the certificate's DER encoding — what the phone pins. 32 bytes. */
const uint8_t *ww_tls_cert_sha256(void);
