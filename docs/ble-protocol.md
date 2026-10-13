# WearWise Bluetooth LE and stream protocol

How the phone and the patch talk. This page was written from the firmware source
(`firmware/wearwise-esp32/main/communication/`) and the shared codec
(`packages/sensor-protocol/src/codec.ts`) at firmware 0.9.6 and protocol version **1**.
Where an older page (`docs/WearWiseProtocol.md`, `docs/firmware/ble-gatt.md`) disagrees,
this page and the source are right.

```
 Patch (ESP32, BLE peripheral)                         Phone (BLE central)
 ─────────────────────────────                         ───────────────────
 advertises service UUID ──────────── scan ──────────▶ filters on the service UUID
 security request ◀──────── LE Secure Connections, 6-digit passkey (label PIN), bond
 INFO, CAPS ─────────────────────── read ────────────▶ identity, firmware, capabilities
 CONTROL ◀──────────────────────── write ───────────── START(session, mask) / STOP / PROVISION
 DATA ───────────────────────── notify ─────────────▶ sensor packets (below)
 WIFI, TLS ───────────────────────── read ───────────▶ Wi-Fi state + IP; certificate SHA-256
 wss://<patch-ip>:443/stream ◀── TLS (pinned) + PoP ── same sensor packets, over Wi-Fi
```

## Advertising and identity

- **Advertisement** carries the 128-bit service UUID; the **scan response** carries the
  name `WearWise-XXXX` (last two MAC bytes in hex).
- The app scans with a filter on the service UUID (12 s timeout) and connects by device.
- One connection at a time (the patch has a single connection slot).

## GATT service

Service UUID: **`57570000-5757-4b57-8000-574541525753`**. Characteristic UUIDs differ only in
the second group: `5757000N-5757-4b57-8000-574541525753`.

| N | Name | Properties | Payload |
|---|---|---|---|
| 0001 | INFO | read | `deviceId[16]` · `bootId u32 LE` · `protocolVersion u8` · `firmwareVersion` (NUL-terminated ASCII, e.g. `0.9.6`) · `pop[4]` |
| 0002 | CAPS | read | 4 bytes per capability: `[wireCode, reporting=1, rateLo, rateHi]` (rate in Hz, u16 LE). Empty on a patch with no sensors. |
| 0003 | CONTROL | write (with response) | Opcodes below. |
| 0004 | DATA | notify | One sensor packet per notification (format below). |
| 0005 | WIFI | read | `state u8` (0 idle, 1 connecting, 2 connected, 3 failed) · `ipv4[4]` (network order) |
| 0006 | TLS | read | SHA-256 (32 bytes) of the patch's Wi-Fi TLS certificate; empty if it has none. |

**Every characteristic requires an encrypted, authenticated link with a 128-bit key**
(LE Secure Connections passkey pairing, or a bonded reconnect). Nothing is readable before
pairing, and sensor data is only notified on such a link.

### CONTROL opcodes

| Opcode | Bytes | Effect |
|---|---|---|
| `0x01` START | `01` · `sessionId[16]` · `mask u8` | Start or retarget streaming. Bit `(code − 1)` of `mask` selects wire code `code` (ECG = bit 0 … PPG = bit 5). A mask of 0 stops. |
| `0x02` STOP | `02` | Stop streaming. |
| `0x10` PROVISION | `10` · `ssidLen u8` · `ssid` · `passLen u8` · `pass` | Join a Wi-Fi network (SSID ≤ 32, password ≤ 64 bytes). An empty password means an open network. Settings the Wi-Fi driver refuses (e.g. a 1–7 character WPA2 password) fail the write. Credentials are kept **in RAM only**, so the phone re-sends them after a patch restart. |

Streaming state survives a Bluetooth disconnect: if the phone reconnects, the session
continues with the same session ID and sequence numbers.

## Pairing and security

- I/O capability DisplayOnly; bonding, MITM protection and **Secure Connections only**. A
  link that isn't SC, isn't authenticated or uses a short key is dropped, and its bond deleted.
- The 6-digit passkey is the **label PIN** written by Patch setup (`wwcfg` partition). A
  patch never set up there uses a self-made PIN kept in NVS.
- New pairings are accepted only with no bonds, or within 60 s of pressing **BOOT**.
- Three failed pairings lock pairing out until BOOT is pressed (persisted across reboots).
- At most **two** bonded centrals (0.9.6). A third replaces the oldest.
- An unauthenticated link is dropped after 30 s (60 s while the PIN prompt is up).

On the phone the operating system shows the PIN prompt. The app retries its first read for
up to 60 s while the person types (`apps/mobile/src/data/ble/ble-sensor-transport.ts`) and
explains failures (`pairing-help.ts`).

