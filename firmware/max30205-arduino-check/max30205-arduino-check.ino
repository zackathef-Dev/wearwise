#include <Wire.h>

// ESP-WROOM-32 / common ESP32 DevKit I2C pins.
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;
constexpr uint32_t I2C_FREQUENCY_HZ = 100000;

// MAX30205 address is selected by A0/A1/A2: 0x48 through 0x4F.
constexpr uint8_t MAX30205_ADDRESS_FIRST = 0x48;
constexpr uint8_t MAX30205_ADDRESS_LAST = 0x4F;
constexpr uint8_t MAX30205_REG_TEMPERATURE = 0x00;
constexpr uint8_t MAX30205_REG_CONFIGURATION = 0x01;
constexpr uint8_t AM057_CONFIGURATION = 0x00;

uint8_t sensorAddress = 0;

const char *i2cErrorText(uint8_t error) {
  switch (error) {
    case 0: return "success";
    case 1: return "data too long";
    case 2: return "address NACK";
    case 3: return "data NACK";
    case 4: return "other error";
    case 5: return "timeout";
    default: return "unknown error";
  }
}

bool addressResponds(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool readRegister(uint8_t address, uint8_t reg, uint8_t *data, size_t length) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  uint8_t error = Wire.endTransmission(false); // repeated START

  if (error != 0) {
    Serial.printf("Address 0x%02X: register select failed: %u (%s)\n",
                  address, error, i2cErrorText(error));
    return false;
  }

  size_t received = Wire.requestFrom(address, length, true);
  if (received != length) {
    Serial.printf("Address 0x%02X: requested %u byte(s), received %u\n",
                  address, (unsigned)length, (unsigned)received);
    while (Wire.available()) Wire.read();
    return false;
  }

  for (size_t i = 0; i < length; ++i) data[i] = Wire.read();
  return true;
}

bool writeRegister(uint8_t address, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(value);
  uint8_t error = Wire.endTransmission();
  if (error != 0) {
    Serial.printf("Address 0x%02X: write failed: %u (%s)\n",
                  address, error, i2cErrorText(error));
    return false;
  }
  return true;
}

bool readTemperature(uint8_t address, float &temperatureC) {
  uint8_t bytes[2];
  if (!readRegister(address, MAX30205_REG_TEMPERATURE, bytes, sizeof(bytes))) {
    return false;
  }

  int16_t raw = static_cast<int16_t>((uint16_t(bytes[0]) << 8) | bytes[1]);
  // In extended format (configuration D5=1), MAX30205 stores T - 64 C.
  temperatureC = (raw / 256.0f) + 64.0f;

  Serial.printf("Address 0x%02X: raw bytes %02X %02X, raw value %d, temperature %.4f C\n",
                address, bytes[0], bytes[1], raw, temperatureC);
  return true;
}

void scanBus() {
  Serial.println("\nScanning complete I2C bus...");
  unsigned found = 0;

  for (uint8_t address = 1; address < 0x7F; ++address) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.printf("  Device ACK at 0x%02X\n", address);
      ++found;
    }
  }

  Serial.printf("Scan finished: %u device(s) found.\n", found);
}

uint8_t findMAX30205Address() {
  Serial.println("Testing MAX30205 address range 0x48-0x4F...");

  for (uint8_t address = MAX30205_ADDRESS_FIRST;
       address <= MAX30205_ADDRESS_LAST;
       ++address) {
    if (!addressResponds(address)) continue;

    Serial.printf("Address 0x%02X responds. Testing registers...\n", address);

    uint8_t configuration = 0;
    if (readRegister(address, MAX30205_REG_CONFIGURATION, &configuration, 1)) {
      Serial.printf("Address 0x%02X: configuration register = 0x%02X\n",
                    address, configuration);
    }

    // This AM-057 board returns T-64 encoded samples with its configuration at
    // 0x00. Setting D5 causes this board revision to apply the offset twice.
    if (!writeRegister(address, MAX30205_REG_CONFIGURATION,
                       AM057_CONFIGURATION)) continue;
    delay(120);

    float temperatureC = 0;
    if (readTemperature(address, temperatureC)) {
      if (temperatureC >= -20.0f && temperatureC <= 80.0f) {
        Serial.printf("MAX30205-compatible reading found at 0x%02X.\n", address);
        return address;
      }
      Serial.printf("Address 0x%02X responded, but %.4f C is implausible.\n",
                    address, temperatureC);
    }
  }

  return 0;
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n=== ESP32 MAX30205 diagnostic ===");
  Serial.printf("SDA GPIO%d, SCL GPIO%d, clock %lu Hz\n",
                I2C_SDA_PIN, I2C_SCL_PIN, (unsigned long)I2C_FREQUENCY_HZ);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_FREQUENCY_HZ);
  Wire.setTimeOut(100);

  scanBus();
  sensorAddress = findMAX30205Address();

  if (sensorAddress == 0) {
    Serial.println("No usable MAX30205 reading found.");
    Serial.println("Check 3.3V, GND, SDA->GPIO21, SCL->GPIO22, and pull-ups.");
  } else {
    Serial.printf("Using sensor address 0x%02X.\n", sensorAddress);
  }
}

void loop() {
  if (sensorAddress == 0) {
    delay(3000);
    sensorAddress = findMAX30205Address();
    return;
  }

  float temperatureC = 0;
  if (!readTemperature(sensorAddress, temperatureC)) {
    Serial.println("Read failed; rescanning on the next pass.");
    sensorAddress = 0;
  }

  delay(1000);
}
