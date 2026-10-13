import { SensorType } from './types.ts';

/* Reference ranges for the readings the patch reports — the one place they live, shared
 * by the phone app and the researcher dashboard so both say "Normal" about the same
 * numbers.
 *
 * These are TYPICAL ADULT RESTING ranges, used to say whether a reading is inside the
 * usual band. They are not a diagnosis: athletes rest below 60 BPM, exercise raises
 * heart rate, and the patch measures SKIN temperature, which runs a few degrees below
 * core temperature and follows the room. The screens say so next to every label.
 *
 *   Heart rate   60–100 BPM (resting adult; AHA)
 *   SpO₂         ≥ 95 % normal; below that is low (WHO pulse-oximetry guidance)
 *   Skin temp    31–37.5 °C: skin under a patch usually reads 32–36 °C. Below 31 °C
 *                almost always means the patch is not on the skin, so a LOW skin
 *                temperature is shown but never raised as an alert.
 */

export type VitalStatus = 'low' | 'normal' | 'high';

export interface VitalRange {
  low: number;
  /* Infinity = no upper limit (SpO₂). */
  high: number;
  /* How long a reading must stay out of range before it becomes an alert —
     a single noisy sample never does. */
  sustainMs: number;
  /* Out-of-range directions that raise an alert (display shows both regardless). */
  alertOn: readonly ('low' | 'high')[];
}

export const VITAL_RANGES: Partial<Record<SensorType, VitalRange>> = {
  [SensorType.HeartRate]: { low: 60, high: 100, sustainMs: 15_000, alertOn: ['low', 'high'] },
  [SensorType.SpO2]: { low: 95, high: Infinity, sustainMs: 15_000, alertOn: ['low'] },
  [SensorType.Temperature]: { low: 31, high: 37.5, sustainMs: 60_000, alertOn: ['high'] },
};

/* Status of one reading, or null for a sensor with no range (ECG, movement, PPG). */
export function classify(sensor: SensorType, value: number | null | undefined): VitalStatus | null {
  const r = VITAL_RANGES[sensor];
  if (!r || value == null || !Number.isFinite(value)) return null;
  if (value < r.low) return 'low';
  if (value > r.high) return 'high';
  return 'normal';
}

export const STATUS_LABEL: Record<VitalStatus, string> = { low: 'Below normal', normal: 'Normal', high: 'High' };

/* The range in words, e.g. "60–100 BPM" or "95 % and above". */
export function rangeText(sensor: SensorType, unit: string): string | null {
  const r = VITAL_RANGES[sensor];
  if (!r) return null;
  const u = unit === '%' ? ' %' : ` ${unit}`;
  return Number.isFinite(r.high) ? `${r.low}–${r.high}${u}` : `${r.low}${u} and above`;
}

/* Movement level from the accelerometer magnitude (g) over the last few seconds:
   how much it varies, not its value — gravity alone reads ~1 g at rest. */
export type Activity = 'still' | 'moving' | 'active';
export function activityLevel(magnitudes: readonly number[]): Activity | null {
  if (magnitudes.length < 10) return null;
  let sum = 0;
  for (const v of magnitudes) sum += v;
  const mean = sum / magnitudes.length;
  let sq = 0;
  for (const v of magnitudes) sq += (v - mean) * (v - mean);
  const sd = Math.sqrt(sq / magnitudes.length);
  return sd < 0.04 ? 'still' : sd < 0.25 ? 'moving' : 'active';
}
export const ACTIVITY_LABEL: Record<Activity, string> = { still: 'Still', moving: 'Moving', active: 'Active' };
