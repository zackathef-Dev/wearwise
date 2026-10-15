# WearWise BLE GATT contract

> **Superseded for the current interface by [`docs/ble-protocol.md`](../ble-protocol.md)**, which was checked against
> firmware 0.9.6. This page is kept for its history and design notes; where they differ, `ble-protocol.md` is right.


The single service the ESP32 patch exposes and the phone drives. This is the
authority for both the firmware (`firmware/wearwise-esp32/main/gatt.c`) and the
app's BLE transport (Milestone 4, `apps/mobile/src/data/ble/`). Bytes are
**little-endian**, matching the sensor protocol.

## Service

`57570000-5757-4b57-8000-574541525753`

Advertised as a complete 128-bit service UUID; the device name
(`WearWise-XXXX`, last two MAC bytes) rides in the scan response. The app scans
**by this service UUID**, so other BLE devices never appear in the picker
(hardware matrix 4.2).

## Security (firmware ≥ 0.9.0)

Every characteristic requires an **encrypted, authenticated** link
(`READ_ENC|READ_AUTHEN` / `WRITE_ENC|WRITE_AUTHEN`); an unpaired central gets
ATT error 5 *Insufficient Authentication* on any access, and sensor data is only
notified over a secure link.

- **Pairing** LE Secure Connections **only** (legacy pairing refused,
  `CONFIG_BT_NIMBLE_SM_SC_ONLY` + `ble_hs_cfg.sm_sc_only`) with MITM protection and
  a 128-bit key (`min_key_size = 16` on every characteristic; a link with a shorter key
  is dropped). The patch's IO capability is DisplayOnly: it "displays" a **6-digit
  passkey** that is random per patch — the label PIN the dashboard's Patch setup page
  writes to the `wwcfg` partition, or, on a board never set up there, one generated on
  first boot and kept in NVS (`wwble/passkey`). Only that NVS fallback is printed on
  the serial console; a label PIN never is. The patch sends a Security Request on
  connect, so Android and iOS show their pairing dialog straight away.
- **Bonding** keys persist in NVS (`CONFIG_BT_NIMBLE_NVS_PERSIST`); a bonded phone
  reconnects encrypted with no prompt.
- **Who may pair** only when the patch has no bonds yet, or within 60 s of a press
  of the **BOOT** button. Otherwise pairing is refused and the link dropped.
- **Lock-out** (firmware ≥ 0.9.3) after **3 failed passkey pairings** — wrong PIN,
  dialog cancelled, SMP timeout, or the phone hanging up after the PIN prompt —
  pairing is closed, first setup included, until BOOT is pressed. The count is kept
  in NVS (`wwble/pairfail`) and reset by BOOT or a successful pairing. LE SC passkey
  entry leaks about one bit of a reused passkey per failed attempt to an active
  attacker; the lock-out caps that at a few bits per BOOT press.
- **Two devices** (firmware ≥ 0.9.6; a single owner from 0.9.3) when a phone or
  tablet completes a *new* passkey pairing and bonds, the patch keeps it and the most
  recent other bond and deletes any older ones. Every new device needs the BOOT window
  and the PIN, so a stray bond cannot persist beyond the next pairing.
- **Connection slot** (firmware ≥ 0.9.3) the patch accepts one connection. A link
  that isn't encrypted + authenticated within 30 s of connecting (60 s once the PIN
  prompt is up), or whose encryption fails, is disconnected and advertising resumes.
- **No passkey, no bond** a pairing that completes *without* authentication (e.g.
  "Just Works" from a central with no input) has its bond deleted and the link
  dropped at once, and unauthenticated bonds are purged at every boot — so an
  unpaired device can't fill the 3-slot bond table and evict the real phone. The bond
  store's overflow handler also refuses to evict a bonded phone for such a pairing,
  or for any pairing while pairing is closed.

Verified 12 Oct 2026 with an unpaired Windows central: every read/write refused
(ATT 5), 0 data packets, a Just-Works pairing attempt rejected and its bond removed.

## Characteristics

| Short | UUID suffix | Props | Payload |
|---|---|---|---|
| Device info | `…0001…` | READ | `deviceId[16]` · `bootId` u32 · `protocolVersion` u8 · `fwVersion` C-string (`"0.5.0\0"`) · `pop[4]` (Wi-Fi proof-of-possession) |
| Capabilities | `…0002…` | READ | N × `{ sensorType u8, reporting u8, sampleRateHz u16 }` (4 bytes each) |
| Control | `…0003…` | WRITE | see opcodes below |
| Data | `…0004…` | NOTIFY | one protocol-v1 packet per notification |
| Wi-Fi status | `…0005…` | READ | `state u8` (0 idle · 1 connecting · 2 connected · 3 failed) · `ipv4[4]` (network order, 0 until connected) |
| TLS fingerprint | `…0006…` | READ | `sha256[32]` of the Wi-Fi stream's certificate (DER). Empty if the patch has no TLS identity. Firmware ≥ 0.8.0. |

