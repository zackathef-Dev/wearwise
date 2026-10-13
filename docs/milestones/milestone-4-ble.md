# Milestone 4 — BLE (ESP32 ↔ Android)

_26 Aug 2026. "Connected esp and android": real packets from a physical
ESP-WROOM-32 over Bluetooth into the participant app, decoded, recorded, and
stored encrypted._

## Outcome

End-to-end BLE works on real hardware. The phone scans for the patch by service
UUID, connects, reads its capabilities from GATT, streams ECG + SpO₂ + temperature,
decodes every packet through the shared codec, and saves the session to the
SQLCipher store — the same recording pipeline Milestone 3 proved, with the byte
source swapped from the in-app simulation to a NimBLE device.

## Files

**Firmware — `firmware/wearwise-esp32/`** (ESP-IDF v5.4, NimBLE)
- `main/protocol.[ch]` — packet encoder + CRC-32, mirrors `packages/sensor-protocol`; boot self-test against `fixtures/v1.json`
- `main/signals.[ch]` — deterministic ECG/SpO₂/temp generators (C port of `signals.ts`)
- `main/device_identity.[ch]` — SHA-256(MAC) → stable deviceId UUID, random bootId
- `main/gatt.[ch]` — service, advertising, START/STOP control, Data notify
- `main/main.c` — boot, self-test, streaming task
- `sdkconfig.defaults` — NimBLE peripheral, BLE-only, MTU 517, 4 MB flash

**App — `apps/mobile/src/data/ble/`**
- `ble-sensor-transport.ts` — `BleSensorTransport implements SensorTransport`; scan, connect, capabilities, subscribe/notify, **auto-reconnect** with backoff that resumes the same session
- `ble-uuids.ts`, `base64.ts` (+ test), `ble-permissions.ts`
- `src/app/pair.tsx` — scan/pair screen; `home.tsx`/`sensor.tsx` — BLE entry points
- `features/monitoring/monitoring-store.ts` — transport-kind switch, scan/pair actions
- `closeSession` now reconciles `session.simulated` from packet `FLAG_SIMULATED`

## Tests

77/77 unit tests pass (`cd apps/mobile && npm test`), including the new
`data/ble/__tests__/base64.test.ts` (round-trips every byte value; a real packet
survives encode → base64 → decode). Firmware runs a boot self-test (CRC vector +
`ecg-5-samples` fixture) and refuses to advertise on mismatch — observed PASS.

## Platform status

- **ESP32**: ✅ built, flashed, self-test PASS, advertising, streaming. ESP32-D0WD-V3, 4 MB, on CP210x USB-serial.
- **physical Android** (SM-G977N): ✅ rows 4.1 (Allow), 4.2, 4.3, 4.4 (short soak), 4.6 all pass with evidence. See `docs/testing/hardware-test-matrix.md`.
- **iPhone**: ⏳ not tested (needs EAS/macOS build).

## Limitations (honest)

- 4.4 ran ~3 min total across two sessions, not the full 10-min soak.
- 4.5 (walk out of range) and 4.7 (backgrounding) not physically exercised; 4.8 needs a second ESP32 (only one on hand).
- Auto-reconnect resumes the same session on device reboot (proven), but a real range-walk with a same-bootId gap count is not yet captured.
- Firmware streams **simulated** physiology (no analog front-end wired). Every packet is flagged `FLAG_SIMULATED` and the app labels it as such, on the live screen and in history.
- Foreground-only: `isBackgroundEnabled: false`. Background BLE is out of scope for this milestone.

## Security

- No secrets in firmware or app. deviceId is derived from the MAC, not a secret.
- BLE permissions use the Android 12 split (`BLUETOOTH_SCAN` with `neverForLocation`, `BLUETOOTH_CONNECT`); no location permission on API ≥ 31.
- BLE sessions persist only to the SQLCipher-encrypted store (verified in M3, row 3.10). No plaintext path.
- The link is currently unauthenticated/unencrypted at the BLE layer (just works pairing). Pairing/bonding + PoP is a Milestone 5 concern alongside Wi-Fi provisioning.

## Run it

```
# firmware (once): $env:IDF_TOOLS_PATH="C:\esp\tools"; C:\esp\esp-idf\export.bat
cd firmware/wearwise-esp32 && idf.py -p <PORT> flash monitor

# app
cd apps/mobile && npx expo start --lan          # Metro
# on the phone: Home → Connect → pick WearWise-XXXX → Start Monitoring
```

## Next: Milestone 5 — Wi-Fi

BLE provisioning of Wi-Fi credentials (with PoP), mDNS discovery, authenticated
WebSocket streaming, and the Wi-Fi→BLE fallback **without a duplicate session or
duplicate packets** — the transport-swap machinery (`engine.attachTransport`,
persistent `SequenceTracker`) is already in place for it.
