# M4 firmware boot — physical ESP32, 26 Aug 2026

Board: ESP-WROOM-32 (ESP32-D0WD-V3 rev v3.1, 4 MB flash), MAC 8c:94:df:6e:62:80,
on the Silicon Labs CP210x bridge. Built and flashed from
`firmware/wearwise-esp32` with ESP-IDF v5.4.2 (`idf.py -p <PORT> flash`).

`boot.log` is the serial monitor at power-up. It shows:
- `protocol self-test PASS` — the firmware's CRC check vector (123456789 → 0xCBF43926)
  and the `ecg-5-samples` fixture both matched, so it agrees byte-for-byte with
  `packages/sensor-protocol/fixtures/v1.json`. On failure it refuses to advertise.
- `advertising as WearWise-6280` — GATT server up, connectable.

This proves the firmware runs and is protocol-correct on real silicon. It does NOT
prove the phone↔device BLE link — that is rows 4.1–4.8, pending on-device.
