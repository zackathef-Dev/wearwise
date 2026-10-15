import { SensorType } from '@wearwise/sensor-protocol';
import { signalMeta } from './signals';
import type { AlertItem } from './types';

/* How an alert is written: the same words as the phone app's Alerts list and
   notifications (apps/mobile/src/domain/vitals/alert-text.ts). */

const NAMES: Partial<Record<number, { high: string; low: string; unit: string; digits: number }>> = {
  [SensorType.HeartRate]: { high: 'High heart rate', low: 'Low heart rate', unit: ' BPM', digits: 0 },
  [SensorType.SpO2]: { high: 'High blood oxygen', low: 'Low blood oxygen', unit: ' %', digits: 0 },
  [SensorType.Temperature]: { high: 'High skin temperature', low: 'Low skin temperature', unit: ' °C', digits: 1 },
};

export function alertTitle(a: Pick<AlertItem, 'kind' | 'sensorType'>): string {
  if (a.kind === 'fall') return 'Fall detected';
  const n = a.sensorType != null ? NAMES[a.sensorType] : undefined;
  if (n) return n[a.kind];
  const label = a.sensorType != null ? signalMeta(a.sensorType).label.toLowerCase() : 'reading';
  return `${a.kind === 'high' ? 'High' : 'Low'} ${label}`;
}

export function alertValue(a: Pick<AlertItem, 'kind' | 'sensorType' | 'value'>): string {
  if (a.kind === 'fall') return `impact ${a.value.toFixed(1)} g`;
  const n = a.sensorType != null ? NAMES[a.sensorType] : undefined;
  const unit = n?.unit ?? (a.sensorType != null ? ` ${signalMeta(a.sensorType).unit}` : '');
  return `${a.kind === 'high' ? 'peak' : 'lowest'} ${a.value.toFixed(n?.digits ?? 1)}${unit}`;
}
