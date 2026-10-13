import { PROTOCOL_VERSION, SAMPLE_SCALE, type SensorType } from '@wearwise/sensor-protocol';
import type { SensorCapability } from '@/domain/repositories/sensor-transport';

export function validateInfo(bytes: Uint8Array): void {
  if (bytes.length < 22 || bytes.length > 128 || bytes[20] !== PROTOCOL_VERSION ||
      bytes.slice(0, 16).every((b) => b === 0) || bytes.indexOf(0, 21) === -1) {
    throw new Error('Unsupported WearWise device information.');
  }
}

/* An empty list is valid: a patch whose sensors are all missing or failed (firmware
   0.9.4 no longer claims an ECG it can't detect). The caller says so in plain words. */
export function parseCapabilities(bytes: Uint8Array): SensorCapability[] {
  if (bytes.length % 4 !== 0 || bytes.length > 24) {
    throw new Error('Invalid WearWise capabilities.');
  }
  const seen = new Set<number>();
  const caps: SensorCapability[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    const sensorType = bytes[i]! as SensorType;
    const sampleRateHz = bytes[i + 2]! | (bytes[i + 3]! << 8);
    if (!SAMPLE_SCALE[sensorType] || seen.has(sensorType) || bytes[i + 1]! > 1 ||
        sampleRateHz < 1 || sampleRateHz > 1000) throw new Error('Invalid WearWise capabilities.');
    seen.add(sensorType);
    caps.push({ sensorType, sampleRateHz, reporting: bytes[i + 1] === 1, unit: SAMPLE_SCALE[sensorType].unit });
  }
  return caps;
}
