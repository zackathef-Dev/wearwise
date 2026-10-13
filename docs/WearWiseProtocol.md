# WearWise BLE Protocol (v1)

> **Superseded for the current interface by [`docs/ble-protocol.md`](ble-protocol.md)**, which was checked against
> firmware 0.9.6. This page is kept for its history and design notes; where they differ, `ble-protocol.md` is right.


The one wire contract shared by the ESP32 firmware (`firmware/wearwise-esp32`) and the
mobile app (`packages/sensor-protocol`). BLE notifications and Wi‑Fi WebSocket frames carry
the **same bytes** — the transport is just the pipe.

`PROTOCOL_VERSION = 1`. All multi‑byte fields are **little‑endian**. Codes are frozen: never
renumber a `SensorType`; new sensors get a new, appended code.

---

## GATT service & characteristics

Service UUID: `57570000-5757-4b57-8000-574541525753`

| Char | UUID suffix | Props | Payload |
|---|---|---|---|
| **INFO** | `…0001` | Read | `deviceId[16] · bootId(u32) · protocolVersion(u8) · fwVersion(cstr,NUL) · pop[4]` |
| **CAPS** | `…0002` | Read | N × `[wire_code(u8), reporting(u8), rate_lo(u8), rate_hi(u8)]` |
| **CONTROL** | `…0003` | Write | commands (below) |
| **DATA** | `…0004` | Notify | one sensor packet (below) per notification |
| **WIFI** | `…0005` | Read/Write | Wi‑Fi status / provisioning |

BLE advertising name: `WearWise-XXXX` (last two MAC bytes). `deviceId` is a stable UUID
derived from `SHA-256("wearwise-device:" + MAC)`. `bootId` changes every restart.

### CAPS is dynamic
The firmware builds CAPS from the sensors it **actually detected** at boot, so each board
advertises exactly what it has. A board with no sensors returns **0 bytes** (empty list).
The app reads records in 4‑byte steps; `reporting != 0` means the channel is live;
`rate = rate_lo | (rate_hi << 8)` Hz.

---

## CONTROL commands

| Command | Bytes |
|---|---|
| **START** | `0x01` · `sessionId[16]` · `sensorMask(u8)` — total 18 |
| **STOP** | `0x02` |
| **PROVISION** | `0x10` · `ssid_len(u8)` · `ssid` · `pass_len(u8)` · `pass` |

`sensorMask` selects which capabilities stream: bit `(code − 1)`. One byte ⇒ up to 8 codes
(codes 1–8). *(A future >8‑code need would widen this to `u16`; a coordinated firmware+app
change, backward‑compatible by reading the extra byte only when present.)*

---

## DATA packet

Fixed 58‑byte header, then `sampleCount` int16‑LE samples, then a 4‑byte CRC‑32.
`MAX_SAMPLES_PER_PACKET = 200`, `MAX_PACKET_BYTES = 462`.

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | magic `0x57 0x57` ("WW") |
| 2 | 1 | protocolVersion (=1) |
| 3 | 1 | **sensorType** (wire code) |
| 4 | 1 | encoding (=1, Int16LE) |
| 5 | 1 | flags (`0x01` = simulated) |
| 6 | 16 | deviceId |
| 22 | 4 | bootId (u32) |
| 26 | 16 | sessionId |
| 42 | 4 | sequenceNumber (u32, per device/boot/sensor) |
| 46 | 8 | deviceTimestampUs (u64, since boot) |
| 54 | 2 | sampleRateHz (u16) |
| 56 | 2 | sampleCount (u16) |
| 58 | 2·N | samples (int16 LE) |
| 58+2N | 4 | CRC‑32/IEEE over bytes `[0 .. len−4)` |

**Physical value = rawInt16 × scale**, per sensor:

| Code | Name | scale | unit |
|---|---|---|---|
| 1 | ECG | 0.001 | mV |
| 2 | SpO₂ | 0.01 | % |
| 3 | Temperature | 0.01 | °C |
| 4 | HeartRate | 0.1 | bpm |
| 5 | Accelerometer (magnitude \|a\|) | 0.001 | g |
| 6 | **PPG** (AC‑coupled IR) | 1 | counts |

The decoder rejects a packet whose `sensorType` it doesn't know (`unknown-sensor`) and drops
it without failing the stream — so a firmware that streams a **new** additive code is safe
against an older app; the app just ignores those packets until it ships support.

### Sequence & reconnect
Sequence numbers are per `(device, boot, sensorType)`, starting at 0 and resetting each
session. Resuming a dropped link with the **same sessionId** lets the firmware continue its
sequence numbers, so a reconnect is one counted gap — never a duplicate.

---

## Capability model

The app reasons in capability types; the firmware maps each physical sensor's outputs onto
the wire codes above. A sensor model is a hardware detail: e.g. a MAX30102 provides
HEART_RATE(4) + SPO2(2) + PPG(6); an AD8232 provides ECG(1); an MMA8452Q provides
ACCELERATION(5). MOTION / FALL_EVENT / BATTERY / DEVICE_STATUS are derived on‑device or
exposed via the INFO/WIFI reads rather than as sample streams.

---

## Conformance
`packages/sensor-protocol/fixtures/v1.json` is the shared test vector; the firmware runs
`ww_protocol_self_test()` at boot and **refuses to advertise** if the encoder doesn't match
it. Any change to the envelope (header size, field layout, new encoding) must bump
`PROTOCOL_VERSION` and regenerate the fixture on both sides.
