#include "ble_pairing.h"
#include "factory_config.h"
#include <string.h>
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "nvs.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "host/ble_hs.h"

static const char *TAG = "ww-pair";

#define NVS_NS              "wwble"
#define PAIRING_WINDOW_S    60
#define MAX_FAILED_PAIRINGS 3
#define BOOT_BUTTON_GPIO    GPIO_NUM_0   /* the dev board's BOOT button: low when pressed */

static uint32_t g_passkey;
static bool g_on_label = false;
/* The BOOT window and the failure count are touched by the button task and the
   NimBLE host task; g_mux keeps each read-modify-write whole. */
static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
static int64_t g_window_until_us = 0;
static uint8_t g_failures = 0;   /* failed passkey pairings since the last BOOT press / success */

/* The label PIN written by the patch-setup page. */
static bool load_factory_passkey(uint32_t *out) {
    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)WW_FACTORY_PARTITION_SUBTYPE, WW_FACTORY_PARTITION_LABEL);
    uint8_t rec[WW_FACTORY_RECORD_SIZE];
    ww_factory_config_t cfg;
    if (!part || esp_partition_read(part, 0, rec, sizeof rec) != ESP_OK) return false;
    if (!ww_factory_parse(rec, sizeof rec, &cfg)) return false;
    *out = cfg.passkey;
    return true;
}

/* The NVS fallback is generated here, so main.c calls ww_pairing_init() while the
   true-random entropy source is on (bootloader_random_enable, before the radio). */
static void load_or_create_passkey(void) {
    if (load_factory_passkey(&g_passkey)) {
        g_on_label = true;
        ESP_LOGI(TAG, "pairing passkey: from the factory label");
        return;
    }
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) { g_passkey = esp_random() % 1000000; return; }
    uint32_t pk = 0;
    if (nvs_get_u32(h, "passkey", &pk) != ESP_OK || pk > 999999) {
        pk = esp_random() % 1000000;
        nvs_set_u32(h, "passkey", pk);
        nvs_commit(h);
        ESP_LOGI(TAG, "no factory label - new pairing passkey generated");
    }
    nvs_close(h);
    g_passkey = pk;
}

static uint8_t load_failures(void) {
    nvs_handle_t h;
    uint8_t n = 0;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) return 0;   /* namespace not created yet */
    if (nvs_get_u8(h, "pairfail", &n) != ESP_OK) n = 0;
    nvs_close(h);
    return n;
}

static void save_failures(uint8_t n) {
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_u8(h, "pairfail", n);
    nvs_commit(h);
    nvs_close(h);
}

/* Watches the BOOT button; a press opens the pairing window and lifts a lock-out.
   Polling at 20 Hz is plenty for a human press and avoids ISR plumbing on a
   strapping pin. */
