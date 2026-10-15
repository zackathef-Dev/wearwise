import { SensorType, SAMPLE_SCALE } from '@wearwise/sensor-protocol';
import type { ColorToken } from '@wearwise/design-tokens';

/* How each signal is named and shown. Labels, units, decimals and data colours
 * mirror the phone app (apps/mobile/src/shared/signal-meta.ts: META for label/unit/
 * colour, signalName() for `short`, the name the participant saw when choosing what
 * to share), so both sides use the same words for the same thing. `csv` is the value
 * column header in exports.
 */

export interface SignalMeta {
  label: string;
  short: string;
  unit: string;
  token: ColorToken;
  digits: number;
  csv: string;
  /** one line for a reader who doesn't know the sensor */
  about: string;
}

export const SIGNALS: Record<number, SignalMeta> = {
  [SensorType.Ecg]: { label: 'Heart rhythm', short: 'ECG', unit: 'mV', token: 'wwDataEcg', digits: 2, csv: 'ecg_mV', about: 'Electrocardiogram waveform' },
  [SensorType.SpO2]: { label: 'Blood oxygen', short: 'SpO₂', unit: '%', token: 'wwDataSpo2', digits: 1, csv: 'spo2_percent', about: 'Oxygen saturation' },
  [SensorType.Temperature]: { label: 'Temperature', short: 'Skin temp', unit: '°C', token: 'wwDataTemp', digits: 2, csv: 'temperature_C', about: 'Skin temperature' },
  [SensorType.HeartRate]: { label: 'Heart rate', short: 'Heart rate', unit: 'BPM', token: 'wwDataHeart', digits: 0, csv: 'heart_rate_bpm', about: 'Beats per minute, derived on the device' },
  [SensorType.Accelerometer]: { label: 'Movement', short: 'Movement', unit: 'g', token: 'wwDataAccel', digits: 2, csv: 'acceleration_magnitude_g', about: 'Acceleration magnitude |a| (about 1 g at rest)' },
  [SensorType.Ppg]: { label: 'Pulse (PPG)', short: 'Pulse wave', unit: 'counts', token: 'wwDataHeart', digits: 0, csv: 'ppg_counts', about: 'Optical pulse waveform (AC-coupled IR)' },
};

/* A sensor code this build doesn't know yet still renders, labelled honestly. */
export const signalMeta = (type: number): SignalMeta =>
  SIGNALS[type] ?? {
    label: `Signal ${type}`, short: `Signal ${type}`, unit: SAMPLE_SCALE[type as SensorType]?.unit ?? '',
    token: 'wwDataGeneric', digits: 2, csv: `signal_${type}`, about: 'A signal this dashboard has no label for yet',
  };

/** Display order: the order the phone app lists them in. */
export const SIGNAL_ORDER: number[] = [
  SensorType.Ecg, SensorType.HeartRate, SensorType.SpO2, SensorType.Temperature, SensorType.Accelerometer, SensorType.Ppg,
];

export const bySignalOrder = (a: number, b: number): number => {
  const ia = SIGNAL_ORDER.indexOf(a);
  const ib = SIGNAL_ORDER.indexOf(b);
  return (ia < 0 ? 99 + a : ia) - (ib < 0 ? 99 + b : ib);
};
