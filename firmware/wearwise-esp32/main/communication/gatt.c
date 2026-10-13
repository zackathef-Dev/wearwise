#include "gatt.h"
#include "tls_identity.h"
#include "ble_pairing.h"
#include "protocol.h"
#include "SensorManager.h"
#include "wifi.h"
#include <string.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

static const char *TAG = "ww-gatt";

/* 128-bit UUIDs. BLE_UUID128_INIT takes the bytes little-endian (reversed from
   the string), so 57570000-5757-4b57-8000-574541525753 is written tail-first. */
#define WW_UUID(short2)                                                                     \
    BLE_UUID128_INIT(0x53, 0x57, 0x52, 0x41, 0x45, 0x57, 0x00, 0x80, 0x57, 0x4b, 0x57, 0x57, \
                     (short2), 0x00, 0x57, 0x57)

static const ble_uuid128_t UUID_SERVICE = WW_UUID(0x00);
static const ble_uuid128_t UUID_INFO    = WW_UUID(0x01);
static const ble_uuid128_t UUID_CAPS    = WW_UUID(0x02);
static const ble_uuid128_t UUID_CONTROL = WW_UUID(0x03);
static const ble_uuid128_t UUID_DATA    = WW_UUID(0x04);
static const ble_uuid128_t UUID_WIFI    = WW_UUID(0x05);
static const ble_uuid128_t UUID_TLS     = WW_UUID(0x06);

static const ww_identity_t *g_identity;
static uint8_t g_pop[4] = {0};   /* proof-of-possession for the Wi-Fi WebSocket */
static uint8_t g_own_addr_type;
/* volatile: also read by the stream task and the auth-deadline timer. */
static volatile uint16_t g_conn_handle = BLE_HS_CONN_HANDLE_NONE;
/* True once the current link is encrypted AND authenticated (passkey pairing or a
   bonded reconnect). Sensor data is only ever notified over such a link. */
static volatile bool g_link_secure = false;
/* The patch displayed its PIN on this link and that pairing has not finished: if it
   ends any way but success, it counts toward the pairing lock-out (ble_pairing.h). */
static bool g_pin_shown = false;

/* The patch has ONE connection slot (CONFIG_BT_NIMBLE_MAX_CONNECTIONS=1), so a link
   that never authenticates would lock every phone out. It gets AUTH_DEADLINE_S to
   become encrypted + authenticated (a bonded phone needs ~1 s); once the PIN prompt
   is up, PIN_ENTRY_S for a person to type it (SMP's own 30 s timeout normally ends
   a stalled pairing first). Then it is dropped and advertising resumes.
   AUTH_DEADLINE_S was 15 s: Samsung phones first ask "Pair with WearWise-…?" before
   the PIN box, and a person reading that took longer (real-device test, 0.9.4). */
#define AUTH_DEADLINE_S 30
#define PIN_ENTRY_S     60
static esp_timer_handle_t g_auth_timer;

/* NimBLE's persistent bond store (store/config); declared here as in ESP-IDF's
   own bleprph example, which has no public header for it. */
void ble_store_config_init(void);
static uint16_t g_data_handle;
static bool g_data_subscribed = false;

static SemaphoreHandle_t g_req_lock;
static ww_stream_request_t g_req;

static void advertise(void);

/* ---------- characteristic access ---------- */

