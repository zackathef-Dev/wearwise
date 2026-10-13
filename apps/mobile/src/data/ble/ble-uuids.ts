/* The GATT contract, app side. Single source: docs/firmware/ble-gatt.md and the
 * firmware's gatt.c. If these strings drift from the firmware, discovery fails
 * loudly (service not found) rather than silently. */

export const WW_SERVICE_UUID = '57570000-5757-4b57-8000-574541525753';
export const WW_CHAR_INFO = '57570001-5757-4b57-8000-574541525753';
export const WW_CHAR_CAPS = '57570002-5757-4b57-8000-574541525753';
export const WW_CHAR_CONTROL = '57570003-5757-4b57-8000-574541525753';
export const WW_CHAR_DATA = '57570004-5757-4b57-8000-574541525753';
export const WW_CHAR_WIFI = '57570005-5757-4b57-8000-574541525753';
/* SHA-256 of the sensor's TLS certificate (32 bytes; firmware ≥ 0.8.0). The app pins
   it for the wss:// Wi-Fi stream. Absent on older firmware. */
export const WW_CHAR_TLS = '57570006-5757-4b57-8000-574541525753';

/* Control opcodes (docs/firmware/ble-gatt.md). */
export const CONTROL_START = 0x01;
export const CONTROL_STOP = 0x02;
export const CONTROL_PROVISION = 0x10;
