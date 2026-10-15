import { crc32, SensorType } from '@wearwise/sensor-protocol';
import { SyncEngine } from '../sync-engine';
import { MemorySessionStore } from '@/data/local/memory-session-store';
import { unpackChannelChunks } from '@/data/sync/chunk-container';
import type { SyncGateway, RemoteVitalAlert } from '@/domain/repositories/sync-gateway';
import type { Session, SessionChannel, FallEventRecord, AlertRecord } from '@/domain/entities/session';

/* A recording fake gateway. Records every upsert/upload; can be told to fail a
   given number of times, or fail a specific channel path, to drive resume tests. */
class FakeGateway implements SyncGateway {
  sessions = new Map<string, Session>();
  channels = new Map<string, { channel: SessionChannel; path: string }>();
  payloads = new Map<string, Uint8Array>();
  configured = true;
  failPayloadOnce: string | null = null;
  sessionCalls = 0;

  isConfigured() { return this.configured; }
  async putSession(session: Session) { this.sessionCalls++; this.sessions.set(session.id, session); }
  async putChannelPayload(path: string, bytes: Uint8Array) {
    if (this.failPayloadOnce === path) { this.failPayloadOnce = null; throw new Error('network down'); }
    this.payloads.set(path, new Uint8Array(bytes));
  }
  async putChannel(channel: SessionChannel, path: string) { this.channels.set(channel.id, { channel, path }); }

  falls = new Map<string, FallEventRecord>();
  fallTableExists = true;
  async deleteSession(_userId: string, sessionId: string) {
    this.sessions.delete(sessionId);
    for (const [id, c] of this.channels) if (c.channel.sessionId === sessionId) { this.channels.delete(id); this.payloads.delete(c.path); }
  }
  async putFallEvents(_userId: string, events: FallEventRecord[]) {
    if (!this.fallTableExists) return 'unavailable' as const;
    for (const e of events) this.falls.set(e.id, e);
    return 'ok' as const;
  }
  async listRemoteSessions() { return [...this.sessions.values()]; }
  async listRemoteChannels(sessionId: string) {
    return [...this.channels.values()].filter((c) => c.channel.sessionId === sessionId).map((c) => ({ channel: c.channel, storagePath: c.path }));
  }
  async getChannelPayload(path: string) {
    const p = this.payloads.get(path);
    if (!p) throw new Error('missing object');
    return p;
  }
  async listRemoteFallEvents(sessionId: string) { return [...this.falls.values()].filter((f) => f.sessionId === sessionId); }

  /* vital_alerts as the server keeps it: one request is all-or-nothing, and like the
     RLS insert policy it refuses a row linked to a session it doesn't have. */
  vitalAlerts = new Map<string, { value: number; endedAt: string | null; sessionId: string | null }>();
  alertTableExists = true;
  alertsOffline = false;
  alertsRefuseAll = false;
  alertRequests = 0;
  async putVitalAlerts(_userId: string, rows: RemoteVitalAlert[]) {
    this.alertRequests++;
    if (this.alertsOffline) throw new Error('network down');
    if (!this.alertTableExists) return 'unavailable' as const;
    if (this.alertsRefuseAll || rows.some((r) => r.sessionId != null && !this.sessions.has(r.sessionId))) return 'refused' as const;
    for (const r of rows) this.vitalAlerts.set(r.alert.id, { value: r.alert.value, endedAt: r.alert.endedAt, sessionId: r.sessionId });
    return 'ok' as const;
  }
}

let counter = 0;
const clock = () => `2026-08-26T00:00:${String(counter++).padStart(2, '0')}Z`;