static int info_read(struct os_mbuf *om) {
    /* deviceId[16] · bootId u32 · protoVer u8 · fwVersion cstr · pop[4] */
    uint8_t buf[16 + 4 + 1 + sizeof WW_FW_VERSION + 4];
    memcpy(buf, g_identity->device_id, 16);
    uint32_t b = g_identity->boot_id;
    buf[16] = b & 0xFF; buf[17] = (b >> 8) & 0xFF; buf[18] = (b >> 16) & 0xFF; buf[19] = (b >> 24) & 0xFF;
    buf[20] = WW_PROTOCOL_VERSION;
    memcpy(buf + 21, WW_FW_VERSION, sizeof WW_FW_VERSION);
    memcpy(buf + 21 + sizeof WW_FW_VERSION, g_pop, 4);
    return os_mbuf_append(om, buf, sizeof buf) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

static int wifi_read(struct os_mbuf *om) {
    /* state u8 · ipv4[4] (network order) */
    uint8_t buf[5];
    buf[0] = (uint8_t)ww_wifi_get_state();
    uint32_t ip = ww_wifi_get_ip();
    memcpy(buf + 1, &ip, 4);
    return os_mbuf_append(om, buf, sizeof buf) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

/* TLS fingerprint: SHA-256 of the Wi-Fi stream's certificate (32 bytes, empty if the
   patch has no TLS identity). The phone pins it — reading it over BLE is what lets it
   trust the patch's self-signed certificate and no other. */
static int tls_read(struct os_mbuf *om) {
    if (!ww_tls_ready()) return 0;
    return os_mbuf_append(om, ww_tls_cert_sha256(), 32) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

/* CAPS is now built from the sensors ACTUALLY detected at boot (SensorManager), not a
   fixed list — so each board advertises exactly what it has. 4 bytes per capability:
   [wire_code, reporting, rate_lo, rate_hi]. A board with no sensors returns 0 bytes. */
static int caps_read(struct os_mbuf *om) {
    ww_capability_t caps[12];
    size_t n = ww_sensors_capabilities(caps, 12);
    uint8_t buf[12 * 4];
    for (size_t i = 0; i < n; i++) {
        buf[i * 4 + 0] = caps[i].wire_code;
        buf[i * 4 + 1] = 1;                          /* reporting */
        buf[i * 4 + 2] = caps[i].sample_rate_hz & 0xFF;
        buf[i * 4 + 3] = caps[i].sample_rate_hz >> 8;
    }
    return os_mbuf_append(om, buf, n * 4) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

static int control_write(struct os_mbuf *om) {
    uint8_t buf[128]; uint16_t len = 0;   /* START=18B; PROVISION up to 2+32+1+64 */
    if (ble_hs_mbuf_to_flat(om, buf, sizeof buf, &len) != 0 || len < 1) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;

    xSemaphoreTake(g_req_lock, portMAX_DELAY);
    if (buf[0] == 1 && len >= 18) {
        memcpy(g_req.session_id, buf + 1, 16);
        g_req.sensor_mask = buf[17];   /* full byte: bit (code-1) per sensor, codes 1..8 (incl. PPG=6) */
        g_req.streaming = g_req.sensor_mask != 0;
        g_req.generation++;
        ESP_LOGI(TAG, "START mask=0x%02x", g_req.sensor_mask);
    } else if (buf[0] == 2) {
        g_req.streaming = false;
        g_req.generation++;
        ESP_LOGI(TAG, "STOP");
    } else if (buf[0] == 0x10) {
        /* PROVISION: 10 | ssid_len | ssid | pass_len | pass. Handled outside the
           lock (Wi-Fi APIs may block); copy out first. */
        xSemaphoreGive(g_req_lock);
        if (len < 3) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        uint8_t sl = buf[1];
        if (2 + sl + 1 > len) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        uint8_t pl = buf[2 + sl];
        if (2 + sl + 1 + pl > len) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        bool ok = ww_wifi_provision((const char *)(buf + 2), sl, (const char *)(buf + 3 + sl), pl);
        memset(buf, 0, sizeof buf);   /* don't leave the password on the stack */
        /* Settings the Wi-Fi driver refuses (e.g. a 1-7 character WPA2 password) fail
           the write, so the phone's write-with-response reports it. */
        return ok ? 0 : BLE_ATT_ERR_VALUE_NOT_ALLOWED;
    } else {
        xSemaphoreGive(g_req_lock);
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    xSemaphoreGive(g_req_lock);
    return 0;
}

static int chr_access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt, void *arg) {
    const ble_uuid_t *u = ctxt->chr->uuid;
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        if (ble_uuid_cmp(u, &UUID_INFO.u) == 0) return info_read(ctxt->om);
        if (ble_uuid_cmp(u, &UUID_CAPS.u) == 0) return caps_read(ctxt->om);
        if (ble_uuid_cmp(u, &UUID_WIFI.u) == 0) return wifi_read(ctxt->om);
        if (ble_uuid_cmp(u, &UUID_TLS.u) == 0) return tls_read(ctxt->om);
        if (ble_uuid_cmp(u, &UUID_DATA.u) == 0) return 0; /* notify-only; empty read */
    } else if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        if (ble_uuid_cmp(u, &UUID_CONTROL.u) == 0) return control_write(ctxt->om);
    }
    return BLE_ATT_ERR_UNLIKELY;
}

#define SECURE_READ  (BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC | BLE_GATT_CHR_F_READ_AUTHEN)
#define SECURE_WRITE (BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_ENC | BLE_GATT_CHR_F_WRITE_AUTHEN)
#define KEY_128      16   /* bytes: only a full-strength encryption key is accepted */

static const struct ble_gatt_svc_def SERVICES[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &UUID_SERVICE.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            /* Every characteristic needs an encrypted, authenticated (passkey-paired)
               link with a 128-bit key: Info carries the Wi-Fi PoP, Control can provision
               Wi-Fi credentials, Data is health data. An unpaired phone's first access is
               refused with "insufficient authentication", which makes Android/iOS start
               pairing. */
            { .uuid = &UUID_INFO.u,    .access_cb = chr_access, .flags = SECURE_READ,  .min_key_size = KEY_128 },
            { .uuid = &UUID_CAPS.u,    .access_cb = chr_access, .flags = SECURE_READ,  .min_key_size = KEY_128 },
            { .uuid = &UUID_CONTROL.u, .access_cb = chr_access, .flags = SECURE_WRITE, .min_key_size = KEY_128 },
            { .uuid = &UUID_DATA.u,    .access_cb = chr_access, .flags = BLE_GATT_CHR_F_NOTIFY | SECURE_READ, .min_key_size = KEY_128,
              .val_handle = &g_data_handle },
            { .uuid = &UUID_WIFI.u,    .access_cb = chr_access, .flags = SECURE_READ,  .min_key_size = KEY_128 },
            { .uuid = &UUID_TLS.u,     .access_cb = chr_access, .flags = SECURE_READ,  .min_key_size = KEY_128 },
            { 0 },
        },
    },
    { 0 },
};

