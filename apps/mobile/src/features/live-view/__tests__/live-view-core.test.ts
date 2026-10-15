import { SensorType } from '@wearwise/sensor-protocol';
import type { AccessGrant } from '@/data/remote/sharing';
import {
  SampleBatcher, samplesEvent, statusEvent, fallEvent, liveViewGrants, liveViewBlocker, liveViewMs, sensorGone, timeLeftLabel,
  MAX_VALUES_PER_SIGNAL, SENSOR_GONE_MS, SENSOR_LOST_MS,
} from '../live-view-core';

const grant = (over: Partial<AccessGrant> = {}): AccessGrant => ({
  id: 'A1B2C3D4-0000-4000-8000-000000000001', name: 'Dr Rivera', email: 'rivera@example.org', role: 'clinician',
  sensorTypes: [SensorType.Ecg, SensorType.HeartRate], includeFalls: true, accessActive: true, createdAt: '2026-10-01T00:00:00Z',
  ...over,
});

describe('SampleBatcher', () => {
  it('marks a batch whose latest packet says an electrode is off, and clears it when back on', () => {
    const b = new SampleBatcher();
    b.push(SensorType.Ecg, [0.1], 250, 1_000, false, true);
    expect(b.take()[SensorType.Ecg]!.leadsOff).toBe(true);
    b.push(SensorType.Ecg, [0.1], 250, 1_004, false, true);
    b.push(SensorType.Ecg, [0.2], 250, 1_008, false, false);
    expect(b.take()[SensorType.Ecg]!).not.toHaveProperty('leadsOff');
  });

  it('times a high-rate stream on its own clock, so packets join up without arrival jitter', () => {
    const b = new SampleBatcher();
    // 250 Hz, 50 samples per packet (200 ms); the second packet arrives 30 ms late.
    b.push(SensorType.Ecg, new Array(50).fill(0.1), 250, 10_196);
    b.push(SensorType.Ecg, new Array(50).fill(0.2), 250, 10_426);
    const batch = b.take()[SensorType.Ecg]!;
    expect(batch.rateHz).toBe(250);
    expect(batch.t0).toBe(10_000);                  // last sample at arrival → first at 10 000
    expect(batch.values).toHaveLength(100);

    b.push(SensorType.Ecg, new Array(50).fill(0.3), 250, 10_596);
    expect(b.take()[SensorType.Ecg]!.t0).toBe(10_400);   // continues where the last batch ended
  });

  it('re-anchors after a real gap instead of squeezing it out', () => {
    const b = new SampleBatcher();
    b.push(SensorType.Ecg, new Array(50).fill(0), 250, 10_196);
    b.take();
    b.push(SensorType.Ecg, new Array(50).fill(0), 250, 12_196);   // two seconds of nothing
    expect(b.take()[SensorType.Ecg]!.t0).toBe(12_000);
  });

  it('times each value of a gappy low-rate stream by its arrival', () => {
    const b = new SampleBatcher();
    b.push(SensorType.HeartRate, [72], 1, 5_000);
    b.take();
    b.push(SensorType.HeartRate, [74], 1, 9_000);                  // HR only reports when it has a value
    expect(b.take()[SensorType.HeartRate]).toEqual({ rateHz: 1, t0: 9_000, values: [74] });
  });

  it('rounds to the protocol resolution and leaves out silent signals', () => {
    const b = new SampleBatcher();
    b.push(SensorType.Ecg, [0.12300000000000001, -0.0049999], 250, 1_000);
    b.push(SensorType.Temperature, [36.570000000000004], 1, 1_000);
    const batch = b.take();
    expect(batch[SensorType.Ecg]!.values).toEqual([0.123, -0.005]);
    expect(batch[SensorType.Temperature]!.values).toEqual([36.57]);
    expect(batch[SensorType.SpO2]).toBeUndefined();
    expect(b.take()).toEqual({});                                   // emptied by take()
  });

  it('keeps a late batch bounded, dropping the oldest values and moving t0 with them', () => {
    const b = new SampleBatcher();
    const n = MAX_VALUES_PER_SIGNAL + 250;
    b.push(SensorType.Ecg, new Array(n).fill(1), 250, 100_000);
    const batch = b.take()[SensorType.Ecg]!;
    expect(batch.values).toHaveLength(MAX_VALUES_PER_SIGNAL);
    expect(batch.t0).toBe(100_000 - (n - 1) * 4 + 250 * 4);
    expect(JSON.stringify(samplesEvent({ [SensorType.Ecg]: batch }, [SensorType.Ecg], 0)).length).toBeLessThan(16_000);
  });

  it('knows what is streaming now and whether it is simulated', () => {
    const b = new SampleBatcher();
    b.push(SensorType.SpO2, [97], 1, 1_000);
    b.push(SensorType.Ecg, [0.1], 250, 20_000, true);
    expect(b.streamed(21_000)).toEqual([SensorType.Ecg]);
    expect(b.streamed(5_000)).toEqual([SensorType.Ecg, SensorType.SpO2]);
    expect(b.simulatedRecently(21_000)).toBe(true);
    expect(b.simulatedRecently(40_000)).toBe(false);
  });
});

