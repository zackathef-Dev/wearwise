#include "ws_server.h"
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_https_server.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "protocol.h"   /* WW_MAX_PACKET_BYTES */
#include "tls_identity.h"

static const char *TAG = "ww-ws";

/* One phone streams at a time; each TLS session costs ~20 KB of RAM next to the BLE +
   Wi-Fi stacks, so keep the ceiling low. The second slot lets a reconnecting phone in
   while its previous, half-dead socket is still open. */
#define WS_MAX_SOCKETS     2
/* A socket must send the right PoP this soon after its TLS handshake, or it is closed:
   it may not sit on one of the WS_MAX_SOCKETS slots. The app sends it at once. */
#define WS_AUTH_TIMEOUT_US (3LL * 1000 * 1000)
#define WS_SWEEP_US        (1000LL * 1000)
/* Packets waiting for the server task to send them (ww_ws_send). A burst is one
   packet per streamed capability (six today), so this rides out one slow burst. */
#define WS_SEND_SLOTS      8
#define POP_HEX_LEN        8

typedef struct { int fd; bool authed; int64_t deadline_us; } ws_sess_t;
typedef struct { bool busy; int fd; size_t len; uint8_t data[WW_MAX_PACKET_BYTES]; } ws_slot_t;

/* Shared by the stream task (ww_ws_send), the Wi-Fi event task (start/stop), the
   HTTP server task (handler, open/close callbacks, queued work) and the sweep timer,
   so all of it is only touched under g_lock. Never hold g_lock across httpd_ssl_stop:
   the server task takes it while closing its sessions. */
static SemaphoreHandle_t g_lock;
static httpd_handle_t g_server = NULL;
static int g_client_fd = -1;   /* the socket that proved the PoP; the only one streamed to */
static ws_sess_t g_sess[WS_MAX_SOCKETS];
static ws_slot_t g_slot[WS_SEND_SLOTS];
static esp_timer_handle_t g_sweep_timer;
static char g_pop_hex[POP_HEX_LEN + 1];   /* 8 hex chars + NUL */

static void lock(void) { xSemaphoreTake(g_lock, portMAX_DELAY); }
static void unlock(void) { xSemaphoreGive(g_lock); }

/* With g_lock held. fd = -1 finds a free entry. */
static ws_sess_t *sess_find(int fd) {
    for (int i = 0; i < WS_MAX_SOCKETS; i++)
        if (g_sess[i].fd == fd) return &g_sess[i];
    return NULL;
}

/* Constant time: how long a wrong token takes to refuse must not tell how much of it
   was right. (The length is public: always 8.) */
static bool pop_matches(const uint8_t *buf, size_t len) {
    if (len != POP_HEX_LEN) return false;
    uint8_t diff = 0;
    for (size_t i = 0; i < POP_HEX_LEN; i++) diff |= buf[i] ^ (uint8_t)g_pop_hex[i];
    return diff == 0;
}

/* ---------- server task: session lifecycle ---------- */

/* Right after a TLS handshake: the new socket's PoP countdown starts. A socket is
   never streamed to until it proves the PoP, whatever else it does. */
static esp_err_t on_open(httpd_handle_t hd, int fd) {
    (void)hd;
    lock();
    ws_sess_t *s = sess_find(-1);   /* always found: one entry per server socket */
    if (s) { s->fd = fd; s->authed = false; s->deadline_us = esp_timer_get_time() + WS_AUTH_TIMEOUT_US; }
    unlock();
    return ESP_OK;
}

/* Every session end — client gone, closed by us, or server stop. Clearing the fd
   here is what keeps a reused socket number from inheriting the stream. */
static void on_close(httpd_handle_t hd, int fd) {
    (void)hd;
    lock();
    ws_sess_t *s = sess_find(fd);
    if (s) s->fd = -1;
    bool was_client = g_client_fd == fd;
    if (was_client) g_client_fd = -1;
    unlock();
    if (was_client) ESP_LOGI(TAG, "ws client fd=%d closed", fd);
    close(fd);   /* a custom close_fn closes the socket itself */
}