/* ---------- GAP ---------- */

static void arm_auth_deadline(int seconds) {
    esp_timer_stop(g_auth_timer);   /* ESP_ERR_INVALID_STATE if not running: fine */
    esp_timer_start_once(g_auth_timer, (uint64_t)seconds * 1000000);
}

/* esp_timer task. The host API is thread-safe; the check-then-terminate race with a
   link securing at this very instant only costs that phone a reconnect. */
static void auth_deadline(void *arg) {
    (void)arg;
    uint16_t h = g_conn_handle;
    if (h == BLE_HS_CONN_HANDLE_NONE || g_link_secure) return;
    ESP_LOGW(TAG, "link not authenticated in time; disconnecting to free the connection slot");
    ble_gap_terminate(h, BLE_ERR_REM_USER_CONN_TERM);
}

/* The only link the patch serves: encrypted, passkey-authenticated, LE Secure
   Connections, 128-bit key. sm_sc_only already makes the stack refuse anything weaker;
   this re-checks what the link actually got. The SC flag is recorded only in the bond,
   so a link without one (never the case for the app, which bonds) relies on sc_only. */
static bool link_is_strong(const struct ble_gap_conn_desc *d) {
    if (!d->sec_state.encrypted || !d->sec_state.authenticated || d->sec_state.key_size != KEY_128) return false;
    struct ble_store_key_sec key = { .peer_addr = d->peer_id_addr };
    struct ble_store_value_sec bond;
    if (ble_store_read_our_sec(&key, &bond) == 0 && !bond.sc) return false;
    return true;
}

