# 4.8 Two ESP32s — correct one selected, no cross-talk (physical, 26 Aug 2026)

Two WearWise patches powered on together:
- **WearWise-6280** (MAC and deviceId redacted)
- **WearWise-6990** (MAC and deviceId redacted)

Both run firmware 0.5.0 (deviceId is SHA-256 of the factory MAC, so each is distinct).

- `59-two-devices.png` (MAC addresses redacted) — scan lists BOTH, filtered to WearWise only (service-UUID scan; no other BLE devices).
- `60-connected-6990.png` — selected 6990; header reads "WearWise-6990 · Bluetooth", CONNECTED.
- `61-6990-live.png` — live ECG, 0 gaps.
- The Android `adb logcat` BluetoothGatt capture of this session (MTU 517 and full service
  discovery to WearWise-6990 only, zero connection lines for WearWise-6280) is not included
  in the repository.

Conclusion: the app connected only to the selected device; BLE GATT data is
connection-oriented, so the un-selected patch (still advertising) cannot inject
packets. No cross-talk.