async function seedSession(store: MemorySessionStore, id: string, status: 'complete' | 'interrupted' | 'recording') {
  await store.createSession({
    id, userId: 'u1', deviceId: 'dev', startedAt: `2026-08-26T00:00:00Z`, simulated: true,
    initialTransport: 'bluetooth',
    configurationSnapshot: { deviceName: 'Patch', firmwareVersion: '0.5.0', protocolVersion: 1, channels: [] },
  });
  const chId = `${id}-ecg`;
  await store.createChannel({ id: chId, sessionId: id, sensorType: SensorType.Ecg, canonicalUnit: 'mV', sampleRateHz: 70 });
  const payload = new Uint8Array([1, 0, 2, 0, 3, 0]);
  await store.appendChunk({
    id: `${id}-k0`, sessionId: id, channelId: chId, chunkNumber: 0, firstSequence: 0, lastSequence: 0,
    startedAtUs: 0n, endedAtUs: 1000n, sampleCount: 3, encoding: 'int16le-v1', payload, checksum: crc32(payload),
  });
  if (status !== 'recording') {
    await store.closeSession(id, { endedAt: '2026-08-26T00:01:00Z', durationMs: 60000, status, finalTransport: 'bluetooth', transportSwitchCount: 0 });
  }
  return chId;
}

beforeEach(() => { counter = 0; });