Full UUIDs replace the `0000` group: e.g. Data is
`57570004-5757-4b57-8000-574541525753`.

### Control opcodes (write)

| Op | Bytes | Meaning |
|---|---|---|
| `0x01` START | `01` · `sessionId[16]` · `sensorMask u8` | begin streaming the masked sensors into this session |
| `0x02` STOP | `02` | stop streaming |
| `0x10` PROVISION | `10` · `ssidLen u8` · `ssid[ssidLen]` · `passLen u8` · `pass[passLen]` | join a Wi-Fi network (STA). Credentials are kept in RAM only (firmware ≥ 0.9.1; older firmware stored them in NVS and 0.9.1 erases that copy) and never logged. After a power cycle the status reads 0 (idle) until the phone re-sends them — the app keeps them in Keychain/Keystore and does this after every BLE connect. Poll the Wi-Fi status characteristic for the result. Settings the patch refuses (bad lengths, or a password the Wi-Fi driver rejects, e.g. 1–7 characters with WPA2) fail the write with ATT error `0x13` *Value Not Allowed* and leave the current network untouched (firmware ≥ 0.9.3; older firmware ignored bad lengths and rebooted on a refused password). |

## Wi-Fi WebSocket (Milestone 5)

Once the device has an IP (Wi-Fi status = connected), it serves the SAME protocol
over an **encrypted** WebSocket, so the recording pipeline is transport-agnostic:

- **Endpoint** `wss://<device-ip>:443/stream` — TLS 1.2 only
  (ECDHE-ECDSA-AES256-GCM-SHA384 observed). There is no plain `ws://` listener;
  port 80 is closed (firmware ≥ 0.8.0).
- **Certificate** each patch generates its own P-256 key and self-signed X.509
  certificate on first boot and keeps them in NVS (`wwtls`), so the certificate is
  stable across reboots. No key ships in the firmware image. Key usage is
  `digitalSignature` (certificates from firmware ≤ 0.9.2 also carry `keyAgreement`
  and are kept as they are — the phone pins them). Only ECDHE-ECDSA key exchange is
  compiled in; static ECDH and RSA key exchange are not.
- **Trust** the phone does not use public CAs or hostnames (it connects by IP). It
  reads the TLS fingerprint characteristic over BLE and **pins** it: the connection
  is accepted only if the server's leaf certificate has exactly that SHA-256. Native
  code does the pinning (Kotlin/OkHttp on Android, Swift/URLSession on iOS —
  `apps/mobile/modules/pinned-websocket`), because React Native's WebSocket cannot.
- **Auth** the client's FIRST frame must be the `pop` token (the 4 bytes from the
  Info characteristic, as an 8-char lowercase hex string), within **3 s** of the TLS
  handshake. A wrong, late or missing token closes the socket. Since `pop` is only
  readable over a BLE connection, only a BLE-paired phone can open the Wi-Fi stream.
  Auth is per socket (firmware ≥ 0.9.3): a new socket never disturbs the one
  streaming, and only a socket that sent the right `pop` takes the stream over (the
  previous one is closed). At most two sockets are open at once.
- **Data** the server then pushes protocol-v1 packets as **binary** frames —
  byte-identical to the BLE Data notifications, same `deviceId`/`bootId`/`sessionId`
  /`sequenceNumber`. During a BLE↔Wi-Fi handoff the device may stream to both at
  once; the phone's `SequenceTracker` dedups, so there are never duplicate packets
  and never a second session.

Discovery is currently **BLE-reported IP** (read the Wi-Fi status characteristic),
not mDNS — chosen for reliability and to avoid a managed-component dependency.
mDNS `_wearwise._tcp` (matrix row 5.2) is deferred.

`sensorMask` bit `(sensorType − 1)`: bit0 = ECG, bit1 = SpO₂, bit2 = temperature.
A START with mask `0x07` streams all three.

### Data (notify)

Each notification is exactly one packet as defined in
`packages/sensor-protocol/src/codec.ts`: 58-byte header, `sampleCount` int16 LE
samples, CRC-32 trailer. The firmware sizes each burst so the packet fits the
negotiated ATT MTU − 3; at the 517-MTU both platforms negotiate, a full
200-sample packet (462 B) fits in one notification.

`deviceTimestampUs` is microseconds since the **first sample of the stream**, not
wall-clock — the device has no real clock. `bootId` + per-sensor `sequenceNumber`
order the samples and detect a device restart.

## Session / reconnect semantics

- `sessionId` in every packet is the one the phone wrote in START. A stale stream
  from a previous session is rejectable by id.
- On BLE disconnect the firmware pauses but keeps its sample cursor. If the phone
  reconnects and re-issues START **with the same sessionId**, sequence numbers
  continue from where they were; the phone counts the missing packets as a gap
  and keeps one session (matrix 4.5, 4.6). A **new** sessionId resets sequences.
- `bootId` changes on every power-up. A packet with a new bootId mid-session is
  the device having rebooted; the phone's `SequenceTracker` accepts it as a
  restart without starting a new session.