static int gap_event(struct ble_gap_event *event, void *arg) {
    switch (event->type) {
        case BLE_GAP_EVENT_CONNECT:
            if (event->connect.status == 0) {
                g_conn_handle = event->connect.conn_handle;
                g_pin_shown = false;
                arm_auth_deadline(AUTH_DEADLINE_S);
                ESP_LOGI(TAG, "connected handle=%d", g_conn_handle);
                /* Ask for security straight away rather than waiting for the phone to
                   trip over a protected characteristic: a bonded phone then encrypts
                   with its stored keys, and a phone without keys is asked to pair, so
                   its OS reliably shows the passkey dialog. (Relying on the phone to
                   start pairing after an "insufficient authentication" error is not
                   dependable on Android — e.g. after the user forgets the device.) */
                int sec = ble_gap_security_initiate(g_conn_handle);
                if (sec != 0) ESP_LOGW(TAG, "security request failed rc=%d", sec);
            } else {
                ESP_LOGW(TAG, "connect failed status=%d", event->connect.status);
                advertise();
            }
            return 0;
        case BLE_GAP_EVENT_DISCONNECT:
            ESP_LOGI(TAG, "disconnected reason=%d", event->disconnect.reason);
            esp_timer_stop(g_auth_timer);
            if (g_pin_shown) {   /* hung up after the PIN step: a failed attempt */
                g_pin_shown = false;
                ww_pairing_failed();
            }
            g_conn_handle = BLE_HS_CONN_HANDLE_NONE;
            g_link_secure = false;
            g_data_subscribed = false;
            /* Streaming state is deliberately KEPT: if the phone reconnects and
               resends START for the same session, sequence numbers continue and
               the phone counts the outage as a gap (hardware matrix 4.5). Every
               disconnect — including one forced here — re-opens advertising. */
            advertise();
            return 0;
        case BLE_GAP_EVENT_SUBSCRIBE:
            if (event->subscribe.attr_handle == g_data_handle) {
                g_data_subscribed = event->subscribe.cur_notify;
                ESP_LOGI(TAG, "data notify %s", g_data_subscribed ? "ON" : "OFF");
            }
            return 0;
        case BLE_GAP_EVENT_PASSKEY_ACTION:
            /* A phone is pairing. Refuse unless pairing is currently allowed (no
               bonds yet, or BOOT pressed in the last minute, and not locked out);
               otherwise "display" the patch's passkey for the phone's user to type. */
            if (event->passkey.params.action == BLE_SM_IOACT_DISP) {
                if (!ww_pairing_allowed()) {
                    ESP_LOGW(TAG, "pairing refused: already paired, or locked after failed attempts. Press BOOT to allow a new phone.");
                    ble_gap_terminate(event->passkey.conn_handle, BLE_ERR_REM_USER_CONN_TERM);
                    return 0;
                }
                struct ble_sm_io io = { .action = BLE_SM_IOACT_DISP, .passkey = ww_pairing_passkey() };
                int rc = ble_sm_inject_io(event->passkey.conn_handle, &io);
                g_pin_shown = rc == 0;   /* from here on, a failure counts toward the lock-out */
                arm_auth_deadline(PIN_ENTRY_S);
                /* Never echo a label PIN: the UART is not a place to learn it. */
                if (ww_pairing_pin_on_label())
                    ESP_LOGI(TAG, "pairing requested: enter the PIN from the patch label on the phone (rc=%d)", rc);
                else
                    ESP_LOGI(TAG, "pairing requested: enter passkey %06lu on the phone (rc=%d)", (unsigned long)io.passkey, rc);
            }
            return 0;
        case BLE_GAP_EVENT_ENC_CHANGE: {
            struct ble_gap_conn_desc d;
            uint16_t h = event->enc_change.conn_handle;
            int status = event->enc_change.status;
            bool was_pairing = g_pin_shown;   /* a new pairing, not a bonded reconnect */
            g_pin_shown = false;
            if (status == 0 && ble_gap_conn_find(h, &d) != 0) return 0;   /* already gone */
            if (status == 0 && !link_is_strong(&d)) {
                /* Paired WITHOUT the passkey ("Just Works"), or weaker than LE Secure
                   Connections with a 128-bit key — never accepted. Drop the bond it
                   just created and the link, so an unpaired device can neither get in
                   nor fill the bond table and evict the real phone. */
                ESP_LOGW(TAG, "rejected link (authenticated=%d key=%d bytes); removing its bond",
                         d.sec_state.authenticated, d.sec_state.key_size);
                g_link_secure = false;
                ble_store_util_delete_peer(&d.peer_id_addr);
                ble_gap_terminate(h, BLE_ERR_AUTH_FAIL);
                return 0;
            }
            if (status == 0) {
                g_link_secure = true;
                esp_timer_stop(g_auth_timer);
                ESP_LOGI(TAG, "link security: encrypted=%d authenticated=%d bonded=%d key=%d",
                         d.sec_state.encrypted, d.sec_state.authenticated, d.sec_state.bonded, d.sec_state.key_size);
                if (was_pairing) ww_pairing_succeeded(&d.peer_id_addr, d.sec_state.bonded);
                return 0;
            }
            g_link_secure = false;
            if (was_pairing) ww_pairing_failed();   /* wrong PIN, cancelled or SMP timeout */
            /* ENOTCONN: the phone hung up before encryption finished — typically
               it has no keys for this patch (it "forgot" it) and pairing was
               refused because the patch still holds a bond; BOOT allows it. */
            if (status == BLE_HS_ENOTCONN) {
                ESP_LOGW(TAG, "phone disconnected before encryption completed; if it was unpaired, press BOOT to let it pair again");
            } else {
                /* Nothing works on an unencrypted link, so don't let it hold the slot. */
                ESP_LOGW(TAG, "encryption failed status=%d (wrong passkey, pairing cancelled or stale keys); disconnecting", status);
                ble_gap_terminate(h, BLE_ERR_AUTH_FAIL);
            }
            return 0;
        }
        case BLE_GAP_EVENT_REPEAT_PAIRING: {
            /* A bonded phone lost its keys (app/OS reset) and wants to pair again.
               Only honoured when pairing is allowed — never silently re-keyed. */
            if (!ww_pairing_allowed()) {
                ESP_LOGW(TAG, "re-pairing refused: press BOOT to allow it");
                return BLE_GAP_REPEAT_PAIRING_IGNORE;
            }
            struct ble_gap_conn_desc d;
            if (ble_gap_conn_find(event->repeat_pairing.conn_handle, &d) == 0) ble_store_util_delete_peer(&d.peer_id_addr);
            return BLE_GAP_REPEAT_PAIRING_RETRY;
        }
        case BLE_GAP_EVENT_MTU:
            ESP_LOGI(TAG, "MTU %d", event->mtu.value);
            return 0;
        case BLE_GAP_EVENT_ADV_COMPLETE:
            advertise();
            return 0;
        default:
            return 0;
    }
}

