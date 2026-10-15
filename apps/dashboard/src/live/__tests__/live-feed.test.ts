import { describe, expect, it } from 'vitest';
import { LiveFeed, SignalBuffer, STATUS_TIMEOUT_MS, parseFall, parseRecordAnswer, parseSamples, parseStatus } from '../live-feed';
import { formatClock } from '../../data/format';

const status = (o: Record<string, unknown> = {}) => ({ v: 1, state: 'live', endsAt: 2_000_000, device: 'WearWise-6F84', simulated: false, signals: [1, 4], ...o });
const samples = (sentAt: number, signals: Record<string, unknown>) => ({ v: 1, sentAt, signals });

describe('parseStatus / parseSamples', () => {
  it('accepts the contract’s messages', () => {
    expect(parseStatus(status())).toEqual({
      state: 'live', endsAt: 2_000_000, device: 'WearWise-6F84', simulated: false, signals: [1, 4], recording: false, startedByYou: false,
      link: null, firmware: null, sensors: null,
    });
    expect(parseStatus(status({ sensors: [2, 4, 'x', 99] }))!.sensors).toEqual([2, 4]);
    expect(parseStatus(status({ link: 'wifi', firmware: '0.9.6' }))).toMatchObject({ link: 'wifi', firmware: '0.9.6' });
    expect(parseStatus(status({ link: 'carrier pigeon', firmware: '<script>' }))).toMatchObject({ link: null, firmware: null });
    expect(parseStatus(status({ recording: true, startedByYou: true }))).toMatchObject({ recording: true, startedByYou: true });
    expect(parseStatus(status({ recording: false, startedByYou: true }))).toMatchObject({ startedByYou: false });
    expect(parseRecordAnswer({ v: 1, answer: 'started' })).toBe('started');
    expect(parseRecordAnswer({ v: 1, answer: 'delete everything' })).toBeNull();
    expect(parseRecordAnswer({ v: 2, answer: 'started' })).toBeNull();
    const b = parseSamples(samples(5, { 1: { rateHz: 250, t0: 0, values: [0.1, 0.2] }, 4: { rateHz: 1, t0: 0, values: [72] } }))!;
    expect([...b.signals.keys()]).toEqual([1, 4]);
  });

  it('drops anything malformed rather than trusting it', () => {
    expect(parseStatus({ ...status(), v: 2 })).toBeNull();
    expect(parseStatus({ ...status(), state: 'hacked' })).toBeNull();
    expect(parseStatus('live')).toBeNull();
    expect(parseStatus(status({ signals: [1, 'x', 99, 4.5, 2] }))!.signals).toEqual([1, 2]);
    expect(parseStatus(status({ device: 'x'.repeat(500) }))!.device).toHaveLength(64);
    const b = parseSamples(samples(5, {
      1: { rateHz: 250, t0: 0, values: [1, NaN] },          // non-finite value
      2: { rateHz: 0, t0: 0, values: [97] },                // impossible rate
      3: { rateHz: 1, t0: 0, values: new Array(5000).fill(1) }, // too many
      evil: { rateHz: 1, t0: 0, values: [1] },              // not a sensor code
      4: { rateHz: 1, t0: 0, values: [72] },
    }))!;
    expect([...b.signals.keys()]).toEqual([4]);
    expect(parseSamples({ v: 1, sentAt: 'now', signals: {} })).toBeNull();
  });
});

describe('SignalBuffer', () => {
  it('keeps a rolling window and never repeats an overlapping batch', () => {
    const buf = new SignalBuffer(1000);
    buf.push({ rateHz: 10, t0: 0, values: [0, 1, 2, 3, 4] });       // t = 0..400
    buf.push({ rateHz: 10, t0: 300, values: [3, 4, 5, 6] });        // overlaps 300, 400
    expect(buf.length).toBe(7);
    buf.push({ rateHz: 10, t0: 1500, values: [15] });               // window now 500..1500
    expect(buf.range(-Infinity, Infinity).t).toEqual([500, 600, 1500]);
    expect(buf.latest).toEqual({ t: 1500, v: 15 });
    expect(buf.range(550, 1000).v).toEqual([6]);
  });
});

