/* WebSocket server — the Wi-Fi face of the sensor protocol.
 *
 * Endpoint: wss://<device-ip>:443/stream — TLS only, no plain ws:// listener.
 *           The certificate is the patch's own self-signed one (tls_identity);
 *           the phone pins its SHA-256, read over BLE, instead of trusting a CA.
 * Auth:     the client's FIRST frame must be the PoP token (text), within 3 s of
 *           its TLS handshake. A wrong, late or missing token closes the socket.
 *           The PoP is a per-boot random value the phone learned over the trusted
 *           BLE link (Info characteristic), so only a device that paired over BLE
 *           can open the Wi-Fi stream. Auth is per socket: opening a socket does
 *           not touch the one streaming, and only a socket that proved the PoP
 *           takes the stream over (the previous one is then closed).
 * Data:     the server then pushes protocol-v1 packets as BINARY frames — the
 *           exact same bytes the BLE Data characteristic notifies. Frames are
 *           written only by the server's own task (httpd_queue_work), so a send
 *           never races the server's own replies or a server stop.
 */
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

/* pop = 4-byte token; the hex string of it is what the client must send.
   Call once, before ww_wifi_init. */
void ww_ws_init(const uint8_t pop[4]);

/* Start/stop the HTTP+WS server. Idempotent. Called by wifi.c on GOT_IP / drop
   (both from the Wi-Fi event task). */
void ww_ws_start(void);
void ww_ws_stop(void);

/* True once a client has authenticated with the PoP. */
bool ww_ws_client_ready(void);

/* Queue one protocol packet for the authenticated client (copied; safe from any
   task). False if there is none or the send queue is full. */
bool ww_ws_send(const uint8_t *bytes, size_t len);
