#include "DeviceManager.h"

static ww_identity_t s_id;

const ww_identity_t *ww_device_init(void) {
    ww_identity_init(&s_id);
    return &s_id;
}