describe('LiveFeed', () => {
  it('waits, goes live, and ends on stop, timeout or the end time', () => {
    const feed = new LiveFeed([1, 4]);
    expect(feed.phase(0)).toBe('waiting');
    feed.onStatus(status({ endsAt: 1_000_000 }), 1000);
    expect(feed.phase(2000)).toBe('live');
    expect(feed.phase(1000 + STATUS_TIMEOUT_MS + 1)).toBe('paused');     // heartbeat lost: app in the background
    feed.onStatus(status({ endsAt: 1_000_000 }), 999_000);
    expect(feed.phase(1_000_001)).toBe('ended');                          // time is up
    feed.onStatus(status({ state: 'stopped' }), 999_500);
    expect(feed.phase(999_600)).toBe('ended');
  });

  it('corrects for the phone’s clock and ignores signals the grant doesn’t include', () => {
    const feed = new LiveFeed([4]);
    feed.onSamples(samples(60_000, { 4: { rateHz: 1, t0: 59_000, values: [70, 71] }, 1: { rateHz: 250, t0: 0, values: [1] } }), 10_000);
    expect(feed.offset).toBe(50_000);                                     // phone is 50 s ahead
    expect(feed.phoneNow(10_500)).toBe(60_500);
    expect([...feed.buffers.keys()]).toEqual([4]);
    feed.onStatus(status({ endsAt: 70_000, signals: [1, 4] }), 10_000);
    expect(feed.status!.signals).toEqual([4]);
    expect(feed.endsAtLocal()).toBe(20_000);
  });
});

describe('hostile timestamps (security review)', () => {
  it('clamps an end time far in the future and rejects wild clock offsets and rates', () => {
    const feed = new LiveFeed([4]);
    feed.onStatus(status({ endsAt: 9e15 }), 1000);
    expect(Number.isFinite(new Date(feed.endsAtLocal()!).getTime())).toBe(true);
    expect(formatClock(feed.endsAtLocal()!)).not.toBe('—');
    expect(feed.onSamples(samples(-1e300, { 4: { rateHz: 1, t0: 0, values: [70] } }), 1000)).toBe(false);
    expect(parseSamples(samples(5, { 4: { rateHz: Number.MIN_VALUE, t0: 0, values: [70] } }))!.signals.size).toBe(0);
    expect(formatClock(9e15)).toBe('—');
  });
});

describe('falls, leads-off and stopping from the dashboard', () => {
  const fall = (o: Record<string, unknown> = {}) => ({ v: 1, at: 50_000, state: 'detected', impactG: 3.4, ...o });

  it('parses a fall step and drops malformed ones', () => {
    expect(parseFall(fall())).toEqual({ at: 50_000, state: 'detected', impactG: 3.4 });
    expect(parseFall(fall({ state: 'panic' }))).toBeNull();
    expect(parseFall(fall({ impactG: -1 }))).toBeNull();
    expect(parseFall(fall({ impactG: 1e9 }))).toBeNull();
    expect(parseFall(fall({ at: 'soon' }))).toBeNull();
    expect(parseFall({ ...fall(), v: 2 })).toBeNull();
  });

  it('reports each step of a fall once, ignores older falls, and only if falls are shared', () => {
    expect(new LiveFeed([1], 10_000, false).onFall(fall(), 50_000)).toBeNull();
    const feed = new LiveFeed([1], 10_000, true);
    expect(feed.onFall(fall(), 50_000)?.state).toBe('detected');
    expect(feed.onFall(fall(), 50_100)).toBeNull();                        // the same step again (a rejoin)
    expect(feed.onFall(fall({ state: 'raised' }), 60_000)?.state).toBe('raised');
    expect(feed.onFall(fall({ at: 40_000, state: 'detected' }), 60_000)).toBeNull();
    expect(feed.fall).toEqual({ at: 50_000, state: 'raised', impactG: 3.4 });
  });

  it('keeps the leads-off flag of each signal', () => {
    const feed = new LiveFeed([1]);
    feed.onSamples(samples(1_000, { 1: { rateHz: 250, t0: 900, values: [0], leadsOff: true } }), 1_000);
    expect(feed.leadsOff.get(1)).toBe(true);
    feed.onSamples(samples(1_500, { 1: { rateHz: 250, t0: 1_400, values: [0] } }), 1_500);
    expect(feed.leadsOff.get(1)).toBe(false);
  });

  it('after Stop, ignores the stopped session’s stragglers until a new session starts', () => {
    const feed = new LiveFeed([4]);
    feed.onStatus(status({ endsAt: 900_000 }), 1_000);
    feed.stopByViewer();
    expect(feed.phase(1_100)).toBe('ended');
    expect(feed.onStatus(status({ endsAt: 900_000 }), 1_200)).toBe(false);
    expect(feed.onSamples(samples(1_200, { 4: { rateHz: 1, t0: 1_200, values: [70] } }), 1_200)).toBe(false);
    expect(feed.phase(1_300)).toBe('ended');
    expect(feed.onStatus(status({ endsAt: 950_000 }), 2_000)).toBe(true);    // they switched it on again
    expect(feed.phase(2_100)).toBe('live');
  });
});