static void advertise(void) {
    struct ble_hs_adv_fields adv = {0};
    adv.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    adv.uuids128 = (ble_uuid128_t *)&UUID_SERVICE;
    adv.num_uuids128 = 1;
    adv.uuids128_is_complete = 1;
    int rc = ble_gap_adv_set_fields(&adv);
    if (rc) { ESP_LOGE(TAG, "adv fields rc=%d", rc); return; }

    /* Name goes in the scan response: flags + a 128-bit UUID already fill 21 of
       the 31 advertising bytes. */
    struct ble_hs_adv_fields rsp = {0};
    rsp.name = (uint8_t *)g_identity->ble_name;
    rsp.name_len = strlen(g_identity->ble_name);
    rsp.name_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&rsp);
    if (rc) { ESP_LOGE(TAG, "adv rsp rc=%d", rc); return; }

    struct ble_gap_adv_params p = {0};
    p.conn_mode = BLE_GAP_CONN_MODE_UND;
    p.disc_mode = BLE_GAP_DISC_MODE_GEN;
    rc = ble_gap_adv_start(g_own_addr_type, NULL, BLE_HS_FOREVER, &p, gap_event, NULL);
    if (rc && rc != BLE_HS_EALREADY) ESP_LOGE(TAG, "adv start rc=%d", rc);
    else ESP_LOGI(TAG, "advertising as %s", g_identity->ble_name);
}

