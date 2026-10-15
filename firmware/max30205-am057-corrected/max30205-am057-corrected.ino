#include <Wire.h>

// Standalone ESP32 firmware for MAX30205 and nonconforming AM-057 boards.
// Wiring: VDD->3.3V, GND->GND, SDA->GPIO21, SCL->GPIO22. OS is unused.
constexpr int SDA_PIN = 21;
constexpr int SCL_PIN = 22;
constexpr uint32_t I2C_HZ = 100000;

constexpr uint8_t ADDRESS_FIRST = 0x48;
constexpr uint8_t ADDRESS_LAST = 0x4F;
constexpr uint8_t REG_TEMPERATURE = 0x00;
constexpr uint8_t REG_CONFIGURATION = 0x01;

uint8_t sensorAddress = 0;

bool probe(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool writeRegister(uint8_t address, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readRegister(uint8_t address, uint8_t reg, uint8_t *data, size_t count) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  if (Wire.requestFrom(address, count, true) != count) {
    while (Wire.available()) Wire.read();
    return false;
  }

  for (size_t i = 0; i < count; ++i) data[i] = Wire.read();
  return true;
}

bool readTemperature(uint8_t address, float &temperatureC,
                     int16_t &raw, bool &am057Correction) {
  uint8_t data[2];
  if (!readRegister(address, REG_TEMPERATURE, data, 2)) return false;

  raw = static_cast<int16_t>((uint16_t(data[0]) << 8) | data[1]);
  float decoded = raw / 256.0f;

  // A conforming MAX30205 in normal mode directly reports 0..50 C. Some
  // AM-057 revisions incorrectly return T-64 while D5 remains clear. Since
  // MAX30205's specified operating range is 0..50 C, a result from -64..0 C
  // can be safely recognized as that module quirk and corrected by +64 C.
  am057Correction = decoded >= -64.0f && decoded < 0.0f;
  temperatureC = am057Correction ? decoded + 64.0f : decoded;
  return true;
}

uint8_t findSensor() {
  for (uint8_t address = ADDRESS_FIRST; address <= ADDRESS_LAST; ++address) {
    if (!probe(address)) continue;

    // Keep D5 clear. Genuine sensors use normal encoding; affected AM-057
    // boards are corrected in software without triggering a second offset.
    if (!writeRegister(address, REG_CONFIGURATION, 0x00)) continue;
    delay(120);

    float temperatureC;
    int16_t raw;
    bool corrected;
    if (!readTemperature(address, temperatureC, raw, corrected)) continue;
    if (temperatureC < 0.0f || temperatureC > 50.0f) continue;

    Serial.printf("Sensor detected at 0x%02X (%s encoding)\n", address,
                  corrected ? "AM-057 corrected" : "standard MAX30205");
    return address;
  }
  return 0;
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("\n=== MAX30205 / AM-057 corrected firmware ===");
  Serial.println("I2C: SDA GPIO21, SCL GPIO22, 100 kHz");

  Wire.begin(SDA_PIN, SCL_PIN, I2C_HZ);
  Wire.setTimeOut(100);
  sensorAddress = findSensor();

  if (!sensorAddress) {
    Serial.println("ERROR: no valid MAX30205/AM-057 found at 0x48-0x4F");
  }
}

void loop() {
  if (!sensorAddress) {
    delay(2000);
    sensorAddress = findSensor();
    return;
  }

  float temperatureC;
  int16_t raw;
  bool corrected;
  if (readTemperature(sensorAddress, temperatureC, raw, corrected)) {
    Serial.printf("TEMP,%.4f,C,raw=%d,mode=%s\n", temperatureC, raw,
                  corrected ? "AM057" : "STANDARD");
  } else {
    Serial.println("ERROR: temperature read failed; rescanning");
    sensorAddress = 0;
  }
  delay(1000);
}