describe('events', () => {
  const batch = {
    [SensorType.Ecg]: { rateHz: 250, t0: 1_000, values: [0.1, 0.2] },
    [SensorType.HeartRate]: { rateHz: 1, t0: 1_000, values: [72] },
    [SensorType.SpO2]: { rateHz: 1, t0: 1_000, values: [] },
  };

  it('gives each viewer only their own signals, keyed by sensor code', () => {
    expect(samplesEvent(batch, [SensorType.HeartRate, SensorType.Temperature], 1_500)).toEqual({
      v: 1, sentAt: 1_500, signals: { '4': { rateHz: 1, t0: 1_000, values: [72] } },
    });
    expect(samplesEvent(batch, [SensorType.SpO2], 1_500)).toBeNull();   // nothing new for them
    expect(samplesEvent(batch, [], 1_500)).toBeNull();
  });

  it('a fall carries its time, its step and the impact, to 0.1 g', () => {
    expect(fallEvent({ atIso: '2026-10-13T10:00:00.000Z', impactPeakG: 3.4567 }, 'detected'))
      .toEqual({ v: 1, at: Date.parse('2026-10-13T10:00:00.000Z'), state: 'detected', impactG: 3.5 });
    expect(fallEvent({ atIso: 'not a time', impactPeakG: 3 }, 'raised')).toBeNull();
  });

  it('status lists only the streamed signals this viewer may see, in code order', () => {
    expect(statusEvent({
      state: 'live', endsAt: 9_000, device: 'WearWise-6F84', simulated: false,
      streamed: [SensorType.HeartRate, SensorType.Ecg, SensorType.Ppg], allowed: [SensorType.Ecg, SensorType.HeartRate, SensorType.SpO2],
      recording: false, startedByYou: true, link: 'wifi', firmware: '0.9.6',
      sensors: [SensorType.Temperature, SensorType.HeartRate, SensorType.Ecg],
    })).toEqual({
      v: 1, state: 'live', endsAt: 9_000, device: 'WearWise-6F84', simulated: false, signals: [1, 4],
      recording: false, startedByYou: false, link: 'wifi', firmware: '0.9.6', sensors: [1, 4],
    });
  });
});

describe('who may watch, and when live view can run', () => {
  it('only active viewers with signals, with the grant id in lowercase for the channel name', () => {
    const out = liveViewGrants([
      grant(),
      grant({ id: 'b', accessActive: false }),
      grant({ id: 'c', sensorTypes: [] }),
    ]);
    expect(out).toEqual([{ id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Dr Rivera', email: 'rivera@example.org', sensorTypes: [1, 4], includeFalls: true }]);
  });

  it('runs for one of the offered lengths, 30 minutes unless another is chosen', () => {
    expect(liveViewMs(30)).toBe(30 * 60_000);
    expect(liveViewMs(480)).toBe(8 * 60 * 60_000);
    expect(liveViewMs(7 * 24 * 60)).toBe(30 * 60_000);   // a week isn't offered
    expect(liveViewMs(45)).toBe(30 * 60_000);
  });

  it('says why it cannot start', () => {
    expect(liveViewBlocker({ backend: false, viewers: 1, sensorConnected: true })).toBe('no-backend');
    expect(liveViewBlocker({ backend: true, viewers: 0, sensorConnected: true })).toBe('no-viewers');
    expect(liveViewBlocker({ backend: true, viewers: 2, sensorConnected: false })).toBe('no-sensor');
    expect(liveViewBlocker({ backend: true, viewers: 2, sensorConnected: true })).toBeNull();
  });

  it('treats the sensor as gone only after a while: soon if disconnected, later if still reconnecting', () => {
    expect(sensorGone('connected_ble', null, 1e9)).toBe(false);
    expect(sensorGone('disconnected', 0, SENSOR_GONE_MS - 1)).toBe(false);
    expect(sensorGone('disconnected', 0, SENSOR_GONE_MS)).toBe(true);
    expect(sensorGone('reconnecting', 0, SENSOR_GONE_MS)).toBe(false);
    expect(sensorGone('reconnecting', 0, SENSOR_LOST_MS)).toBe(true);
  });

  it('words the time left', () => {
    expect(timeLeftLabel(30 * 60_000, 0)).toBe('30 min left');
    expect(timeLeftLabel(8 * 60 * 60_000, 0)).toBe('8 h left');
    expect(timeLeftLabel(200 * 60_000, 0)).toBe('3 h 20 min left');
    expect(timeLeftLabel(60 * 60_000, 1)).toBe('1 h left');
    expect(timeLeftLabel(30 * 60_000, 1)).toBe('30 min left');
    expect(timeLeftLabel(90_000, 0)).toBe('2 min left');
    expect(timeLeftLabel(59_000, 0)).toBe('less than a minute left');
  });
});
