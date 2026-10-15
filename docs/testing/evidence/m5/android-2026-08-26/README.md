# Milestone 5 (Wi-Fi) — physical ESP32 + Samsung, 26 Aug 2026

Device: WearWise-6990 (ESP32-D0WD-V3), fw 0.5.0. A 2.4 GHz home network.
Phone, ESP32 and PC on one private LAN (addresses redacted) — one LAN.

## 5.1 Provision over BLE, credentials never in logs — PASS
`serial-wifi-join.log`: the firmware logs only the SSID **length** ("7 chars ssid")
and the resulting IP; the Wi-Fi password is never printed. Credentials are written
from the app to the device over the BLE Control characteristic (opcode 0x10) and
stored in NVS.

## 5.3 Authenticated WebSocket stream over Wi-Fi — PASS
`70-wifi-live.png`: after Start Monitoring, the app handed the read path from BLE to
the WebSocket. Advanced details: **Transport = wifi**, Transport switches = 1,
Duplicates dropped = 0. Live ECG over ws://<patch-ip>:80/stream, gated by the
per-boot PoP token the phone read over BLE.

## 5.4 Kill Wi-Fi → BLE fallback, no dup session, no dup packets — PASS
`71-wifi-killed.png`: phone Wi-Fi disabled mid-stream. The app fell back
automatically — **Transport = bluetooth**, Transport switches = 2 (BLE→WiFi→BLE),
**Duplicates dropped = 0**, SAME session (`efaf68bd`) throughout, 3 gaps total for the
two swap windows (honestly counted; a new-bootId restart would not count). Recording
never stopped. `75-wifi-history.png`: session saved.

## 5.6 Wi-Fi up, internet down → recording unaffected — PASS (incidental)
The phone showed "no internet" (⊘) the entire test; recording and streaming were
unaffected.

## Deferred
- 5.2 mDNS `_wearwise._tcp`: used BLE-reported IP instead (more reliable, no managed
  component). Documented in docs/firmware/ble-gatt.md.
- 5.5 SoftAP-only mode: not implemented; STA provisioning used.