static esp_err_t ws_handler(httpd_req_t *req) {
    int fd = httpd_req_to_sockfd(req);
    if (req->method == HTTP_GET) {
        /* Opening handshake completed by the stack. This socket is NOT the client yet,
           and the one streaming now is left alone: only a correct PoP switches over. */
        ESP_LOGI(TAG, "ws open fd=%d, awaiting PoP", fd);
        return ESP_OK;
    }

    httpd_ws_frame_t frame = {0};
    frame.type = HTTPD_WS_TYPE_TEXT;
    esp_err_t r = httpd_ws_recv_frame(req, &frame, 0);   /* length probe */
    if (r != ESP_OK) return r;
    /* The app sends one 8-character token and nothing after it. A bigger frame is
       refused rather than left half-read in the socket. (Returning an error from the
       handler makes the server close the session.) */
    if (frame.len > 64) { ESP_LOGW(TAG, "ws oversized frame, closing fd=%d", fd); return ESP_FAIL; }
    uint8_t buf[64];
    if (frame.len) {
        frame.payload = buf;
        r = httpd_ws_recv_frame(req, &frame, sizeof buf);
        if (r != ESP_OK) return r;
    }

    /* The handler, on_open and on_close all run on the server task, so the entry
       cannot change between these two locked sections. */
    lock();
    ws_sess_t *s = sess_find(fd);
    bool authed = s && s->authed;
    unlock();
    if (authed) return ESP_OK;   /* the stream is server→client; later frames are ignored */

    /* First frame must be the PoP token; anything else closes the socket. */
    if (!s || !pop_matches(buf, frame.len)) { ESP_LOGW(TAG, "ws bad PoP, closing fd=%d", fd); return ESP_FAIL; }

    lock();
    s->authed = true;
    int previous = g_client_fd;
    g_client_fd = fd;
    unlock();
    ESP_LOGI(TAG, "ws authenticated fd=%d", fd);
    /* One phone streams at a time: the socket that just proved the PoP replaces the
       old one (in practice the same phone's previous, dead connection). */
    if (previous >= 0 && previous != fd) httpd_sess_trigger_close(req->handle, previous);
    return ESP_OK;
}

static const httpd_uri_t WS_URI = {
    .uri = "/stream",
    .method = HTTP_GET,
    .handler = ws_handler,
    .is_websocket = true,
};

/* ---------- server task: queued work ---------- */

/* Closes sockets whose PoP deadline passed. Queued by sweep_tick. */
static void sweep_work(void *arg) {
    (void)arg;
    int expired[WS_MAX_SOCKETS], n = 0;
    lock();
    httpd_handle_t server = g_server;
    int64_t now = esp_timer_get_time();
    for (int i = 0; i < WS_MAX_SOCKETS; i++) {
        if (g_sess[i].fd >= 0 && !g_sess[i].authed && now >= g_sess[i].deadline_us) {
            expired[n++] = g_sess[i].fd;
            g_sess[i].deadline_us = INT64_MAX;   /* close it once */
        }
    }
    unlock();
    for (int i = 0; server && i < n; i++) {
        ESP_LOGW(TAG, "ws fd=%d sent no valid PoP in time, closing", expired[i]);
        httpd_sess_trigger_close(server, expired[i]);
    }
}

/* The ONLY place frames are written: on the server task, a send can never interleave
   with the server's own writes on the same TLS session (PONG/CLOSE replies), and the
   server cannot be stopped underneath it. */
static void send_work(void *arg) {
    ws_slot_t *slot = arg;
    lock();
    httpd_handle_t server = g_server;
    bool current = server && slot->fd == g_client_fd;   /* client may have changed since */
    unlock();
    if (current) {
        httpd_ws_frame_t frame = { .type = HTTPD_WS_TYPE_BINARY, .payload = slot->data, .len = slot->len };
        if (httpd_ws_send_frame_async(server, slot->fd, &frame) == ESP_OK) {
            /* Keep the streaming socket "recent", so when all slots are taken the
               server's LRU purge picks an idle stranger, not the phone. */
            httpd_sess_update_lru_counter(server, slot->fd);
        } else {
            /* Client gone or stuck: stop queueing to it and close it. */
            ESP_LOGW(TAG, "ws send failed, closing fd=%d", slot->fd);
            lock();
            if (g_client_fd == slot->fd) g_client_fd = -1;
            unlock();
            httpd_sess_trigger_close(server, slot->fd);
        }
    }
    lock();
    slot->busy = false;
    unlock();
}

/* ---------- other tasks ---------- */

