#include "i2c_bus.h"
#include "HardwareConfig.h"
#include "Logger.h"
#include "driver/i2c_master.h"

static const char *TAG = "ww-i2c";

static i2c_master_bus_handle_t s_bus;
static bool s_ready;

/* Small cache of per-address device handles. The i2c_master API works through a device
   handle bound to an address + speed; we lazily create one per address we talk to
   (a WearWise board has only a handful of I2C sensors, so 8 slots is plenty). */
#define MAX_DEVS 8
static struct { uint8_t addr; i2c_master_dev_handle_t dev; } s_devs[MAX_DEVS];
static int s_dev_count;

bool ww_i2c_init(void) {
    if (s_ready) return true;
    i2c_master_bus_config_t cfg = {
        .i2c_port = WW_I2C_PORT,
        .sda_io_num = WW_I2C_SDA,
        .scl_io_num = WW_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    esp_err_t err = i2c_new_master_bus(&cfg, &s_bus);
    if (err != ESP_OK) {
        WW_LOGE(TAG, "i2c bus init failed: %s", esp_err_to_name(err));
        return false;
    }
    s_ready = true;
    WW_LOGI(TAG, "I2C SDA:%d SCL:%d @ %d Hz", WW_I2C_SDA, WW_I2C_SCL, WW_I2C_FREQ_HZ);
    return true;
}

/* Get (or lazily create) a device handle for `addr`. NULL on failure. */
static i2c_master_dev_handle_t dev_for(uint8_t addr) {
    if (!s_ready) return NULL;
    for (int i = 0; i < s_dev_count; i++) if (s_devs[i].addr == addr) return s_devs[i].dev;
    if (s_dev_count >= MAX_DEVS) return NULL;
    i2c_device_config_t dcfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = addr,
        .scl_speed_hz = WW_I2C_FREQ_HZ,
    };
    i2c_master_dev_handle_t dev;
    if (i2c_master_bus_add_device(s_bus, &dcfg, &dev) != ESP_OK) return NULL;
    s_devs[s_dev_count].addr = addr;
    s_devs[s_dev_count].dev = dev;
    s_dev_count++;
    return dev;
}

bool ww_i2c_probe(uint8_t addr) {
    if (!s_ready) return false;
    return i2c_master_probe(s_bus, addr, WW_I2C_TIMEOUT_MS) == ESP_OK;
}

bool ww_i2c_read_reg(uint8_t addr, uint8_t reg, uint8_t *buf, size_t len) {
    i2c_master_dev_handle_t dev = dev_for(addr);
    if (!dev || !buf || len == 0) return false;
    return i2c_master_transmit_receive(dev, &reg, 1, buf, len, WW_I2C_TIMEOUT_MS) == ESP_OK;
}

bool ww_i2c_write_reg(uint8_t addr, uint8_t reg, uint8_t value) {
    i2c_master_dev_handle_t dev = dev_for(addr);
    if (!dev) return false;
    uint8_t w[2] = { reg, value };
    return i2c_master_transmit(dev, w, 2, WW_I2C_TIMEOUT_MS) == ESP_OK;
}

bool ww_i2c_read_u8(uint8_t addr, uint8_t reg, uint8_t *out) {
    return ww_i2c_read_reg(addr, reg, out, 1);
}
