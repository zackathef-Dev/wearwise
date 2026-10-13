import { SensorType } from '@wearwise/sensor-protocol';
import type { LiveLink } from '@/domain/repositories/live-link';
import { LiveViewBroadcaster } from '../live-view-broadcaster';
import { RECORD_ASK_GAP_MS, STATUS_MS, type FallEvent, type LiveGrant } from '../live-view-core';

/* A channel that records what was sent, and can be told it is (not) joined. */
class FakeLink implements LiveLink {
  joined = true;
  closed = false;
  sent: { event: string; payload: any }[] = [];
  ready() { return this.joined && !this.closed; }
  constructor(readonly viewer: { stop(): void; record(): void; recordStop(): void }) {}
  stopFromViewer() { this.viewer.stop(); }
  async send(event: 'samples' | 'status' | 'fall', payload: object) { this.sent.push({ event, payload }); }
  async close() { this.closed = true; }
  events(name: string) { return this.sent.filter((s) => s.event === name).map((s) => s.payload); }
}

const ecgOnly: LiveGrant = { id: 'g-ecg', name: 'Dr Rivera', email: null, sensorTypes: [SensorType.Ecg], includeFalls: true };
const vitals: LiveGrant = {
  id: 'g-vitals', name: null, email: 'lab@example.org', sensorTypes: [SensorType.HeartRate, SensorType.SpO2], includeFalls: false,
};
const fall = (state: FallEvent['state']): FallEvent => ({ v: 1, at: 1_000_000, state, impactG: 3.4 });

function setup() {
  let now = 1_000_000;
  const links = new Map<string, FakeLink>();
  const stoppedBy: string[] = [];
  const asked: string[] = [];
  const stopAsked: string[] = [];
  const src = {
    recording: false, recordingBy: null as string | null, link: 'bluetooth' as const, firmware: '0.9.6' as string | null,
    sensors: [SensorType.Ecg, SensorType.HeartRate],
  };
  const b = new LiveViewBroadcaster({
    openLink: (id, viewer) => { const l = new FakeLink(viewer); links.set(id, l); return l; },
    onViewerStopped: (id) => stoppedBy.push(id),
    onRecordRequest: (g) => asked.push(g.id),
    onRecordStop: (g) => stopAsked.push(g.id),
    source: () => ({ device: 'WearWise-6F84', simulated: false, streamed: [SensorType.Ecg, SensorType.HeartRate], ...src }),
    now: () => now,
  }, now + 30 * 60_000);
  return { b, links, stoppedBy, asked, stopAsked, src, advance: (ms: number) => { now += ms; return now; }, at: () => now };
}