describe('SyncEngine', () => {
  test('uploads a finished session: row, channel row, and CRC-clean payload', async () => {
    const store = new MemorySessionStore();
    const chId = await seedSession(store, 'sess-1', 'complete');
    const gw = new FakeGateway();
    const engine = new SyncEngine(store, gw, 'u1', clock);

    const out = await engine.syncOnce();
    expect(out).toMatchObject({ configured: true, attempted: 1, synced: 1, failed: 0 });
    expect(gw.sessions.has('sess-1')).toBe(true);
    const path = `u1/sess-1/${chId}.wwch`;
    expect(gw.channels.get(chId)?.path).toBe(path);
    const back = unpackChannelChunks(gw.payloads.get(path)!); // throws if CRC broke
    expect(back).toHaveLength(1);
    expect(Array.from(back[0]!.payload)).toEqual([1, 0, 2, 0, 3, 0]);
    expect((await store.getSyncState('sess-1'))?.status).toBe('synced');
  });

  test('never uploads a session that is still recording', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'live', 'recording');
    const gw = new FakeGateway();
    const out = await new SyncEngine(store, gw, 'u1', clock).syncOnce();
    expect(out.attempted).toBe(0);
    expect(gw.sessions.size).toBe(0);
  });

  test('is idempotent: a second run uploads nothing new', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-1', 'complete');
    const gw = new FakeGateway();
    const engine = new SyncEngine(store, gw, 'u1', clock);
    await engine.syncOnce();
    const before = gw.sessionCalls;
    const out = await engine.syncOnce();
    expect(out.attempted).toBe(0);          // already synced → not in the work list
    expect(gw.sessionCalls).toBe(before);   // no extra remote writes
  });

  test('resumes after a payload failure without re-uploading the session or duplicating', async () => {
    const store = new MemorySessionStore();
    const chId = await seedSession(store, 'sess-1', 'complete');
    const gw = new FakeGateway();
    const path = `u1/sess-1/${chId}.wwch`;
    gw.failPayloadOnce = path;
    const engine = new SyncEngine(store, gw, 'u1', clock);

    const first = await engine.syncOnce();
    expect(first.failed).toBe(1);
    expect((await store.getSyncState('sess-1'))?.status).toBe('failed');
    expect(gw.payloads.has(path)).toBe(false);

    const second = await engine.syncOnce();          // retry
    expect(second.synced).toBe(1);
    expect(gw.payloads.has(path)).toBe(true);
    expect(gw.channels.get(chId)?.path).toBe(path);
    expect((await store.getSyncState('sess-1'))?.status).toBe('synced');
  });

  test('when the backend is not configured, nothing is attempted (offline-first)', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-1', 'complete');
    const gw = new FakeGateway(); gw.configured = false;
    const out = await new SyncEngine(store, gw, 'u1', clock).syncOnce();
    expect(out).toMatchObject({ configured: false, attempted: 0, synced: 0 });
    expect((await store.getSyncState('sess-1'))).toBeNull();
  });

  test('one failing session does not block the others', async () => {
    const store = new MemorySessionStore();
    const chA = await seedSession(store, 'sess-a', 'complete');
    await seedSession(store, 'sess-b', 'complete');
    const gw = new FakeGateway();
    gw.failPayloadOnce = `u1/sess-a/${chA}.wwch`;
    const out = await new SyncEngine(store, gw, 'u1', clock).syncOnce();
    expect(out.attempted).toBe(2);
    expect(out.synced).toBe(1);
    expect(out.failed).toBe(1);
    expect(gw.sessions.has('sess-b')).toBe(true);
  });

  test('counts pending sync correctly', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-1', 'complete');
    await seedSession(store, 'sess-2', 'interrupted');
    expect(await store.countPendingSync('u1')).toBe(2);
    await new SyncEngine(store, new FakeGateway(), 'u1', clock).syncOnce();
    expect(await store.countPendingSync('u1')).toBe(0);
  });

  test('uploads the falls of a session with it', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-f', 'complete');
    await store.insertFallEvent({ id: 'fall-1', sessionId: 'sess-f', detectedAtMs: 4200, freefallMinG: 0.1, impactPeakG: 3.2, status: 'emergency', createdAt: '2026-08-26T00:00:05Z' });
    const gw = new FakeGateway();
    await new SyncEngine(store, gw, 'u1', clock).syncOnce();
    expect(gw.falls.get('fall-1')).toMatchObject({ sessionId: 'sess-f', status: 'emergency', impactPeakG: 3.2 });
  });

  test('still syncs the session when the backend has no fall table, and backfills later', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-g', 'complete');
    await store.insertFallEvent({ id: 'fall-2', sessionId: 'sess-g', detectedAtMs: 10, freefallMinG: 0.2, impactPeakG: 2.9, status: 'cancelled', createdAt: '2026-08-26T00:00:06Z' });
    const gw = new FakeGateway();
    gw.fallTableExists = false;
    const engine = new SyncEngine(store, gw, 'u1', clock);
    expect(await engine.syncOnce()).toMatchObject({ synced: 1, failed: 0 });
    expect(gw.falls.size).toBe(0);
    gw.fallTableExists = true;          // migration applied
    await engine.syncOnce();            // nothing pending — backfill uploads the fall
    expect(gw.falls.has('fall-2')).toBe(true);
  });

  test('restores a cloud session onto an empty phone, verified and never re-queued', async () => {
    const source = new MemorySessionStore();
    await seedSession(source, 'sess-r', 'complete');
    await source.insertFallEvent({ id: 'fall-r', sessionId: 'sess-r', detectedAtMs: 77, freefallMinG: 0.1, impactPeakG: 3, status: 'emergency', createdAt: '2026-08-26T00:00:07Z' });
    const gw = new FakeGateway();
    await new SyncEngine(source, gw, 'u1', clock).syncOnce();

    const fresh = new MemorySessionStore();           // reinstall: nothing local
    const engine = new SyncEngine(fresh, gw, 'u1', clock);
    expect(await engine.restoreOnce()).toMatchObject({ restored: 1, failed: 0 });

    const row = await fresh.getSession('sess-r');
    expect(row?.session.status).toBe('complete');
    expect(row?.channels).toHaveLength(1);
    const chunks = await fresh.listChunks('sess-r', row!.channels[0]!.id);
    expect(Array.from(chunks[0]!.payload)).toEqual([1, 0, 2, 0, 3, 0]);
    expect(await fresh.listFallEvents('sess-r')).toHaveLength(1);
    expect((await fresh.getSyncState('sess-r'))?.status).toBe('synced');
    expect(await fresh.countPendingSync('u1')).toBe(0);
    expect(await engine.restoreOnce()).toMatchObject({ restored: 0, failed: 0 });   // idempotent
  });

  test('a corrupted download restores nothing for that session', async () => {
    const source = new MemorySessionStore();
    await seedSession(source, 'sess-c', 'complete');
    const gw = new FakeGateway();
    await new SyncEngine(source, gw, 'u1', clock).syncOnce();
    for (const [path, bytes] of gw.payloads) { const bad = new Uint8Array(bytes); bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 0xff; gw.payloads.set(path, bad); }

    const fresh = new MemorySessionStore();
    const out = await new SyncEngine(fresh, gw, 'u1', clock).restoreOnce();
    expect(out).toMatchObject({ restored: 0, failed: 1 });
    expect(out.errors?.[0]).toMatch(/CRC mismatch/);
    expect(await fresh.getSession('sess-c')).toBeNull();
  });
});

