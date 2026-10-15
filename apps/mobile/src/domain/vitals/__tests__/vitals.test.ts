import { SensorType } from '@wearwise/sensor-protocol';
import { classify, rangeText, activityLevel } from '../ranges';
import { AlertMonitor, CLEAR_MS, QUIET_MS, type AlertSink } from '../alert-monitor';

describe('ranges', () => {
  test.each([
    [SensorType.HeartRate, 55, 'low'], [SensorType.HeartRate, 72, 'normal'], [SensorType.HeartRate, 100, 'normal'], [SensorType.HeartRate, 101, 'high'],
    [SensorType.SpO2, 94, 'low'], [SensorType.SpO2, 95, 'normal'], [SensorType.SpO2, 100, 'normal'],
    [SensorType.Temperature, 28, 'low'], [SensorType.Temperature, 34.2, 'normal'], [SensorType.Temperature, 38, 'high'],
  ])('sensor %i value %d → %s', (s, v, want) => expect(classify(s, v)).toBe(want));

  test('signals without a range are not classified', () => {
    expect(classify(SensorType.Ecg, 0.4)).toBeNull();
    expect(classify(SensorType.HeartRate, null)).toBeNull();
    expect(classify(SensorType.HeartRate, NaN)).toBeNull();
  });

  test('range text', () => {
    expect(rangeText(SensorType.HeartRate, 'BPM')).toBe('60–100 BPM');
    expect(rangeText(SensorType.SpO2, '%')).toBe('95 % and above');
  });

  test('activity from accelerometer variation', () => {
    expect(activityLevel(Array(50).fill(1))).toBe('still');
    expect(activityLevel(Array.from({ length: 50 }, (_, i) => 1 + (i % 2 ? 0.15 : -0.15)))).toBe('moving');
    expect(activityLevel(Array.from({ length: 50 }, (_, i) => 1 + (i % 2 ? 1 : -0.8)))).toBe('active');
    expect(activityLevel([1, 1])).toBeNull();
  });
});

function harness() {
  const events: string[] = [];
  const sink: AlertSink = {
    open: (a) => events.push(`open ${a.kind} ${a.value} @${a.startedAtMs}`),
    update: (id, p) => events.push(`update ${id}${p.value !== undefined ? ` value=${p.value}` : ''}${p.endedAtMs !== undefined ? ` end=${p.endedAtMs}` : ''}`),
  };
  let n = 0;
  return { events, m: new AlertMonitor(sink, () => `a${++n}`) };
}
const feed = (m: AlertMonitor, s: SensorType, from: number, to: number, value: (t: number) => number, step = 1000) => {
  for (let t = from; t <= to; t += step) m.push(s, value(t), t);
};

describe('alert monitor', () => {
  test('a brief spike is not an alert', () => {
    const { m, events } = harness();
    feed(m, SensorType.HeartRate, 0, 10_000, () => 130);
    feed(m, SensorType.HeartRate, 11_000, 30_000, () => 80);
    expect(events).toEqual([]);
  });

  test('a sustained excursion is ONE alert with its peak, closed after recovery', () => {
    const { m, events } = harness();
    feed(m, SensorType.HeartRate, 0, 20_000, (t) => (t === 18_000 ? 140 : 120));
    feed(m, SensorType.HeartRate, 21_000, 40_000, (t) => (t === 25_000 ? 150 : 115));
    feed(m, SensorType.HeartRate, 41_000, 41_000 + CLEAR_MS, () => 80);
    expect(events).toEqual([
      'open high 120 @0',             // opened at 15 s, dated from when it began
      'update a1 value=140',
      'update a1 value=150',
      'update a1 end=41000',
    ]);
  });

  test('low SpO₂ alerts; a low skin temperature (patch off) does not', () => {
    const { m, events } = harness();
    feed(m, SensorType.SpO2, 0, 20_000, () => 91);
    feed(m, SensorType.Temperature, 0, 120_000, () => 27, 5000);
    expect(events).toEqual(['open low 91 @0']);
  });

  test('high temperature needs a full minute', () => {
    const { m, events } = harness();
    feed(m, SensorType.Temperature, 0, 55_000, () => 38.2, 5000);
    expect(events).toEqual([]);
    feed(m, SensorType.Temperature, 60_000, 60_000, () => 38.2);
    expect(events).toEqual(['open high 38.2 @0']);
  });

  test('a sensor going quiet closes its alert at the last reading', () => {
    const { m, events } = harness();
    feed(m, SensorType.HeartRate, 0, 16_000, () => 45);
    m.tick(16_000 + QUIET_MS - 1);
    expect(events).toEqual(['open low 45 @0']);
    m.tick(16_000 + QUIET_MS);
    expect(events).toEqual(['open low 45 @0', 'update a1 end=16000']);
  });

  test('flapping at the boundary does not reopen alerts', () => {
    const { m, events } = harness();
    feed(m, SensorType.HeartRate, 0, 16_000, () => 105);
    feed(m, SensorType.HeartRate, 17_000, 40_000, (t) => ((t / 1000) % 4 === 0 ? 99 : 104));
    expect(events).toEqual(['open high 105 @0']);
  });
});
