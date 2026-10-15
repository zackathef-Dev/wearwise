import { SensorType } from '@wearwise/sensor-protocol';

import {
  ALL, LIVE_WINDOWS, clampStart, liveWindowFor, panStart, saveLiveWindow, sessionZoomOptions,
} from '../graph-window';

/* MMKV is native; an in-memory map stands in for the preference store (jest hoists this). */
jest.mock('@/platform/kv/kv', () => {
  const mem = new Map<string, string>();
  return { prefs: { getString: (k: string) => mem.get(k), set: (k: string, v: string) => { mem.set(k, v); }, delete: (k: string) => { mem.delete(k); } } };
});


describe('live graph windows', () => {
  it('defaults to today’s fixed windows', () => {
    expect(liveWindowFor(SensorType.HeartRate)).toBe(60);
    expect(liveWindowFor(SensorType.SpO2)).toBe(30);
    expect(liveWindowFor(SensorType.Accelerometer)).toBe(6);
  });
  it('remembers a choice per signal and ignores windows not offered', () => {
    saveLiveWindow(SensorType.HeartRate, 300);
    expect(liveWindowFor(SensorType.HeartRate)).toBe(300);
    expect(liveWindowFor(SensorType.SpO2)).toBe(30);
    saveLiveWindow(SensorType.HeartRate, 7);
    expect(liveWindowFor(SensorType.HeartRate)).toBe(300);
  });
  it('labels windows in seconds or minutes', () => {
    expect(LIVE_WINDOWS[SensorType.Temperature]?.map((o) => o.label)).toEqual(['1 min', '5 min', '15 min']);
  });
});

describe('session zoom', () => {
  it('offers only windows shorter than the recording', () => {
    expect(sessionZoomOptions(120).map((o) => o.label)).toEqual(['All', '1 min', '10 s']);
    expect(sessionZoomOptions(8).map((o) => o.label)).toEqual(['All']);
  });
  it('keeps the window inside the recording when panning', () => {
    expect(panStart(0, -1, 60, 600)).toBe(0);
    expect(panStart(0, 1, 60, 600)).toBe(30);
    expect(panStart(560, 1, 60, 600)).toBe(540);
    expect(clampStart(999, ALL, 600)).toBe(0);
  });
});
