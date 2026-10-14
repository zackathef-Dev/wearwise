# WearWise firmware (ESP32)

Firmware for the WearWise patch, a **research prototype**. Source:
`firmware/wearwise-esp32/` (ESP-IDF, C). Current version: **0.9.6**
(`WW_FW_VERSION` in `main/config/FirmwareConfig.h`, the single source of the version).

Related pages: [hardware.md](hardware.md) (wiring and pins), [ble-protocol.md](ble-protocol.md)
(the Bluetooth interface and packet format), `firmware/wearwise-esp32/README.md` (developer
notes, test procedures, build profiles) and `docs/HRValidation.md` (tuning the heart-rate
pipeline).

## What the firmware does

1. At boot it scans the I²C bus, identifies each sensor by its chip ID (not just its
   address), and probes for an AD8232 ECG front-end.
2. It builds a **capability list**: one entry per signal it can actually measure, with its
   sample rate.
3. It advertises over Bluetooth LE as `WearWise-XXXX` and accepts only encrypted,
   PIN-authenticated connections.
4. When the phone writes START (a session ID and the signals it wants), it streams sensor
   packets: over Bluetooth notifications, and also over a TLS WebSocket on the local Wi-Fi
   network if the phone has given it Wi-Fi details.
5. It runs on-device signal processing: an accuracy-first heart-rate pipeline, SpO₂ from
   the MAX30102, and a *possible fall* detector on the accelerometer.

The patch never talks to the backend. It has no Supabase URL, key or hostname. The phone
is its only peer, so moving the backend (local, cloud, self-hosted) needs no firmware
change.

## Source layout

```
firmware/wearwise-esp32/
├── CMakeLists.txt            project; reads PROJECT_VER from WW_FW_VERSION
├── partitions.csv            nvs · phy_init · factory app (1.5 MB) · wwcfg (label PIN, last 4 KB)
├── sdkconfig.defaults        NimBLE peripheral, SC-only pairing, MTU 517, HTTPS server, …
├── main/
│   ├── main.c                app_main: boot sequence and the streaming task
│   ├── config/
│   │   ├── HardwareConfig.h  pin map (see hardware.md)
│   │   └── FirmwareConfig.h  version, build profile, feature flags, debug switches
│   ├── core/
│   │   ├── SensorManager.*   I²C scan, driver registration, capability list
│   │   ├── DeviceManager.*   device state
│   │   ├── device_identity.* name and deviceId from the MAC; random bootId
│   │   ├── tls_identity.*    self-signed P-256 certificate for the Wi-Fi stream (made once, kept in NVS)
│   │   └── factory_config.*  reads the label-PIN record from the wwcfg partition
│   ├── sensors/
│   │   ├── WearWiseSensor.h  the driver interface (vtable)
│   │   ├── MAX30102Sensor.*, MAX30205Sensor.*, MMA8452QSensor.*, AD8232Sensor.*
│   │   ├── SimulatedSensor.*, signals.*   synthetic signals (profile 'S' only)
│   │   └── i2c_bus.*         shared I²C bus
│   ├── algorithms/
│   │   ├── HRPipeline.*      heart rate + SpO₂ from PPG
│   │   ├── RhythmCheck.*     autocorrelation cross-check of the beat rhythm
│   │   └── FallDetection.*   free-fall → impact → stillness state machine
│   ├── communication/
│   │   ├── gatt.*            BLE service, characteristics, advertising, link security
│   │   ├── ble_pairing.*     PIN, BOOT-button window, lock-out, two-device limit
│   │   ├── protocol.*        packet encoder + CRC-32 (mirror of packages/sensor-protocol)
│   │   ├── wifi.*            station mode, credentials in RAM only
│   │   └── ws_server.*       wss://<patch-ip>/stream, TLS, proof-of-possession
│   └── utils/Logger.h
├── test/host/                host-run C test for the label-PIN record
└── tools/export-firmware.mjs copies a build into the dashboard's Patch setup page
```

### Boot sequence (`main/main.c`)

1. NVS init.
2. Protocol self-test against the recorded fixture. On failure the patch does **not**
   advertise, so a broken encoder can never stream.
3. Secrets, made with the hardware RNG enabled: a random boot ID, a 4-byte Wi-Fi
   proof-of-possession, the TLS identity (first boot only), and the pairing PIN fallback.
4. WebSocket server, Wi-Fi, sensors (`ww_sensors_init`), Bluetooth (`ww_gatt_init`).
5. The `ww_stream` task: every 20 ms it polls the sensors; every 200 ms it sends one packet
   per requested signal.

### Sensor Manager and the driver interface

`core/SensorManager.c` initialises I²C, then offers each enabled driver the bus. A driver's
`begin()` must confirm its chip ID; only then is it registered. Capabilities are merged
with "first owner of a wire code wins", up to 6 sensors and 12 capabilities.

Every driver implements the vtable in `sensors/WearWiseSensor.h`: `begin`, `update`,
`available`, `name`, `capabilities`, `read`, `flush`, `status`.

## Supported sensors

