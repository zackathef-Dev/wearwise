# WearWise hardware

The WearWise patch is a **research prototype**: an ESP32 development board with up to four
sensor modules on jumper wires or a carrier board. It is not a medical device, and its
readings are prototype sensor measurements, not clinically validated values.

This page is the wiring reference. It was checked against the firmware source
(`firmware/wearwise-esp32/main/config/HardwareConfig.h`) for firmware 0.9.6.

## Bill of materials

| Part | Role | Interface | Notes |
|---|---|---|---|
| ESP32 dev board (ESP-WROOM-32, 4 MB flash, CP210x USB-serial) | Controller, Bluetooth LE, Wi-Fi | USB for power, flashing and logs | Chip revision 3.x tested. Any classic ESP32 (not S2/S3/C3) with 4 MB flash works. |
| MAX30102 | Heart rate, SpO₂, pulse wave (PPG) | I²C, address 0x57 | Detected by its part ID (0x15). |
| MAX30205 | Skin temperature | I²C, 0x48–0x4F | Detected by an ACK plus a plausible reading (−20 to 80 °C). |
| MMA8452Q | Movement (acceleration magnitude), possible-fall detection | I²C, 0x1C or 0x1D | Detected by WHO_AM_I (0x2A). |
| AD8232 | ECG (single lead, education only) | Analog output + two lead-off pins | Can't identify itself; the firmware probes its lead-off pins at boot (since 0.9.4). |
| ECG electrodes and leads | | 3.5 mm jack on most AD8232 boards | Only ever with the board on **battery or a USB power bank**, never on a mains-powered laptop or charger, when electrodes are on a person. |

Any subset of the sensors works. The patch reports only what it actually detects at boot,
so a board with just a MAX30102 offers heart rate, SpO₂ and pulse wave, and a bare board
offers nothing and still pairs.

## Standard pin configuration

| Signal | ESP32 GPIO | Firmware define | Direction | Notes |
|---|---|---|---|---|
| I²C SDA | **GPIO21** | `WW_I2C_SDA` | bidirectional | Shared by MAX30102, MAX30205, MMA8452Q. 400 kHz, port 0. |
| I²C SCL | **GPIO22** | `WW_I2C_SCL` | output | Internal pull-ups are enabled; add 4.7 kΩ external pull-ups for long wires. |
| AD8232 OUTPUT | **GPIO34** | `WW_ECG_ADC` | input (ADC1 channel 6) | Input-only pin. Sampled at 250 Hz. |
| AD8232 LO+ | **GPIO32** | `WW_ECG_LO_PLUS` | input | Lead-off detect; also used at boot to detect the module. |
| AD8232 LO− | **GPIO33** | `WW_ECG_LO_MINUS` | input | As LO+. |
| MMA8452Q INT1 | **GPIO27** | `WW_MOTION_INT` | input | **Reserved, not used yet**: the firmware polls the accelerometer at 50 Hz. Wire it for future interrupt-driven fall detection. |
| SPI SCK | GPIO18 | `WW_SPI_SCK` | reserved | For a future SPI sensor (e.g. MAX30003 ECG). Unused today. |
| SPI MISO | GPIO19 | `WW_SPI_MISO` | reserved | Unused today. |
| SPI MOSI | GPIO23 | `WW_SPI_MOSI` | reserved | Unused today. |
| BOOT button | GPIO0 | `BOOT_BUTTON_GPIO` (in `communication/ble_pairing.c`) | input | The dev board's own button. Pressing it opens a 60 s pairing window and clears a pairing lock-out. |
| Battery monitor | none | `WW_BATTERY_ADC = -1` | | Not fitted. |

Power: every module at **3.3 V** from the board's 3V3 pin, all grounds common. Check
your breakout boards accept 3.3 V (most MAX3010x and MMA8452Q boards do, and the AD8232
module is 3.3 V).

### Where the pins live in the code

`main/config/HardwareConfig.h` is the pin map. Two pins are also fixed elsewhere, which
matters if you ever move them:

- The BOOT button is `GPIO_NUM_0` in `main/communication/ble_pairing.c`.
- The AD8232 driver selects `ADC_CHANNEL_6` directly (`main/sensors/AD8232Sensor.c`), which
  is GPIO34. Changing `WW_ECG_ADC` alone does **not** move the ECG input: change the ADC
  channel in the driver too, and keep it on ADC1 (ADC2 is unavailable while Wi-Fi is on).

## Wiring diagram

```
                ESP32 (ESP-WROOM-32 dev board)
               ┌──────────────────────────────┐
     3V3 ──────┤ 3V3                     GPIO21├──── SDA ──┬── MAX30102 SDA
     GND ──────┤ GND                     GPIO22├──── SCL ──┼── MAX30205 SDA/SCL
               │                               │           └── MMA8452Q SDA/SCL
               │                         GPIO27├──── (INT1, MMA8452Q — reserved)
               │                         GPIO34├──── AD8232 OUTPUT
               │                         GPIO32├──── AD8232 LO+
               │                         GPIO33├──── AD8232 LO−
               │                          GPIO0├──── BOOT button (on the board)
               │                    USB (CP210x)├──── computer / power bank
               └──────────────────────────────┘
```

All four I²C devices share the same two wires (SDA, SCL) plus 3V3 and GND.

## Patch identity and the label

- **Name:** `WearWise-XXXX`, where `XXXX` is the last two bytes of the Bluetooth MAC
  address in hex (for example `WearWise-6280`). This is the name in the phone's pairing
  list and in Chrome's USB port picker after connecting.
- **Device ID:** a UUID derived from the MAC (`SHA-256("wearwise-device:" + MAC)`, first
  16 bytes). It is stable across reboots and firmware updates, and it's what the app
  stores as the device.
- **PIN:** a 6-digit Bluetooth pairing PIN, written to the patch by the dashboard's Patch
  setup page (see [firmware.md](firmware.md#setting-up-a-patch)). Print it on a label on
  the patch. Anyone who will pair a phone needs it.

## Safety

- **Research prototype only.** No diagnostic claims. Readings are prototype sensor
  measurements and are not clinically validated. Fall detection reports a *possible fall*
  and can miss falls or raise false alarms.
- **ECG electrodes on a person:** power the board from a battery or USB power bank only.
  Never from a mains-powered computer, charger or bench supply. The AD8232 module is not
  isolated.
- The MAX30102's red and infrared LEDs are low power, but don't look into them at close
  range.