static void button_task(void *arg) {
    (void)arg;
    bool was_down = false;
    while (1) {
        bool down = gpio_get_level(BOOT_BUTTON_GPIO) == 0;
        if (down && !was_down) {
            taskENTER_CRITICAL(&g_mux);
            uint8_t had = g_failures;
            g_failures = 0;
            g_window_until_us = esp_timer_get_time() + (int64_t)PAIRING_WINDOW_S * 1000000;
            taskEXIT_CRITICAL(&g_mux);
            if (had) save_failures(0);
            if (g_on_label)
                ESP_LOGI(TAG, "pairing window open for %d s - pair the new phone now with the PIN on the label",
                         PAIRING_WINDOW_S);
            else
                ESP_LOGI(TAG, "pairing window open for %d s - pair the new phone now (passkey %06lu)",
                         PAIRING_WINDOW_S, (unsigned long)g_passkey);
        }
        was_down = down;
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

int ww_pairing_bond_count(void) {
    int n = 0;
    if (ble_store_util_count(BLE_STORE_OBJ_TYPE_OUR_SEC, &n) != 0) return 0;
    return n;
}

void ww_pairing_init(void) {
    load_or_create_passkey();
    g_failures = load_failures();
    const gpio_config_t io = {
        .pin_bit_mask = 1ULL << BOOT_BUTTON_GPIO, .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE, .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io);
    xTaskCreate(button_task, "ww_pair_btn", 2048, NULL, 3, NULL);
    /* A labelled patch never prints its PIN: anyone with the UART would otherwise read
       it. Without a label the console is the only place the fallback passkey is shown. */
    if (!g_on_label) ESP_LOGI(TAG, "Bluetooth pairing passkey: %06lu (no factory label)", (unsigned long)g_passkey);
    if (g_failures >= MAX_FAILED_PAIRINGS)
        ESP_LOGW(TAG, "pairing locked after %u failed attempts - press BOOT to allow pairing", (unsigned)g_failures);
}

uint32_t ww_pairing_passkey(void) { return g_passkey; }

bool ww_pairing_pin_on_label(void) { return g_on_label; }

bool ww_pairing_allowed(void) {
    taskENTER_CRITICAL(&g_mux);
    bool locked = g_failures >= MAX_FAILED_PAIRINGS;
    int64_t until = g_window_until_us;
    taskEXIT_CRITICAL(&g_mux);
    if (locked) return false;                                       /* too many wrong PINs: BOOT re-opens */
    if (ww_pairing_bond_count() == 0) return true;                  /* first setup */
    return esp_timer_get_time() < until;                            /* BOOT pressed recently */
}

void ww_pairing_failed(void) {
    taskENTER_CRITICAL(&g_mux);
    if (g_failures < UINT8_MAX) g_failures++;
    uint8_t n = g_failures;
    if (n >= MAX_FAILED_PAIRINGS) g_window_until_us = 0;
    taskEXIT_CRITICAL(&g_mux);
    save_failures(n);
    if (n >= MAX_FAILED_PAIRINGS)
        ESP_LOGW(TAG, "%u failed pairing attempts - pairing LOCKED until the BOOT button is pressed", (unsigned)n);
    else
        ESP_LOGW(TAG, "pairing attempt failed (%u of %d before pairing locks)", (unsigned)n, MAX_FAILED_PAIRINGS);
}

#define MAX_PURGE 8
struct purge_list { const ble_addr_t *keep; ble_addr_t addr[MAX_PURGE]; int n; };

static void purge_add(struct purge_list *l, const ble_addr_t *a) {
    if (l->n < MAX_PURGE) l->addr[l->n++] = *a;
}

static int collect_weak(int obj_type, union ble_store_value *val, void *cookie) {
    (void)obj_type;
    if (!val->sec.authenticated || !val->sec.sc || val->sec.key_size < 16) purge_add(cookie, &val->sec.peer_addr);
    return 0;
}

/* Every bond but `keep`, oldest first (the NimBLE store appends new bonds and closes
   gaps on delete, so iteration order is pairing order). Compared on the address bytes alone, never the type, so an
   address-type encoding difference can never make the new phone's own bond look like
   "another" one. */
static int collect_others(int obj_type, union ble_store_value *val, void *cookie) {
    (void)obj_type;
    struct purge_list *l = cookie;
    if (memcmp(val->sec.peer_addr.val, l->keep->val, sizeof l->keep->val) != 0) purge_add(l, &val->sec.peer_addr);
    return 0;
}

static int purge(ble_store_iterator_fn *pick, struct purge_list *l) {
    ble_store_iterate(BLE_STORE_OBJ_TYPE_OUR_SEC, pick, l);    /* collect first, delete after */
    for (int i = 0; i < l->n; i++) ble_store_util_delete_peer(&l->addr[i]);
    return l->n;
}

void ww_pairing_succeeded(const ble_addr_t *peer, bool bonded) {
    taskENTER_CRITICAL(&g_mux);
    uint8_t had = g_failures;
    g_failures = 0;
    g_window_until_us = 0;
    taskEXIT_CRITICAL(&g_mux);
    if (had) save_failures(0);
    if (!bonded || !peer) return;   /* no bond of its own: leave the others in place */
    /* Keep the new device and the most recent other one; forget anything older. */
    struct purge_list l = { .keep = peer, .n = 0 };
    ble_store_iterate(BLE_STORE_OBJ_TYPE_OUR_SEC, collect_others, &l);
    int extra = l.n - (WW_MAX_PAIRED_DEVICES - 1);
    for (int i = 0; i < extra; i++) ble_store_util_delete_peer(&l.addr[i]);
    if (extra > 0) ESP_LOGW(TAG, "new device paired: removed %d older bond(s) (a patch keeps %d)", extra, WW_MAX_PAIRED_DEVICES);
    ESP_LOGI(TAG, "bonded devices: %d", ww_pairing_bond_count());
}

void ww_pairing_purge_weak_bonds(void) {
    struct purge_list l = { .keep = NULL, .n = 0 };
    int n = purge(collect_weak, &l);
    if (n) ESP_LOGW(TAG, "removed %d unauthenticated bond(s)", n);
    ESP_LOGI(TAG, "bonded phones: %d", ww_pairing_bond_count());
}

int ww_pairing_store_status(struct ble_store_status_event *event, void *arg) {
    if (event->event_code == BLE_STORE_EVENT_OVERFLOW) {
        int t = event->overflow.obj_type;
        bool sec = t == BLE_STORE_OBJ_TYPE_OUR_SEC || t == BLE_STORE_OBJ_TYPE_PEER_SEC;
        /* A "Just Works" bond is deleted right after it is written (gatt.c), so it may
           never push a real one out; nor may anything while pairing is closed. */
        if (!ww_pairing_allowed() || (sec && !event->overflow.value->sec.authenticated)) {
            ESP_LOGW(TAG, "bond table full: not evicting a bonded phone for this pairing");
            return BLE_HS_ESTORE_CAP;
        }
    }
    return ble_store_util_status_rr(event, arg);
}