describe('LiveViewBroadcaster', () => {
  it('opens a channel per viewer, announces itself, then sends each only their signals', () => {
    const { b, links, at } = setup();
    b.setGrants([ecgOnly, vitals]);
    b.push(SensorType.Ecg, [0.1, 0.2], 250, at(), false);
    b.push(SensorType.HeartRate, [72], 1, at(), false);
    b.tick();

    const ecg = links.get('g-ecg')!;
    const vit = links.get('g-vitals')!;
    expect(ecg.sent.map((s) => s.event)).toEqual(['status', 'samples']);
    expect(ecg.events('status')[0]).toMatchObject({ v: 1, state: 'live', device: 'WearWise-6F84', signals: [1] });
    expect(Object.keys(ecg.events('samples')[0].signals)).toEqual(['1']);
    expect(vit.events('status')[0].signals).toEqual([4]);
    expect(Object.keys(vit.events('samples')[0].signals)).toEqual(['4']);
  });

  it('sends status every 5 s and samples only when there are new ones', () => {
    const { b, links, advance, at } = setup();
    b.setGrants([ecgOnly]);
    b.tick();                                  // status, no samples yet
    advance(500); b.tick();                    // nothing new
    const link = links.get('g-ecg')!;
    expect(link.sent.map((s) => s.event)).toEqual(['status']);
    advance(STATUS_MS); b.push(SensorType.Ecg, [0.3], 250, at(), false); b.tick();
    expect(link.sent.map((s) => s.event)).toEqual(['status', 'status', 'samples']);
  });

  it('waits for a channel to join, and re-announces after it rejoins', () => {
    const { b, links, advance, at } = setup();
    b.setGrants([ecgOnly]);
    const link = links.get('g-ecg')!;
    link.joined = false;
    b.push(SensorType.Ecg, [0.1], 250, at(), false);
    b.tick();
    expect(link.sent).toHaveLength(0);
    expect(b.reachable()).toBe(0);
    link.joined = true;
    advance(500); b.tick();
    expect(link.sent.map((s) => s.event)).toEqual(['status']);
    expect(b.reachable()).toBe(1);
  });

  it('drops a viewer whose access ended at once, and re-announces a changed signal list', () => {
    const { b, links, advance, at } = setup();
    b.setGrants([ecgOnly, vitals]);
    b.tick();
    b.setGrants([{ ...vitals, sensorTypes: [SensorType.HeartRate, SensorType.Ecg] }]);
    expect(links.get('g-ecg')!.closed).toBe(true);
    advance(500);
    b.push(SensorType.Ecg, [0.4], 250, at(), false);
    b.tick();
    expect(links.get('g-ecg')!.sent.map((s) => s.event)).toEqual(['status']);   // nothing after removal
    const vit = links.get('g-vitals')!;
    expect(vit.events('status')).toHaveLength(2);                              // fresh status for the new list
    expect(vit.events('status')[1].signals).toEqual([1, 4]);
    expect(Object.keys(vit.events('samples')[0].signals)).toEqual(['1']);
  });

  it('says stopped to everyone connected, leaves every channel, and then sends nothing', async () => {
    const { b, links, at } = setup();
    b.setGrants([ecgOnly, vitals]);
    links.get('g-vitals')!.joined = false;
    await b.stop();
    const ecg = links.get('g-ecg')!;
    expect(ecg.events('status')[0]).toMatchObject({ state: 'stopped' });
    expect(links.get('g-vitals')!.sent).toHaveLength(0);
    expect([...links.values()].every((l) => l.closed)).toBe(true);
    b.push(SensorType.Ecg, [0.1], 250, at(), false);
    b.tick();
    expect(ecg.sent).toHaveLength(1);
  });

  it('flags simulated readings from the packets themselves', () => {
    const { b, links, at } = setup();
    b.setGrants([ecgOnly]);
    b.push(SensorType.Ecg, [0.1], 250, at(), true);
    b.tick();
    expect(links.get('g-ecg')!.events('status')[0].simulated).toBe(true);
  });

  it('sends falls only to viewers whose share includes falls', () => {
    const { b, links } = setup();
    b.setGrants([ecgOnly, vitals]);
    b.tick();
    b.fall(fall('detected'));
    b.fall(fall('ok'));
    expect(links.get('g-ecg')!.events('fall').map((f) => f.state)).toEqual(['detected', 'ok']);
    expect(links.get('g-vitals')!.events('fall')).toHaveLength(0);
  });

  it('tells a viewer who (re)joins about a fall whose alarm is still on, but not one already answered', () => {
    const { b, links, advance } = setup();
    b.setGrants([ecgOnly]);
    const link = links.get('g-ecg')!;
    link.joined = false;
    b.fall(fall('raised'));
    link.joined = true;
    advance(500); b.tick();
    expect(link.sent.map((s) => s.event)).toEqual(['status', 'fall']);
    expect(link.events('fall')[0].state).toBe('raised');

    b.fall(fall('dismissed'));
    link.joined = false; advance(500); b.tick();
    link.joined = true; advance(500); b.tick();
    expect(link.events('fall').map((f) => f.state)).toEqual(['raised', 'dismissed']);   // no repeat
  });

  it('drops a viewer who stops watching, and does not take them back on the next grant check', () => {
    const { b, links, stoppedBy, at } = setup();
    b.setGrants([ecgOnly, vitals]);
    b.tick();
    links.get('g-ecg')!.stopFromViewer();
    expect(stoppedBy).toEqual(['g-ecg']);
    expect(links.get('g-ecg')!.closed).toBe(true);
    expect(b.viewing().map((g) => g.id)).toEqual(['g-vitals']);
    b.setGrants([ecgOnly, vitals]);
    expect(b.viewing().map((g) => g.id)).toEqual(['g-vitals']);
    b.push(SensorType.Ecg, [0.1], 250, at(), false);
    b.tick();
    expect(links.get('g-ecg')!.events('samples')).toHaveLength(0);
  });

  it('passes the leads-off flag through to the viewer', () => {
    const { b, links, at } = setup();
    b.setGrants([ecgOnly]);
    b.push(SensorType.Ecg, [0.1, 0.1], 250, at(), false, true);
    b.tick();
    expect(links.get('g-ecg')!.events('samples')[0].signals['1'].leadsOff).toBe(true);
  });

  it('passes a viewer’s recording request on, at most once per 10 s, and answers that viewer alone', () => {
    const { b, links, asked, advance } = setup();
    b.setGrants([ecgOnly, vitals]);
    b.tick();
    const ecg = links.get('g-ecg')!;
    ecg.viewer.record();
    ecg.viewer.record();                                       // a second press straight away
    expect(asked).toEqual(['g-ecg']);
    advance(RECORD_ASK_GAP_MS);
    ecg.viewer.record();
    expect(asked).toEqual(['g-ecg', 'g-ecg']);
    b.answerRecord('g-ecg', 'asked');
    expect(ecg.events('record')).toEqual([{ v: 1, answer: 'asked' }]);
    expect(links.get('g-vitals')!.events('record')).toHaveLength(0);
  });

  it('says in status who started a recording, re-announces when it changes, and forwards a stop', () => {
    const { b, links, src, stopAsked, advance } = setup();
    b.setGrants([ecgOnly, vitals]);
    b.tick();
    src.recording = true; src.recordingBy = 'g-ecg';
    b.announce();
    advance(500); b.tick();
    expect(links.get('g-ecg')!.events('status')[1]).toMatchObject({ recording: true, startedByYou: true });
    expect(links.get('g-vitals')!.events('status')[1]).toMatchObject({ recording: true, startedByYou: false });
    links.get('g-vitals')!.viewer.recordStop();
    links.get('g-ecg')!.viewer.recordStop();
    expect(stopAsked).toEqual(['g-vitals', 'g-ecg']);          // the store decides who may stop it
  });
});
