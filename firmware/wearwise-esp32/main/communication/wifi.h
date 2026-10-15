/* Wi-Fi station + provisioning for the WearWise patch.
 *
 * The phone provisions credentials over the already-trusted BLE link (a write to
 * the Control characteristic), so the SSID/password never travel over the air in
 * the clear and never appear in a log. Once connected, the WebSocket server
 * (ws_server.c) carries the SAME protocol packets the BLE Data characteristic
 * does — the phone's SequenceTracker dedups across the two, which is what makes a
 * Wi-Fi↔BLE handoff free of duplicate packets and duplicate sessions.
 */
#pragma once
#include <stdint.h>
#include <stdbool.h>

typedef enum {
    WW_WIFI_IDLE = 0,
    WW_WIFI_CONNECTING = 1,
    WW_WIFI_CONNECTED = 2,
    WW_WIFI_FAILED = 3,
} ww_wifi_state_t;

void ww_wifi_init(void);

/* Provision + (re)connect as a station. Credentials are kept in RAM only (never
   written to flash, never logged); the phone re-sends them after each BLE connect.
   Safe to call from the BLE callback. Returns false — and changes nothing — if the
   settings are refused (bad lengths, or a password the Wi-Fi driver rejects, e.g.
   1-7 characters for WPA2); the caller reports that to the phone. */
bool ww_wifi_provision(const char *ssid, uint8_t ssid_len, const char *pass, uint8_t pass_len);

ww_wifi_state_t ww_wifi_get_state(void);

/* IPv4 in network order (0 if not connected). */
uint32_t ww_wifi_get_ip(void);
