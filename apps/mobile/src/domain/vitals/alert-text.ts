import { SensorType } from '@wearwise/sensor-protocol';
import type { AlertRecord } from '@/domain/entities/session';

/* How an alert is written: the Alerts list and the notifications use the same words. */

const NAMES: Partial<Record<SensorType, { high: string; low: string; unit: string; digits: number }>> = {
  [SensorType.HeartRate]: { high: 'High heart rate', low: 'Low heart rate', unit: ' BPM', digits: 0 },
  [SensorType.SpO2]: { high: 'High blood oxygen', low: 'Low blood oxygen', unit: ' %', digits: 0 },
  [SensorType.Temperature]: { high: 'High skin temperature', low: 'Low skin temperature', unit: ' °C', digits: 1 },
};

export function alertTitle(a: Pick<AlertRecord, 'kind' | 'sensorType'>): string {
  if (a.kind === 'fall') return 'Fall detected';
  const n = a.sensorType != null ? NAMES[a.sensorType] : undefined;
  return n ? n[a.kind] : a.kind === 'high' ? 'High reading' : 'Low reading';
}

export function alertValue(a: Pick<AlertRecord, 'kind' | 'sensorType' | 'value'>): string {
  if (a.kind === 'fall') return `impact ${a.value.toFixed(1)} g`;
  const n = a.sensorType != null ? NAMES[a.sensorType] : undefined;
  return `${a.kind === 'high' ? 'peak' : 'lowest'} ${a.value.toFixed(n?.digits ?? 1)}${n?.unit ?? ''}`;
}