static void on_sync(void) {
    ww_pairing_purge_weak_bonds();
    ble_hs_util_ensure_addr(0);
    ble_hs_id_infer_auto(0, &g_own_addr_type);
    advertise();
}

static void on_reset(int reason) { ESP_LOGW(TAG, "host reset reason=%d", reason); }

static void host_task(void *param) {
    nimble_port_run();
    nimble_port_freertos_deinit();
}

/* ---------- public ---------- */

void ww_gatt_init(const ww_identity_t *identity) {
    g_identity = identity;
    g_req_lock = xSemaphoreCreateMutex();
    memset(&g_req, 0, sizeof g_req);

    const esp_timer_create_args_t targs = { .callback = auth_deadline, .name = "ww_ble_auth" };
    ESP_ERROR_CHECK(esp_timer_create(&targs, &g_auth_timer));

    ESP_ERROR_CHECK(nimble_port_init());
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    /* LE Secure Connections + MITM protection via passkey (the patch "displays",
       the phone's user types), with bonding so a paired phone reconnects silently.
       SC-only: legacy pairing and keys shorter than 128 bits are refused by the
       stack. Set here as well as in sdkconfig.defaults (CONFIG_BT_NIMBLE_SM_SC_ONLY)
       so a stale local sdkconfig cannot quietly turn it off. */
    ble_hs_cfg.store_status_cb = ww_pairing_store_status;
    ble_hs_cfg.sm_io_cap = BLE_HS_IO_DISPLAY_ONLY;
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_mitm = 1;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_sc_only = 1;
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_svc_gap_init();
    ble_svc_gatt_init();
    ESP_ERROR_CHECK(ble_gatts_count_cfg(SERVICES));
    ESP_ERROR_CHECK(ble_gatts_add_svcs(SERVICES));
    ESP_ERROR_CHECK(ble_svc_gap_device_name_set(identity->ble_name));
    ble_store_config_init();   /* bonds persist in NVS (CONFIG_BT_NIMBLE_NVS_PERSIST) */
    nimble_port_freertos_init(host_task);
}

void ww_gatt_set_pop(const uint8_t pop[4]) { memcpy(g_pop, pop, 4); }

void ww_gatt_get_request(ww_stream_request_t *out) {
    xSemaphoreTake(g_req_lock, portMAX_DELAY);
    *out = g_req;
    xSemaphoreGive(g_req_lock);
}

bool ww_gatt_can_notify(void) { return g_conn_handle != BLE_HS_CONN_HANDLE_NONE && g_data_subscribed && g_link_secure; }

uint16_t ww_gatt_max_payload(void) {
    if (g_conn_handle == BLE_HS_CONN_HANDLE_NONE) return 0;
    uint16_t mtu = ble_att_mtu(g_conn_handle);
    return mtu > 3 ? mtu - 3 : 0;
}

bool ww_gatt_notify(const uint8_t *bytes, size_t len) {
    if (!ww_gatt_can_notify()) return false;
    struct os_mbuf *om = ble_hs_mbuf_from_flat(bytes, len);
    if (!om) return false;
    int rc = ble_gatts_notify_custom(g_conn_handle, g_data_handle, om);
    if (rc) ESP_LOGW(TAG, "notify rc=%d", rc);
    return rc == 0;
}
