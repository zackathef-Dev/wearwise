import { SensorType } from '@wearwise/sensor-protocol';
import type { IconName } from '@/shared/icons/icon-data';

/* How each signal is shown: names, unit, colour token, chart range and window.
 * Shared by Home (live tiles and graphs) and the Live recording screen so the two
 * never disagree about a signal's axis or label.
 */

export type DataToken = 'wwDataEcg' | 'wwDataSpo2' | 'wwDataTemp' | 'wwDataHeart' | 'wwDataAccel';
/* `short` is the tab label (the full `label` sits under the hero numeral); `icon` is
   the per-signal glyph, tinted with the signal's own data colour on the tabs.
   `ticks` (optional) pins the chart to a FIXED, LABELLED value axis — for scalar
   readings that is more useful than autoscaling, because you can see where the value
   sits in its physiological range. Waveforms (ECG/PPG) have no ticks and autoscale,
   since their amplitude is hardware-dependent and only the shape matters. */
export const META: Record<number, { label: string; short: string; icon: IconName; unit: string; token: DataToken; range: [number, number]; digits: number; window: string; windowSec: number; ticks?: number[] }> = {
  [SensorType.Ecg]: { label: 'Heart rhythm', short: 'ECG', icon: 'activity', unit: 'mV', token: 'wwDataEcg', range: [-0.6, 1.4], digits: 2, window: 'last 6 s', windowSec: 6 },
  /* Full HR span: 0–198 BPM with 42-BPM gridlines, so a resting 90 and a running 170
     are both legible on the same axis without it rescaling under you. */
  [SensorType.HeartRate]: { label: 'Heart rate', short: 'Heart', icon: 'heart', unit: 'BPM', token: 'wwDataHeart', range: [0, 198], digits: 0, window: 'last 60 s', windowSec: 60, ticks: [72, 114, 156, 198] },
  [SensorType.SpO2]: { label: 'Blood oxygen', short: 'SpO₂', icon: 'droplet', unit: '%', token: 'wwDataSpo2', range: [70, 100], digits: 1, window: 'last 30 s', windowSec: 30, ticks: [80, 90, 95, 100] },
  /* Reaches down to room temperature on purpose: an unworn sensor reads ambient (~28 °C
     on a desk), and a clinical 34-40 axis would pin that off-scale and look broken. */
  [SensorType.Temperature]: { label: 'Temperature', short: 'Temp', icon: 'thermometer', unit: '°C', token: 'wwDataTemp', range: [20, 42], digits: 2, window: 'last 60 s', windowSec: 60, ticks: [25, 30, 35, 40] },
  [SensorType.Accelerometer]: { label: 'Movement', short: 'Move', icon: 'person-standing', unit: 'g', token: 'wwDataAccel', range: [0, 6], digits: 2, window: 'last 6 s', windowSec: 6, ticks: [1, 2, 4, 6] },
  [SensorType.Ppg]: { label: 'Pulse (PPG)', short: 'PPG', icon: 'activity', unit: 'counts', token: 'wwDataHeart', range: [-600, 600], digits: 0, window: 'last 6 s', windowSec: 6 },
};

/* Fallback for a sensor type not in META (a device could report one we don't have
   a label for yet) — keeps the screen from crashing on `.range`/`.label`. */
export const metaFor = (t: SensorType): (typeof META)[number] =>
  META[t] ?? { label: 'Signal', short: 'Signal', icon: 'signal', unit: '', token: 'wwDataEcg', range: [0, 4095], digits: 0, window: 'live', windowSec: 6 };

/* The short plain-language name used when the participant picks signals (what to
   record, what to share), so both pickers call a signal the same thing. */
const SIGNAL_NAME: Partial<Record<SensorType, string>> = {
  [SensorType.Ecg]: 'ECG', [SensorType.HeartRate]: 'Heart rate', [SensorType.SpO2]: 'SpO₂',
  [SensorType.Temperature]: 'Skin temp', [SensorType.Accelerometer]: 'Movement', [SensorType.Ppg]: 'Pulse wave',
};
export const signalName = (t: SensorType): string => SIGNAL_NAME[t] ?? metaFor(t).short;
