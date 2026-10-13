#include "wifi.h"
#include "ws_server.h"
#include <string.h>
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

static const char *TAG = "ww-wifi";

static ww_wifi_state_t g_state = WW_WIFI_IDLE;
static uint32_t g_ip = 0;
static int g_retry = 0;
static bool g_started = false;
static esp_netif_t *g_netif = NULL;

#define MAX_RETRY 8
/* After MAX_RETRY quick attempts the link reads FAILED (so a wrong password is
   reported promptly during setup), but the patch keeps trying at this slower pace.
   Giving up for good meant a router restart left the patch off Wi-Fi until reboot. */
#define SLOW_RETRY_US (10LL * 1000 * 1000)
static esp_timer_handle_t g_slow_retry = NULL;

static void slow_retry(void *arg) {
    (void)arg;
    if (g_state != WW_WIFI_CONNECTED) esp_wifi_connect();
}
/* Namespace where firmware < 0.9.1 saved the credentials; now only cleaned up. */
#define NVS_NS "wwcfg"

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ww_ws_stop();
        g_ip = 0;
        if (g_retry < MAX_RETRY) {
            g_retry++;
            g_state = WW_WIFI_CONNECTING;
            esp_wifi_connect();
        } else {
            if (g_state != WW_WIFI_FAILED)
                ESP_LOGW(TAG, "connect failed after %d tries; retrying every %d s", MAX_RETRY, (int)(SLOW_RETRY_US / 1000000));
            g_state = WW_WIFI_FAILED;
            if (g_slow_retry) { esp_timer_stop(g_slow_retry); esp_timer_start_once(g_slow_retry, SLOW_RETRY_US); }
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        g_ip = e->ip_info.ip.addr;
        g_retry = 0;
        g_state = WW_WIFI_CONNECTED;
        if (g_slow_retry) esp_timer_stop(g_slow_retry);
        ESP_LOGI(TAG, "connected, ip=" IPSTR, IP2STR(&e->ip_info.ip));  /* IP only; never the password */
        ww_ws_start();
    }
}

void ww_wifi_init(void) {
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    g_netif = esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, NULL, NULL));
    const esp_timer_create_args_t targs = { .callback = slow_retry, .name = "ww_wifi_retry" };
    ESP_ERROR_CHECK(esp_timer_create(&targs, &g_slow_retry));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));

    /* Credentials live in RAM only (firmware >= 0.9.1): the phone keeps them in its
       secure storage and re-sends them over the authenticated BLE link after every
       connect, so a flash dump of the patch never contains the Wi-Fi password.
       Older firmware saved them in NVS - delete that copy if it is still there. */
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        bool had = nvs_erase_key(h, "ssid") == ESP_OK;
        had |= nvs_erase_key(h, "pass") == ESP_OK;
        if (had) { nvs_commit(h); ESP_LOGI(TAG, "removed Wi-Fi credentials saved by older firmware"); }
        nvs_close(h);
    }
    ESP_LOGI(TAG, "Wi-Fi idle; waiting for the phone to send credentials over BLE");
}

bool ww_wifi_provision(const char *ssid, uint8_t ssid_len, const char *pass, uint8_t pass_len) {
    if (ssid_len == 0 || ssid_len > 32 || pass_len > 64) { ESP_LOGW(TAG, "bad provision lengths"); return false; }

    wifi_config_t wc = {0};
    memcpy(wc.sta.ssid, ssid, ssid_len);
    memcpy(wc.sta.password, pass, pass_len);
    wc.sta.threshold.authmode = pass_len ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;

    /* Not persisted: RAM only, gone at power-off (see ww_wifi_init). NEVER log the password. */

    /* These settings come from the phone, so a refusal is an answer, not a crash
       (ESP_ERROR_CHECK here used to reboot the patch on a short WPA2 password). The
       driver keeps its previous settings, so a working link stays up. */
    esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &wc);
    memset(&wc, 0, sizeof wc);   /* drop the stack copy; the Wi-Fi driver keeps its own in RAM */
    if (err != ESP_OK) { ESP_LOGW(TAG, "network settings refused: %s", esp_err_to_name(err)); return false; }

    g_retry = 0;
    if (g_slow_retry) esp_timer_stop(g_slow_retry);   /* new credentials: start the quick tries afresh */
    g_state = WW_WIFI_CONNECTING;
    ESP_LOGI(TAG, "provisioning network (ssid %u chars)", ssid_len);  /* length only */

    if (!g_started) {
        err = esp_wifi_start();
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Wi-Fi start failed: %s", esp_err_to_name(err));
            g_state = WW_WIFI_FAILED;
            return false;
        }
        g_started = true;
    } else {
        esp_wifi_disconnect();
        esp_wifi_connect();
    }
    return true;
}

ww_wifi_state_t ww_wifi_get_state(void) { return g_state; }
uint32_t ww_wifi_get_ip(void) { return g_ip; }
