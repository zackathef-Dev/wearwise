/* DeviceManager — owns the board's stable WearWise identity and (future) device status.
 * A thin facade over device_identity so the rest of the firmware has one place to get the
 * device id / BLE name, and a natural home for battery / status reporting later.
 */
#pragma once
#include "device_identity.h"

/* Initialise and return the process-wide identity (MAC-derived UUID + WearWise-XXXX name). */
const ww_identity_t *ww_device_init(void);
