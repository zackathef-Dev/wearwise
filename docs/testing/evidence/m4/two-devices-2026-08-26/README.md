# 4.8 Two ESP32s — correct one selected, no cross-talk (physical, 26 Aug 2026)

Two WearWise patches powered on together:
- **WearWise-6280** — MAC 8C:94:DF:6E:62:82, deviceId 69f69fe5-9cbb-4b3a-b002-db827b7e129d
- **WearWise-6990** — MAC 68:09:47:37:69:92, deviceId 4c7562b6-f7f1-494a-96bc-c90da076f7f2

Both run firmware 0.5.0 (deviceId is SHA-256 of the factory MAC, so each is distinct).

- `59-two-devices.png` — scan lists BOTH, filtered to WearWise only (service-UUID scan; no other BLE devices).
- `60-connected-6990.png` — selected 6990; header reads "WearWise-6990 · Bluetooth", CONNECTED.
- `61-6990-live.png` — live ECG, 0 gaps.
- `gatt-connect-6990.log` — Android BluetoothGatt: MTU 517 + full service discovery to **Device=68:09:47:37:69:92** only. `adb logcat` had **zero** connection lines for 8C:94:DF (6280) during the session.

Conclusion: the app connected only to the selected device; BLE GATT data is
connection-oriented, so the un-selected patch (still advertising) cannot inject
packets. No cross-talk.
