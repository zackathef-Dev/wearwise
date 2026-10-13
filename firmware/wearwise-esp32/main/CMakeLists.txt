idf_component_register(
    SRCS
        "main.c"
        # core
        "core/SensorManager.c"
        "core/DeviceManager.c"
        "core/device_identity.c"
        "core/tls_identity.c"
        "core/factory_config.c"
        # sensors
        "sensors/i2c_bus.c"
        "sensors/MAX30102Sensor.c"
        "sensors/MAX30205Sensor.c"
        "sensors/MMA8452QSensor.c"
        "sensors/AD8232Sensor.c"
        "sensors/SimulatedSensor.c"
        "sensors/signals.c"
        # algorithms
        "algorithms/FallDetection.c"
        "algorithms/HRPipeline.c"
        "algorithms/RhythmCheck.c"
        # communication
        "communication/gatt.c"
        "communication/ble_pairing.c"
        "communication/protocol.c"
        "communication/wifi.c"
        "communication/ws_server.c"
    # Every module dir is an include dir, so existing #include "foo.h" keep resolving
    # regardless of which subdir a header now lives in.
    INCLUDE_DIRS "." "config" "core" "sensors" "algorithms" "communication" "utils"
    REQUIRES bt nvs_flash esp_partition esp_timer mbedtls esp_wifi esp_netif esp_event esp_http_server esp_https_server esp_adc driver bootloader_support
)