## Sensor packet (DATA notifications and Wi-Fi frames)

All integers **little-endian**. Header 58 bytes; at most 200 samples; at most 462 bytes,
which fits one notification at the negotiated MTU (the app requests 517).

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 2 | magic | `0x57 0x57` ("WW") |
| 2 | 1 | protocolVersion | 1 |
| 3 | 1 | sensorType | wire code, table below |
| 4 | 1 | encoding | 1 = int16 LE |
| 5 | 1 | flags | `0x01` simulated · `0x02` last in burst (unused) · `0x04` ECG leads off (samples are not a signal) |
| 6 | 16 | deviceId | raw UUID bytes (stable per patch) |
| 22 | 4 | bootId | random per boot. A change means the patch restarted. |
| 26 | 16 | sessionId | the ID the phone sent in START |
| 42 | 4 | sequenceNumber | per sensor type, +1 per packet sent |
| 46 | 8 | deviceTimestamp | µs of the **first** sample, relative to the session start (below) |
| 54 | 2 | sampleRateHz | |
| 56 | 2 | sampleCount | 1…200 |
| 58 | 2·n | samples | int16 LE; physical value = raw × scale. Out-of-range values clamp, never wrap. |
| 58+2n | 4 | checksum | CRC-32/IEEE (poly 0xEDB88320, init and final XOR 0xFFFFFFFF) of bytes [0, 58+2n) |

**Timestamps.** Continuous signals (ECG, PPG, movement) are timed by sample count: the
sensor's own clock is steadier than task timing. Low-rate "gappy" signals (heart rate,
SpO₂, ≤ 5 Hz), which are only sent while the estimate is valid, use the real elapsed time
since the session started, so a dropout stays a gap.

**Sequence tracking.** The app keys streams by `(session, sensorType)` and counts gaps and
duplicates (`packages/sensor-protocol/src/sequence.ts`). A packet is accepted only if its
CRC matches.

### Sensor codes, units and scales

| Code | Signal | Unit | Scale (raw → unit) | Source sensor | Rate |
|---|---|---|---|---|---|
| 1 | ECG | mV | 0.001 | AD8232 | 250 Hz |
| 2 | SpO₂ | % | 0.01 | MAX30102 | 1 Hz (when valid) |
| 3 | Temperature | °C | 0.01 | MAX30205 | 2 Hz |
| 4 | Heart rate | bpm | 0.1 | MAX30102 | 1 Hz (when valid) |
| 5 | Movement (acceleration magnitude) | g | 0.001 | MMA8452Q | 50 Hz |
| 6 | Pulse wave (PPG, AC-coupled IR) | counts | 1 | MAX30102 | 100 Hz |

Codes never change meaning. A new kind of measurement takes the next free code (7, 8),
added in both `communication/protocol.{c,h}` and `packages/sensor-protocol/src/types.ts`.
Older apps ignore codes they don't know. The START mask is one byte, so code 8 is the last
one possible in protocol version 1.

The shared fixture `packages/sensor-protocol/fixtures/v1.json` is the contract: the
firmware checks its encoder against it at every boot, and the app's tests decode it.

## Wi-Fi stream

Bluetooth carries everything on its own. Wi-Fi is an optional, faster path on the same
local network:

1. The phone sends PROVISION with the network's name and password (it keeps them in its
   secure storage, per patch).
2. The phone polls WIFI (0005) until it reads *connected* plus an IP address.
3. It reads TLS (0006): the SHA-256 of the patch's self-signed certificate (P-256, made on
   first boot and kept in NVS).
4. It opens `wss://<patch-ip>:443/stream`, accepting **only** a certificate with that
   SHA-256 (native modules in `apps/mobile/modules/pinned-websocket/`). There's no host-name
   check: the pin is the trust.
5. Within 3 s it sends a text frame with the 8 lowercase hex characters of INFO's `pop[4]`
   (proof-of-possession: only a phone that read INFO over the authenticated Bluetooth link
   knows it). A wrong or late PoP closes the socket. At most two sockets; one streams.
6. Each sensor packet then arrives as one binary WebSocket frame, byte-identical to the
   Bluetooth notification.

If Wi-Fi drops, the app falls back to Bluetooth without ending the recording. Release
builds refuse to stream over Wi-Fi without a pin.

## Versioning rules

- `protocolVersion` (INFO and every packet) changes only for an incompatible layout change.
  Both sides must then change together, with new fixtures.
- Adding a wire code, a CONTROL opcode or a characteristic is additive and doesn't bump
  the version. Old apps ignore what they don't know.
- The firmware version (INFO) is informational. The app stores it with the device record
  and includes it in the status it sends to a researcher's live view.
