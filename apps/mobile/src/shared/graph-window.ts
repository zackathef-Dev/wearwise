import { SensorType } from '@wearwise/sensor-protocol';
import { prefs } from '@/platform/kv/kv';

/* How much time a graph shows — the participant's choice, remembered per signal.
 *
 * Live graphs (Home → tap a reading): a few windows per signal, sized so the live
 * buffer in recording-engine.ts (RECENT_WINDOW_S) always holds the longest one.
 * Session graphs (History → a session): the whole recording, or zoomed to a window
 * that can be panned through it.
 */

export interface WindowOption { sec: number; label: string }

const opt = (sec: number): WindowOption => ({ sec, label: sec < 60 ? `${sec} s` : `${sec / 60} min` });

/* The first entry is not the default; DEFAULT_LIVE_SEC is (today's fixed windows). */
export const LIVE_WINDOWS: Partial<Record<SensorType, readonly WindowOption[]>> = {
  [SensorType.HeartRate]: [opt(30), opt(60), opt(300)],
  [SensorType.SpO2]: [opt(30), opt(60), opt(300)],
  [SensorType.Temperature]: [opt(60), opt(300), opt(900)],
  [SensorType.Accelerometer]: [opt(6), opt(15), opt(30)],
};

const DEFAULT_LIVE_SEC: Partial<Record<SensorType, number>> = {
  [SensorType.HeartRate]: 60,
  [SensorType.SpO2]: 30,
  [SensorType.Temperature]: 60,
  [SensorType.Accelerometer]: 6,
};

const key = (sensor: SensorType) => `graphWindow.${sensor}`;

/** The remembered live window for a signal, or its default if none / no longer offered. */
export function liveWindowFor(sensor: SensorType, fallbackSec = 6): number {
  const options = LIVE_WINDOWS[sensor];
  const fallback = DEFAULT_LIVE_SEC[sensor] ?? fallbackSec;
  if (!options) return fallback;
  const saved = Number(prefs.getString(key(sensor)));
  return options.some((o) => o.sec === saved) ? saved : fallback;
}

export function saveLiveWindow(sensor: SensorType, sec: number): void {
  if (LIVE_WINDOWS[sensor]?.some((o) => o.sec === sec)) prefs.set(key(sensor), String(sec));
}

/* ---- session zoom ---- */

export const ALL = 0; // "the whole session"

/** Zoom choices for a recording: All, then the windows shorter than it. */
export function sessionZoomOptions(durationSec: number): WindowOption[] {
  return [{ sec: ALL, label: 'All' }, ...[300, 60, 10].filter((s) => s < durationSec).map(opt)];
}

/** Keeps a window's start inside the recording. */
export function clampStart(startSec: number, windowSec: number, durationSec: number): number {
  if (windowSec === ALL || windowSec >= durationSec) return 0;
  return Math.min(Math.max(0, startSec), durationSec - windowSec);
}

/** Moves the window half its width earlier (-1) or later (+1). */
export function panStart(startSec: number, direction: -1 | 1, windowSec: number, durationSec: number): number {
  return clampStart(startSec + (direction * windowSec) / 2, windowSec, durationSec);
}