/* esp_timer task, every second while the server runs. */
static void sweep_tick(void *arg) {
    (void)arg;
    lock();
    bool due = false;
    int64_t now = esp_timer_get_time();
    for (int i = 0; i < WS_MAX_SOCKETS; i++)
        if (g_sess[i].fd >= 0 && !g_sess[i].authed && now >= g_sess[i].deadline_us) due = true;
    if (due && g_server) httpd_queue_work(g_server, sweep_work, NULL);
    unlock();
}

static void reset_state(void) {   /* with g_lock held, while no server task runs */
    g_client_fd = -1;
    for (int i = 0; i < WS_MAX_SOCKETS; i++) g_sess[i].fd = -1;
    for (int i = 0; i < WS_SEND_SLOTS; i++) g_slot[i].busy = false;
}

void ww_ws_init(const uint8_t pop[4]) {
    snprintf(g_pop_hex, sizeof g_pop_hex, "%02x%02x%02x%02x", pop[0], pop[1], pop[2], pop[3]);
    g_lock = xSemaphoreCreateMutex();
    reset_state();
    const esp_timer_create_args_t targs = { .callback = sweep_tick, .name = "ww_ws_sweep" };
    ESP_ERROR_CHECK(esp_timer_create(&targs, &g_sweep_timer));
}

/* start/stop run on the Wi-Fi event task only, so they never race each other. */
void ww_ws_start(void) {
    lock();
    bool running = g_server != NULL;
    unlock();
    if (running) return;
    /* TLS only: there is no plain ws:// listener any more, so sensor data never
       crosses the network unencrypted. Without an identity the stream stays off
       (the phone keeps streaming over Bluetooth). */
    if (!ww_tls_ready()) { ESP_LOGE(TAG, "no TLS identity; Wi-Fi stream not started"); return; }
    httpd_ssl_config_t cfg = HTTPD_SSL_CONFIG_DEFAULT();
    cfg.servercert = (const uint8_t *)ww_tls_cert_pem();
    cfg.servercert_len = strlen(ww_tls_cert_pem()) + 1;
    cfg.prvtkey_pem = (const uint8_t *)ww_tls_key_pem();
    cfg.prvtkey_len = strlen(ww_tls_key_pem()) + 1;
    cfg.transport_mode = HTTPD_SSL_TRANSPORT_SECURE;
    cfg.port_secure = 443;
    cfg.session_tickets = false;
    cfg.httpd.max_open_sockets = WS_MAX_SOCKETS;
    cfg.httpd.open_fn = on_open;     /* esp_https_server calls it after the TLS handshake */
    cfg.httpd.close_fn = on_close;
    lock();
    reset_state();
    unlock();
    httpd_handle_t server = NULL;
    if (httpd_ssl_start(&server, &cfg) != ESP_OK) { ESP_LOGE(TAG, "httpd_ssl_start failed"); return; }
    httpd_register_uri_handler(server, &WS_URI);
    lock();
    g_server = server;
    unlock();
    esp_timer_start_periodic(g_sweep_timer, WS_SWEEP_US);
    ESP_LOGI(TAG, "wss server up at :443/stream");
}

void ww_ws_stop(void) {
    lock();
    httpd_handle_t server = g_server;
    g_server = NULL;   /* from here on, senders and the sweep see "stopped" */
    g_client_fd = -1;
    unlock();
    if (!server) return;
    esp_timer_stop(g_sweep_timer);
    httpd_ssl_stop(server);   /* closes every session (on_close), then the server task ends */
    lock();
    reset_state();            /* work the server task never ran died with it: free its slots */
    unlock();
    ESP_LOGI(TAG, "ws server stopped");
}

bool ww_ws_client_ready(void) {
    lock();
    bool ready = g_server && g_client_fd >= 0;
    unlock();
    return ready;
}

/* Called from the stream task. Copies the packet into a free slot and has the server
   task send it (send_work); false if there is no client or every slot is in flight. */
bool ww_ws_send(const uint8_t *bytes, size_t len) {
    if (len > WW_MAX_PACKET_BYTES) return false;
    bool queued = false;
    lock();
    if (g_server && g_client_fd >= 0) {
        for (int i = 0; i < WS_SEND_SLOTS; i++) {
            ws_slot_t *slot = &g_slot[i];
            if (slot->busy) continue;
            slot->fd = g_client_fd;
            slot->len = len;
            memcpy(slot->data, bytes, len);
            queued = httpd_queue_work(g_server, send_work, slot) == ESP_OK;
            slot->busy = queued;
            break;
        }
    }
    unlock();
    return queued;
}