describe('SyncEngine — vital alerts', () => {
  let n = 0;
  const alert = (over: Partial<AlertRecord> = {}): AlertRecord => ({
    id: `alert-${++n}`, userId: 'u1', sessionId: null, deviceId: 'dev', sensorType: SensorType.HeartRate,
    kind: 'high', value: 120, startedAt: `2026-08-26T00:10:${String(n).padStart(2, '0')}Z`, endedAt: null, seen: false, ...over,
  });

  test('uploads an alert from live preview once, then again only when it changes', async () => {
    const store = new MemorySessionStore();
    const a = alert();
    await store.insertAlert(a);
    const gw = new FakeGateway();
    const engine = new SyncEngine(store, gw, 'u1', clock);

    expect(await engine.syncAlerts()).toMatchObject({ status: 'ok', uploaded: 1, pending: 0 });
    expect(gw.vitalAlerts.get(a.id)).toEqual({ value: 120, endedAt: null, sessionId: null });

    const requests = gw.alertRequests;
    expect(await engine.syncAlerts()).toMatchObject({ uploaded: 0 });
    expect(gw.alertRequests).toBe(requests);          // nothing new → no request at all

    await store.updateAlert(a.id, { value: 131 });
    await store.updateAlert(a.id, { endedAt: '2026-08-26T00:12:00Z' });
    expect(await engine.syncAlerts()).toMatchObject({ uploaded: 1 });
    expect(gw.vitalAlerts.get(a.id)).toEqual({ value: 131, endedAt: '2026-08-26T00:12:00Z', sessionId: null });
  });

  test('a slow upload never marks a newer change as sent', async () => {
    const store = new MemorySessionStore();
    const a = alert();
    await store.insertAlert(a);
    await store.updateAlert(a.id, { value: 140 });                         // revision 2
    await store.markAlertsCloudSynced([{ id: a.id, revision: 2, linkSettled: true }]);
    await store.markAlertsCloudSynced([{ id: a.id, revision: 1, linkSettled: true }]); // late, older
    expect(await store.listAlertsPendingCloud('u1')).toHaveLength(0);
    await store.updateAlert(a.id, { value: 150 });                         // revision 3
    expect(await store.listAlertsPendingCloud('u1')).toHaveLength(1);
  });

  test('falls are never sent as vital alerts', async () => {
    const store = new MemorySessionStore();
    await store.insertAlert(alert({ kind: 'fall', sensorType: null, value: 3.1 }));
    const gw = new FakeGateway();
    expect(await new SyncEngine(store, gw, 'u1', clock).syncAlerts()).toMatchObject({ uploaded: 0, pending: 0 });
    expect(gw.alertRequests).toBe(0);
  });

  test('an alert from a recording goes up at once, and gains its session link once the session is uploaded', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-a', 'recording');
    const a = alert({ sessionId: 'sess-a' });
    await store.insertAlert(a);
    const gw = new FakeGateway();
    const engine = new SyncEngine(store, gw, 'u1', clock);

    await engine.syncAlerts();                                              // mid-recording
    expect(gw.vitalAlerts.get(a.id)?.sessionId).toBeNull();

    await store.closeSession('sess-a', { endedAt: '2026-08-26T00:20:00Z', durationMs: 60000, status: 'complete', finalTransport: 'bluetooth', transportSwitchCount: 0 });
    const out = await engine.syncOnce();                                    // session first, then its alerts
    expect(out).toMatchObject({ synced: 1, alerts: { status: 'ok', uploaded: 1 } });
    expect(gw.vitalAlerts.get(a.id)?.sessionId).toBe('sess-a');

    expect((await engine.syncOnce()).alerts).toMatchObject({ uploaded: 0, pending: 0 });
  });

  test('a session and its alert in one run: the alert is linked straight away', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-b', 'complete');
    const a = alert({ sessionId: 'sess-b', kind: 'low', sensorType: SensorType.SpO2, value: 88 });
    await store.insertAlert(a);
    const gw = new FakeGateway();
    await new SyncEngine(store, gw, 'u1', clock).syncOnce();
    expect(gw.vitalAlerts.get(a.id)).toMatchObject({ sessionId: 'sess-b', value: 88 });
  });

  test('without a vital_alerts table the session still syncs, and the alerts follow later', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-c', 'complete');
    await store.insertAlert(alert({ sessionId: 'sess-c' }));
    const gw = new FakeGateway();
    gw.alertTableExists = false;
    const engine = new SyncEngine(store, gw, 'u1', clock);
    expect(await engine.syncOnce()).toMatchObject({ synced: 1, failed: 0, alerts: { status: 'unavailable', uploaded: 0 } });
    gw.alertTableExists = true;                                             // migration applied
    expect((await engine.syncOnce()).alerts).toMatchObject({ status: 'ok', uploaded: 1 });
    expect(gw.vitalAlerts.size).toBe(1);
  });

  test('offline: reported as failed with what is still to upload, then retried', async () => {
    const store = new MemorySessionStore();
    await store.insertAlert(alert());
    await store.insertAlert(alert());
    const gw = new FakeGateway();
    gw.alertsOffline = true;
    const engine = new SyncEngine(store, gw, 'u1', clock);
    expect(await engine.syncAlerts()).toMatchObject({ status: 'failed', uploaded: 0, pending: 2 });
    gw.alertsOffline = false;
    expect(await engine.syncAlerts()).toMatchObject({ status: 'ok', uploaded: 2, pending: 0 });
  });

  test('an alert linked to a session the server lacks is left for later; the rest still go up', async () => {
    const store = new MemorySessionStore();
    await seedSession(store, 'sess-d', 'complete');
    const gw = new FakeGateway();
    const engine = new SyncEngine(store, gw, 'u1', clock);
    await engine.syncOnce();
    gw.sessions.delete('sess-d');                                           // gone from the cloud
    const linked = alert({ sessionId: 'sess-d' });
    const free = alert();
    await store.insertAlert(linked);
    await store.insertAlert(free);

    expect(await engine.syncAlerts()).toMatchObject({ status: 'ok', uploaded: 1, deferred: 1, pending: 0 });
    expect(gw.vitalAlerts.has(free.id)).toBe(true);
    expect(gw.vitalAlerts.has(linked.id)).toBe(false);
    expect(await store.listAlertsPendingCloud('u1')).toEqual([expect.objectContaining({ alert: expect.objectContaining({ id: linked.id }) })]);
  });

  test('an account the server refuses outright fails the run without trying alerts one by one', async () => {
    const store = new MemorySessionStore();
    await store.insertAlert(alert());
    await store.insertAlert(alert());
    const gw = new FakeGateway();
    gw.alertsRefuseAll = true;
    expect(await new SyncEngine(store, gw, 'u1', clock).syncAlerts()).toMatchObject({ status: 'failed', uploaded: 0, pending: 2 });
    expect(gw.alertRequests).toBe(2);                                       // the batch, then the unlinked retry
  });

  test('not configured: nothing is attempted', async () => {
    const store = new MemorySessionStore();
    await store.insertAlert(alert());
    const gw = new FakeGateway(); gw.configured = false;
    expect(await new SyncEngine(store, gw, 'u1', clock).syncAlerts()).toMatchObject({ status: 'not-configured' });
    expect(gw.alertRequests).toBe(0);
  });
});
