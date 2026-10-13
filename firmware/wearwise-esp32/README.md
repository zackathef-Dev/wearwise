# WearWise ESP32 firmware

One **generic, modular** ESP-IDF firmware for the WearWise wearable. The same binary runs
on any ESP-WROOM-32 board; at boot it **auto-detects the I²C sensors that are actually
wired**, exposes their capabilities to the WearWise mobile app over BLE, and streams their
data using the existing WearWise packet protocol. A board with a different sensor mix needs
no code changes — only, at most, a different build profile.

> Research / educational prototype. **Not a medical device.** See [Safety](#safety).

---

## Architecture

```
main/
  main.c                     app_main + the streaming task (acquire @ tick, flush @ burst)
  config/
    HardwareConfig.h         ALL pin numbers (one place)
    FirmwareConfig.h         feature flags, build profiles, versions
  core/
    SensorManager.{c,h}      I²C scan → detect → capability list → per-code read dispatch
    DeviceManager.{c,h}      stable device identity (MAC-derived)
    MeasurementTypes.h       capability model ↔ wire-code mapping
    device_identity.{c,h}    UUID + BLE name from the MAC
  sensors/
    WearWiseSensor.h         common driver interface (a C vtable)
    i2c_bus.{c,h}            shared I²C master (timeouts, error handling)
    MAX30102Sensor.{c,h}     HR + SpO₂ + PPG   (I²C 0x57)
    MAX30205Sensor.{c,h}     Temperature       (I²C 0x48–0x4F)
    MMA8452QSensor.{c,h}     Acceleration      (I²C 0x1C/0x1D)
    AD8232Sensor.{c,h}       ECG               (analog ADC, config-gated, detected by its LO pins)
    SimulatedSensor.{c,h}    synthetic signals (Profile S / no hardware)
    signals.{c,h}            the deterministic signal generators
  algorithms/
    FallDetection.{c,h}      "possible fall" heuristic from accel magnitude
  communication/
    gatt.{c,h}               NimBLE GATT service (INFO/CAPS/CONTROL/DATA/WIFI/TLS)
    protocol.{c,h}           the v1 packet codec (CRC32) + boot self-test
    wifi.{c,h}, ws_server.{c,h}   Wi-Fi provisioning + WebSocket streaming
  utils/
    Logger.h                 WW_DEBUG-gated logging
```

**Two-phase, non-blocking data path.** The stream task ticks every `WW_STREAM_TICK_MS`
(20 ms): each driver's `update()` does its short, non-blocking I²C/ADC work and buffers
samples in a ring. Every `WW_BURST_MS` (200 ms) the task drains each streamed capability's
ring and emits one packet per capability at that sensor's own rate. No `delay()`; ECG is
sampled by a 250 Hz `esp_timer`.

---

## Standard pin map (`config/HardwareConfig.h`)

| Function | GPIO | Notes |
|---|---|---|
| I²C SDA / SCL | 21 / 22 | all I²C sensors share this bus, 400 kHz |
| ECG output (AD8232) | 34 | ADC1_CH6, input-only |
| ECG LO+ / LO− | 32 / 33 | lead-off detect |
| Motion INT1 (MMA8452Q) | 27 | optional |
| SPI SCK / MISO / MOSI | 18 / 19 / 23 | reserved for future digital sensors |

Change wiring in **one file**, with two exceptions: the BOOT button (GPIO0) is fixed in
`communication/ble_pairing.c`, and the AD8232 driver selects `ADC_CHANNEL_6` (GPIO34) itself,
so moving the ECG input means changing `AD8232Sensor.c` too (see `docs/hardware.md`).

---

## Supported sensors

| Sensor | Bus | Capabilities → wire code | Detection |
|---|---|---|---|
| **MAX30102** | I²C 0x57 | HEART_RATE→4, SPO2→2, PPG→6 | PART_ID `0xFF == 0x15` |
| **MAX30205** | I²C 0x48–0x4F | TEMPERATURE→3 | ACK + plausible temperature |
| **MMA8452Q** | I²C 0x1C/0x1D | ACCELERATION→5 (magnitude) | WHO_AM_I `0x0D == 0x2A` |
| **AD8232** | analog | ECG→1 | config-gated; detected by its driven LO+/LO− pins (0.9.4) |

HR/SpO₂ are **prototype** algorithms (peak-interval HR, ratio-of-ratios SpO₂). PPG is the
AC-coupled IR waveform. Acceleration is streamed as the **magnitude** `|a|` (the app's fall
detection consumes it); the driver computes it from the raw X/Y/Z.

### How auto-detection works
`SensorManager` initialises the I²C bus, then asks each compiled-in driver's `begin()` to
probe its address **and verify a chip-ID register** (not address alone — an address can be
shared between parts). Only drivers whose chip really answers are kept, and their
capabilities are aggregated into the list the app reads from the **CAPS** characteristic.

### AD8232 detection
An analog front-end on an ADC pin can't be probed like an I²C device. It is enabled via
`WW_ENABLE_AD8232` (build profiles B and C), and from firmware 0.9.4 the firmware also
checks at boot that one is fitted: the AD8232 drives its lead-off pins LO+ and LO−, so
they ignore the ESP32's weak internal pull-up and pull-down. If both pins simply follow
the pulls, nothing is attached and ECG is left out of the capabilities (the log says
`AD8232 not fitted`). Before 0.9.4 a board without the module still advertised ECG and
recorded ADC noise. A module wired without LO+/LO− would read as absent: build with
`WW_AD8232_DETECT 0` in `FirmwareConfig.h` for that. When fitted it samples at 250 Hz and reports lead-off
from LO+/LO−.

---

## BLE protocol & capabilities

Shared with the app via `packages/sensor-protocol`. The full, current reference is
[`docs/ble-protocol.md`](../../docs/ble-protocol.md). In short:

- **Service** `57570000-5757-4b57-8000-574541525753`, characteristics INFO / CAPS /
  CONTROL / DATA / WIFI / TLS (SHA-256 of the Wi-Fi certificate, which the phone pins).
- **CAPS** (read): 4 bytes per capability `[wire_code, reporting, rate_lo, rate_hi]`, now
  built **dynamically** from detected sensors (empty on a board with none).
- **CONTROL** (write): `START(0x01 + 16-byte sessionId + 1-byte sensor mask)`, `STOP(0x02)`,
  `PROVISION(0x10 …)`. The mask bit for a code is `1 << (code-1)`.
- **DATA** (notify): a 58-byte header + int16-LE samples + CRC32; one packet per capability.

**Wire codes:** ECG=1, SpO₂=2, Temperature=3, HeartRate=4, Accelerometer=5, **PPG=6 (new,
additive)**. Adding a code never renumbers an existing one, so older apps keep working (they
ignore codes they don't know).

---

## Adding a new I²C sensor (e.g. TMP117, MPU6050)

1. Copy a driver (`MAX30205Sensor.*` is the simplest) to `sensors/YourSensor.{c,h}`.
2. Implement the `WearWiseSensor` vtable: `begin()` (probe + **verify chip-ID**),
   `update()` (non-blocking read into a ring), `capabilities()` (map outputs to WearWise
   wire codes — reuse an existing code where the measurement already exists; only add a new
   code in `communication/protocol.{c,h}` **and** `packages/sensor-protocol/src/types.ts`
   for a genuinely new stream), and `read()` (drain the ring).
3. Add the `.c` to `main/CMakeLists.txt` and register it in `SensorManager.ww_sensors_init`
   behind a `WW_ENABLE_*` flag.

That's it — CAPS, streaming, and the app pick it up automatically.

---

## Build / flash

**Without a toolchain:** the researcher dashboard's **Patch setup** page installs the
bundled firmware from Chrome/Edge over USB and writes the patch's label PIN
(`apps/dashboard/README.md` → Patch setup). That is the way to set up patches for a study.

**From source** (development):

```bash
# one-time environment (Windows): set IDF_TOOLS_PATH, then source export
#   PowerShell:  $env:IDF_TOOLS_PATH="C:\esp\tools"; . C:\esp\esp-idf\export.ps1
idf.py set-target esp32          # first time only
idf.py build
idf.py -p <PORT> flash monitor   # Windows COMn, macOS /dev/cu.usbserial-*, Linux /dev/ttyUSB0
```

After pulling the change that added `partitions.csv`, **delete `sdkconfig` once** so the
build picks up the custom partition table from `sdkconfig.defaults` (`idf.py build`
regenerates it). The new layout keeps the settings and the app where they were, so
`idf.py flash` needs no erase. Flashing with `idf.py` never touches the label PIN (the
`wwcfg` partition): a patch that has none keeps using the PIN it made up itself until it
is given one with **Set up** or **New PIN** on the Patch setup page.

The same goes for the security options in `sdkconfig.defaults` (SC-only pairing, the TLS
key exchanges): an existing `sdkconfig` keeps its old values, so **delete `sdkconfig`
once more** after pulling them. (SC-only is also enforced at run time in `gatt.c`, so a
stale `sdkconfig` cannot turn that one off.)

To publish a build to the dashboard: `npm run firmware:export -w dashboard` from the repo
root (`--build <dir>` for another build directory).

### Bluetooth PIN

Pairing is LE Secure Connections with a 6-digit passkey (`communication/ble_pairing.c`).
The patch has no screen, so the PIN is printed on its label: the Patch setup page writes
it to the `wwcfg` partition (`core/factory_config.h`, last 4 KB of flash). A board that
was never set up there generates its own on first boot, keeps it in NVS and prints it on
the serial console — the only case in which the PIN is ever printed; a label PIN never
is. New phones can pair when the patch has no bonds, or within 60 s of a BOOT-button
press.

- **SC only.** Legacy pairing, "Just Works" and keys shorter than 128 bits are refused;
  a link that is not passkey-authenticated LE Secure Connections is dropped (and any bond
  it made deleted).
- **Lock-out after 3 failed pairings.** A wrong PIN, a cancelled dialog, a pairing that
  times out or a phone that hangs up after the PIN prompt each count. After the third,
  pairing is closed — even on a patch with no bonds — until the **BOOT** button is
  pressed (which also opens the 60 s window). The count survives a reboot and resets on
  BOOT or on a successful pairing. Reason: the PIN is fixed, and Secure Connections
  passkey entry gives an active attacker about one bit of it per failed attempt.
- **Two devices** (0.9.6; one before). A patch remembers the two phones or tablets that
  paired with it most recently, so someone can switch between a phone and a tablet
  without pairing again. A third device still needs BOOT and the PIN, and pushes out the
  oldest. One device is connected at a time.
- **No slot hogging.** The patch has one Bluetooth connection slot. A link that is not
  encrypted and authenticated within 30 s (60 s once the PIN prompt is up) is dropped
  and advertising resumes.

Host test for the PIN record (same bytes as the dashboard's test):

```bash
cc -std=c11 -Wall -Wextra -Werror -Imain/core -Imain/communication \
   test/host/test_factory_config.c main/core/factory_config.c -o /tmp/t && /tmp/t
```

**Build profiles** (`WW_PROFILE` in `FirmwareConfig.h`; edit the file, since `idf.py -D…` doesn't reach the C code):

| Profile | Sensors | Expected capabilities |
|---|---|---|
| A | MAX30102 + MAX30205 | heart_rate, spo2, ppg, temperature |
| B | AD8232 + MMA8452Q | ecg, acceleration (+ possible-fall) |
| C *(default)* | all four | all of the above |
| D | none | empty (still boots + advertises) |
| S | none (simulated) | the 5 classic signals, flagged simulated |

Individual flags (`WW_ENABLE_MAX30102`, `WW_ENABLE_AD8232`, …) can override a profile.

### Secrets, randomness and the serial console

- **Random numbers.** The ESP32's hardware RNG is only truly random once Wi-Fi or
  Bluetooth is running; before that `esp_random()` is pseudo-random. `app_main` therefore
  generates every secret — `bootId`, the Wi-Fi PoP, the first-boot TLS key and the NVS
  fallback PIN — between `bootloader_random_enable()` and `bootloader_random_disable()`
  (the SAR-ADC entropy source), and only then initialises the ADC (AD8232), Wi-Fi and
  Bluetooth. Keep new secrets inside that block, and ADC/radio set-up below it.
- **Wi-Fi stream.** Each socket must send the PoP within 3 s of its TLS handshake or it is
  closed; a socket only receives data after proving the PoP itself, so another device on
  the LAN can neither de-authenticate the phone nor catch its packets. Frames are sent
  from the HTTP server's own task, so a send never races the server being stopped.
- **Console.** Never printed: Wi-Fi passwords, the PoP, the TLS key, a label PIN, and —
  unless built with `WW_HR_DEBUG=1` — heart-rate/rhythm values. `WW_DEBUG` (on by
  default) prints start-up and pipeline diagnostics only.

---

## Production hardening (not enabled in this build)

A development patch keeps its flash in plaintext and its USB download mode open: anyone
holding it for a minute with a cable can read the bonds (phone link keys), the TLS private
key the phone pins, and the NVS-fallback PIN, or flash other firmware. For patches that
leave the lab, enable the following. They burn **eFuses — permanent, per chip** — so they
belong to a production process, not to the default build. Try them on spare boards first.

| Feature | Settings | Notes |
|---|---|---|
| **Secure Boot V2** — only firmware signed with your key boots | `CONFIG_SECURE_BOOT=y`, `CONFIG_SECURE_BOOT_V2_ENABLED=y` (RSA-3072) | ESP32 **chip revision ≥ v3.0 required** (`CONFIG_ESP32_REV_MIN_3=y`; ESP-IDF only offers V2 then). Older silicon has only Secure Boot V1 — don't use it. Check with `esptool.py chip_id` or the chip line on the Patch setup page. Keep the signing key offline: lose it and the patch can never be updated; leak it and Secure Boot means nothing. |
| **Flash encryption (release mode)** — flash contents unreadable off the chip | `CONFIG_SECURE_FLASH_ENC_ENABLED=y`, `CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE=y` | Release mode also disables JTAG and USB-side encryption/decryption. Leave `wwcfg` unencrypted: the label PIN is not secret, and it keeps the PIN readable and writable over USB. |
| **NVS encryption** — bonds, TLS key and fallback PIN encrypted at rest | `CONFIG_NVS_ENCRYPTION=y` (default once flash encryption is on) | On the ESP32 it needs a 4 KB `nvs_keys` partition (flags `encrypted`) in `partitions.csv`, which the dashboard's partition-table code and tests must learn. |
| **Disable ROM download mode** — no USB access at all | `CONFIG_SECURE_DISABLE_ROM_DL_MODE=y` | Also needs chip rev ≥ v3.0. The classic ESP32 has no "secure download mode" (that is S2 and later): it is all or nothing. |

**Impact on the dashboard's Patch setup (USB flasher).** It drives the ROM bootloader over
Web Serial with esptool-js, reads the partition table, app header and `wwcfg`, and writes
plaintext images. On a hardened patch:

- *Secure Boot V2 only:* still works, provided every bundled image — bootloader included —
  is **signed with the same key** (`firmware:export` must ship the signed binaries). An
  unsigned or differently-signed bootloader written by **Set up** leaves the patch
  unbootable.
- *With flash encryption (release):* plaintext images written over USB no longer boot, and
  the partition table and app header read back as ciphertext, so the page cannot tell what
  is installed. **Set up / Update** and **Erase all** must be disabled for such patches —
  an erase leaves a patch that can't be re-flashed over USB. Firmware then has to be
  updated over the air, which needs OTA slots in `partitions.csv` and an OTA path
  (neither exists yet). **New PIN** can keep working — `wwcfg` stays unencrypted and
  blanking NVS is a plain write — but the page must use the known layout instead of the
  partition table it reads back (ciphertext).
- *With ROM download mode disabled:* the page cannot talk to the patch at all — no PIN
  changes, no "new participant" reset. Write the final label PIN before burning the eFuse.

Suggested order for a production line: flash signed + encrypted images and the label PIN
at a factory station, then burn the eFuses; keep the Patch setup page for unhardened
research boards. Also still open: limiting the TLS server to AEAD suites (ECDHE-ECDSA
with AES-GCM/ChaCha20) needs a ciphersuite list, which `esp_https_server` in ESP-IDF
5.4 does not expose; today static-ECDH and RSA key exchanges are compiled out
(`sdkconfig.defaults`) and the phone negotiates ECDHE-ECDSA-AES-GCM.

---

## Test procedure

1. `idf.py build` — must complete with no errors.
2. Flash; open the monitor at 115 200 baud and confirm the startup banner: device id, I²C
   pins, an `0x## detected -> …` line per wired sensor, `AD8232: enabled/disabled`, and
   `advertising as WearWise-XXXX`.
3. In the WearWise app: connect over BLE → the **Choose a signal** screen should list exactly
   the capabilities the banner reported.
4. Start a session → each capability streams (trace + live value); numbers look physical.
5. Unplug one sensor and reboot → it drops from the list; the rest still work (Profile D
   with all unplugged → empty list, no crash).
6. Reconnect BLE mid-session → streaming resumes (sequence continuity).
7. Pairing lock-out: on a patch with no bonds, enter a wrong PIN three times → the monitor
   shows `pairing LOCKED`, and a fourth attempt is refused (`pairing refused`, link
   dropped) even with the right PIN. Press BOOT → pairing with the right PIN works.
8. Two devices: pair phone A, press BOOT, pair tablet B → both reconnect without pairing
   (one at a time). Press BOOT, pair phone C → `removed 1 older bond(s)`; A (the oldest)
   can no longer connect until it is paired again (BOOT).
9. Slot hogging: connect with a generic BLE app and don't pair → dropped after 30 s, and
   the patch advertises again. On Android, also pair with the app in the background (the
   pairing request arrives late) and check the 30 s limit doesn't drop it first.
10. Lock-out after a power cycle: lock pairing (step 7), power-cycle → still locked until
    BOOT. Cancelling the phone's PIN dialog counts as one failure, not two.
11. Wi-Fi: stream over Wi-Fi for 30 minutes → no lost or doubled packets. A second device
    on the network that connects without the PoP is closed within ~3 s and the phone's
    stream carries on. A patch set up on older firmware still connects (its certificate
    pin is unchanged).
12. PROVISION with a 1–7 character password, written with a generic BLE app (the WearWise
    app refuses it before sending) → the write fails with `0x13`, the patch doesn't
    reboot, and an existing Wi-Fi connection stays up.
13. First boot after an NVS erase → the TLS key is generated (~1 s), then the ECG reads
    normally and Wi-Fi and Bluetooth come up.

---

## Safety

- The AD8232 path is for **research / education only** and is **not diagnostic**.
- When ECG electrodes are on a person, power the board from a **battery / power bank**, not
  mains-connected USB equipment.
- WearWise reports measurements; it does **not** diagnose. HR/SpO₂/fall detection are
  prototype heuristics.
