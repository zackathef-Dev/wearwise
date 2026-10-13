/* WearWise logging — thin WW_DEBUG-gated wrappers over ESP_LOG.
 *
 * With WW_DEBUG=0 the info/debug macros compile to nothing (no strings in the binary,
 * no UART traffic competing with streaming). Warnings/errors always compile in.
 * Never log secrets (PoP tokens, Wi-Fi passwords) — §17.
 */
#pragma once
#include "esp_log.h"
#include "FirmwareConfig.h"

#if WW_DEBUG
#define WW_LOGI(tag, fmt, ...) ESP_LOGI(tag, fmt, ##__VA_ARGS__)
#define WW_LOGD(tag, fmt, ...) ESP_LOGD(tag, fmt, ##__VA_ARGS__)
#else
#define WW_LOGI(tag, fmt, ...) ((void)0)
#define WW_LOGD(tag, fmt, ...) ((void)0)
#endif
#define WW_LOGW(tag, fmt, ...) ESP_LOGW(tag, fmt, ##__VA_ARGS__)
#define WW_LOGE(tag, fmt, ...) ESP_LOGE(tag, fmt, ##__VA_ARGS__)