| Sensor | Detection | Signals (wire code, rate) |
|---|---|---|
| MAX30102 | I²C 0x57, part ID 0x15 | Heart rate (4, 1 Hz), SpO₂ (2, 1 Hz), pulse wave / PPG (6, 100 Hz). LED drive is adjusted automatically. |
| MAX30205 | I²C 0x48–0x4F, plausible temperature | Skin temperature (3, 2 Hz). Handles the extended-format +64 °C offset. |
| MMA8452Q | I²C 0x1C/0x1D, WHO_AM_I 0x2A | Movement (5, 50 Hz): acceleration magnitude in g. Feeds fall detection and the heart-rate motion check. |
| AD8232 | Config flag plus a boot-time probe of LO+/LO− | ECG (1, 250 Hz), electrode-referred mV. Packets carry a "leads off" flag while an electrode is off. |

Units and scales are in [ble-protocol.md](ble-protocol.md#sensor-codes-units-and-scales).

### Signal processing (prototype)

- **Heart rate** (`algorithms/HRPipeline.c`): DC tracking, a 0.5–4 Hz band-pass, an adaptive
  beat detector, median/MAD validation of beat intervals, a rhythm cross-check, and quality
  states NO_CONTACT / ACQUIRING / VALID / DEGRADED. Heart rate is published once per second,
  only while the estimate is valid. Tunables: `ww_hr_default_config`.
- **SpO₂** uses the textbook ratio-of-ratios curve `110 − 25·R`, **uncalibrated**. Expect
  offsets between modules. See the known limitations below.
- **Possible fall** (`algorithms/FallDetection.c`): free fall below 0.6 g, then an impact
  above 2.5 g within 1 s, then 1.2 s of stillness (0.75–1.30 g). The firmware logs it. The
  phone runs its own fall logic on the movement stream and shows the alarm. Thresholds are
  at the top of the file.

## Configuration

Everything is compile-time, in `main/config/FirmwareConfig.h`. **Edit the file**:
`idf.py build -DWW_...` sets a CMake variable, not a C define, so it has no effect on these
flags.

| Setting | Default | Meaning |
|---|---|---|
| `WW_FW_VERSION` | `"0.9.6"` | Shown to the phone and to Patch setup. Bump it for every release. |
| `WW_PROFILE` | `'C'` | Which drivers to consider. A: MAX30102 + MAX30205 · B: AD8232 + MMA8452Q · C: all four · D: none · S: simulated signals. I²C drivers still only activate if their chip is found. |
| `WW_ENABLE_*` | from the profile | Per-driver switches. |
| `WW_AD8232_DETECT` | 1 | Probe the AD8232's lead-off pins at boot. Set 0 for a module wired without LO+/LO−. |
| `WW_ECG_SAMPLE_RATE_HZ` | 250 | ECG rate. |
| `WW_ENABLE_FALL_DETECTION` | 1 | On-device possible-fall flag. |
| `WW_DEBUG` | 1 | Verbose boot and I²C scan logs on the serial port (115200 baud). |
| `WW_HR_DEBUG` | 0 | One `HRBEAT,…` line per candidate beat, for tuning (docs/HRValidation.md). Keep 0 for normal builds. |

## Building and flashing from source

### Install ESP-IDF 5.4 (once)

The firmware is built and tested with **ESP-IDF v5.4.2**.

- **macOS / Linux:**
  ```bash
  mkdir -p ~/esp && cd ~/esp
  git clone -b v5.4.2 --recursive https://github.com/espressif/esp-idf.git
  cd esp-idf && ./install.sh esp32
  . ~/esp/esp-idf/export.sh        # in every new terminal before building
  ```
- **Windows:** install "ESP-IDF v5.4.2" with Espressif's *ESP-IDF Tools Installer*, then use
  the "ESP-IDF PowerShell" shortcut it creates (or run `export.ps1` from the ESP-IDF folder).
  If you set `IDF_TOOLS_PATH` to a custom folder, set it **before** running `export.ps1`.
- USB driver for the board's USB-serial chip: Silicon Labs **CP210x** (most ESP-WROOM-32
  dev boards) or WCH **CH340**. macOS and most Linux distributions include them.

### Build, flash, monitor

```bash
cd firmware/wearwise-esp32
idf.py set-target esp32          # first time only (creates sdkconfig from sdkconfig.defaults)
idf.py build
idf.py -p <PORT> flash monitor   # Ctrl-] leaves the monitor
```

`<PORT>` is `COM3`-style on Windows, `/dev/cu.usbserial-XXXX` on macOS
(`ls /dev/cu.usbserial*`) and `/dev/ttyUSB0` on Linux.

- If your checkout has an old `sdkconfig` from before `partitions.csv` and the
  security options existed, delete it once: `idf.py build` regenerates it from
  `sdkconfig.defaults`. `sdkconfig` is gitignored.
- `idf.py flash` never touches the `wwcfg` partition, so a patch keeps its label PIN.
- On macOS, opening the board's serial port resets the ESP32. That's normal.

### Publishing a build to Patch setup

The dashboard's Patch setup page installs the files in `apps/dashboard/public/firmware/`
(three images plus `manifest.json` with offsets and SHA-256). After building:

