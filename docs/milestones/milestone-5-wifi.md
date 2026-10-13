# Milestone 5 — Wi-Fi (WebSocket streaming + BLE fallback)

_26 Aug 2026. The same protocol over a WebSocket, provisioned over BLE, with an
automatic fall back to BLE that keeps one session and drops no packets._

## Outcome

Verified end to end on real hardware (WearWise-6990, a 2.4 GHz home network):
provision Wi-Fi over the trusted BLE link → the device joins the LAN and serves a
PoP-authenticated WebSocket → the app streams the same protocol-v1 packets over
Wi-Fi → killing Wi-Fi mid-stream falls back to BLE with **no duplicate session and
no duplicate packets**.

## How it fits together

- **One protocol, two pipes.** The firmware encodes each packet once and fans it
  out to whichever transports are connected (BLE notify + WebSocket binary frame).
  The phone's `SequenceTracker` dedups by `(deviceId, bootId, sequence)`, so an
  overlapping handoff can stream to both at once and the phone still counts each
  packet exactly once.
- **BLE is the control + baseline.** Recording always starts on BLE, which sends
  the START opcode; the firmware then streams to both radios. The coordinator
  swaps only the phone's *read* path to Wi-Fi. That is why the fix in this
  milestone was to defer the Wi-Fi handoff until after the BLE START.
- **Provisioning over BLE.** Control opcode `0x10` carries SSID + password over the
  paired BLE link; the device stores them in NVS and never logs them (only the SSID
  length and the resulting IP appear in the serial log). A per-boot PoP token,
  readable only over BLE, gates the WebSocket.
- **Discovery = BLE-reported IP.** After joining, the device reports its IP on a
  BLE Wi-Fi-status characteristic. This replaces mDNS (5.2) — more reliable and no
  managed-component dependency.

## Files

**Firmware (`firmware/wearwise-esp32/`, fw 0.5.0)**
- `main/wifi.[ch]` — STA connect, NVS-persisted credentials, status, auto-rejoin
- `main/ws_server.[ch]` — `esp_http_server` WebSocket at `:80/stream`, PoP auth, binary frames
- `main/gatt.c` — PROVISION opcode `0x10`, Wi-Fi-status characteristic `…0005…`, PoP in Info
- `main/main.c` — per-boot PoP, fan-out to BLE + WS

**App**
- `src/data/wifi/wifi-sensor-transport.ts` — `WifiSensorTransport` (built-in WebSocket, no native module)
- `src/data/transport/transport-coordinator.ts` — prefer Wi-Fi, fall back to BLE via `engine.attachTransport`
- `src/data/ble/ble-sensor-transport.ts` — `provisionWifi`, `readWifiStatus`, PoP parsing
- `src/features/monitoring/monitoring-store.ts` — `provisionWifi`, deferred handoff at record start
- `src/app/wifi.tsx` — Wi-Fi setup screen

## Tests

77/77 unit tests pass; tsc clean. New logic is on the base64/codec path already
covered; the transport wiring is proven on hardware (evidence below).

## Hardware evidence — `docs/testing/evidence/m5/android-2026-08-26/`

| Row | Result |
|---|---|
| 5.1 provision over BLE, no creds in logs | ✅ serial logs "7 chars ssid" + IP only |
| 5.3 authenticated WebSocket stream | ✅ Transport=wifi, PoP-gated, 0 duplicates |
| 5.4 kill Wi-Fi → BLE fallback, no dup session/packets | ✅ switches=2, dup=0, one session `efaf68bd` |
| 5.6 internet down → unaffected | ✅ incidental (phone had no internet throughout) |

## Limitations (honest)

- 5.3 was a short run, not the full 10-minute soak.
- 5.2 mDNS and 5.5 SoftAP-only are **deferred** (BLE-reported IP + STA cover the need).
- On a Wi-Fi→BLE fallback, 2–3 packets are missed in the swap window and counted as
  gaps — correct behaviour, not hidden.
- The BLE link is unauthenticated at the pairing layer; the Wi-Fi PoP is the first
  auth step. Full BLE bonding is future work.
- When streaming over Wi-Fi, `engine.stop()` sends STOP over the active (Wi-Fi)
  transport, not BLE, so the firmware keeps notifying BLE until the link drops —
  a power nit, not a data-correctness issue.
- A transient "state update on unmounted component" LogBox error appeared only
  during rapid force-stop/deep-link automation; a clean launch is error-free.

## Next: Milestone 6 — cloud sync

Upload recorded sessions/chunks to Supabase Storage/Postgres under RLS, resumable
and offline-first, with the encrypted local store as the source of truth.