```bash
npm run firmware:export -w dashboard     # from the repo root; --build <dir> for another build dir
```

The export refuses builds for another chip, encrypted builds, and builds without the
`wwcfg` partition. It records the git commit in `manifest.json` (with `-dirty` if
`firmware/wearwise-esp32` has uncommitted changes), so build releases from a clean
checkout. `LICENSE-Apache-2.0.txt` in the same folder is the licence of ESP-IDF, NimBLE and
Mbed TLS, which the images contain; the export leaves it in place.

## Setting up a patch

The normal way, with no toolchain: the dashboard's **Patch setup** page (staff accounts,
Chrome or Edge, USB cable). The full steps are in `apps/dashboard/README.md` → *Patch setup*.

- **Set up:** installs the bundled firmware, writes a new random 6-digit PIN and erases the
  patch's settings. Use it for a new patch.
- **Update:** new firmware, keeps the PIN, paired phones and Wi-Fi.
- **New PIN:** for a new participant. Firmware untouched, settings erased.
- **Erase everything:** wipes the whole flash.

Print the PIN on a label on the patch. A patch flashed with `idf.py` that was never set up
on the page makes up its own PIN on first boot and prints it on the serial console. That
is the only case in which a PIN is ever printed.

### Pairing rules (enforced by the firmware)

- LE Secure Connections with a 6-digit passkey only. Anything weaker is refused and its
  bond deleted.
- New phones can pair only when the patch has no bonds, or within **60 s of pressing BOOT**.
- **Lock-out after 3 failed pairings** (wrong PIN, cancelled, timed out). It survives
  reboots and clears on BOOT or on a successful pairing.
- A patch remembers its **two** most recent phones or tablets (0.9.6). A third needs BOOT
  plus the PIN and replaces the oldest. One is connected at a time.
- A link that isn't encrypted and authenticated within 30 s (60 s once the PIN prompt is
  up) is dropped.

## Adding a new sensor

Example: a TMP117 temperature sensor or an MPU6050 accelerometer on the same I²C bus.

1. Copy the simplest driver, `sensors/MAX30205Sensor.{c,h}`, to `sensors/YourSensor.{c,h}`.
2. Implement the vtable from `sensors/WearWiseSensor.h`:
   - `begin()` probes the bus and **must verify the chip ID**. Return false if it isn't there.
   - `update()` is a non-blocking read into a small ring buffer, called every 20 ms.
   - `capabilities()` maps outputs to wire codes. **Reuse an existing code** if the
     measurement already exists (another thermometer is code 3).
   - `read()` drains the ring. `status()` can report "leads off" or similar.
3. Add `sensors/YourSensor.c` to `main/CMakeLists.txt`.
4. Add `#define WW_ENABLE_YOURSENSOR …` to `FirmwareConfig.h`, then include the header and
   call `try_register(...)` for it in `core/SensorManager.c`.
5. **Only for a new kind of measurement** (a new wire code):
   - add the code to `communication/protocol.h` and its scale and unit to
     `communication/protocol.c`. The encoder returns 0 for an unknown code;
   - add the same code, scale and unit to `packages/sensor-protocol/src/types.ts` and
     regenerate the fixtures (`npm run fixtures -w @wearwise/sensor-protocol`);
   - teach the app and dashboard to display it (labels, ranges, units);
   - if the backend should accept it, widen the `sensor_type` checks in a new migration
     (`vital_alerts.sensor_type between 1 and 6`, `private.valid_sensor_types`).
   - Wire codes never change meaning, and the START mask is one byte, so codes 1–8 are
     the maximum without a protocol version bump.
6. Build, flash, and check the boot log lists the sensor; the app shows it automatically
   (capabilities are read on every connect).

## Tests

- **On boot:** the protocol self-test (encoder against `packages/sensor-protocol/fixtures/v1.json`).
- **Host test** for the label-PIN record (the same bytes the dashboard writes):
  ```bash
  cd firmware/wearwise-esp32
  cc -std=c11 -Wall -Wextra -Werror -Imain/core -Imain/communication \
     test/host/test_factory_config.c main/core/factory_config.c -o /tmp/t && /tmp/t
  ```
- **Hardware procedures** (pairing, lock-out, streaming, Wi-Fi): the test sections of
  `firmware/wearwise-esp32/README.md` and `docs/testing/hardware-test-matrix.md`.

## Known limitations

- SpO₂ is uncalibrated, and a weaker module can read low. One test board read about 80 %
  at rest while another read 99 %. Heart rate can read about double before it settles,
  or on a poorly seated sensor (real-device test 2026-10-13, findings 19–20). These need
  a reference pulse oximeter and module-by-module checks.
- Fall detection is a prototype threshold detector. It reports a *possible fall* and can
  miss falls or raise false alarms.
- The MMA8452Q interrupt pin (GPIO27) is reserved but unused (polling at 50 Hz).
- There is no over-the-air update. Firmware is installed over USB (Patch setup or `idf.py`).
- `manifest.json` records no git commit for the bundled 0.9.6 build (`"commit": null`).
  Rebuild from a tagged commit if you need provenance.
