import { SensorType } from '@wearwise/sensor-protocol';
import { MemorySessionStore } from '../memory-session-store';
import type { AlertRecord } from '@/domain/entities/session';

/* Contract for the alerts' cloud bookkeeping (listAlertsPendingCloud /
 * markAlertsCloudSynced), on the in-memory store. The SQLite store's cloud_* columns
 * (migration v9) mirror it. */

const alert = (id: string, over: Partial<AlertRecord> = {}): AlertRecord => ({
  id, userId: 'u1', sessionId: null, deviceId: null, sensorType: SensorType.HeartRate, kind: 'high', value: 110,
  startedAt: `2026-10-01T10:00:0${id.slice(-1)}Z`, endedAt: null, seen: false, ...over,
});

describe('alert cloud bookkeeping (memory store)', () => {
  it('lists the user’s vital alerts that are behind — never falls, never another user’s', async () => {
    const s = new MemorySessionStore();
    await s.insertAlert(alert('a1'));
    await s.insertAlert(alert('a2', { kind: 'fall', sensorType: null }));
    await s.insertAlert(alert('a3', { userId: 'u2' }));
    const pending = await s.listAlertsPendingCloud('u1');
    expect(pending.map((p) => p.alert.id)).toEqual(['a1']);
    expect(pending[0]!.cloud).toEqual({ revision: 1, syncedRevision: 0, linkSettled: false });
  });

  it('a change after upload makes it pending again; one waiting only for its link comes after changed ones', async () => {
    const s = new MemorySessionStore();
    await s.insertAlert(alert('a1', { sessionId: 'sess' }));
    await s.insertAlert(alert('a2'));
    await s.markAlertsCloudSynced([{ id: 'a1', revision: 1, linkSettled: false }, { id: 'a2', revision: 1, linkSettled: true }]);
    expect((await s.listAlertsPendingCloud('u1')).map((p) => p.alert.id)).toEqual(['a1']);   // link still to add
    await s.updateAlert('a2', { endedAt: '2026-10-01T10:05:00Z' });
    expect((await s.listAlertsPendingCloud('u1')).map((p) => p.alert.id)).toEqual(['a2', 'a1']);
    await s.markAlertsCloudSynced([{ id: 'a1', revision: 1, linkSettled: true }, { id: 'a2', revision: 2, linkSettled: true }]);
    expect(await s.listAlertsPendingCloud('u1')).toEqual([]);
  });

  it('an empty update is not a change', async () => {
    const s = new MemorySessionStore();
    await s.insertAlert(alert('a1'));
    await s.markAlertsCloudSynced([{ id: 'a1', revision: 1, linkSettled: true }]);
    await s.updateAlert('a1', {});
    expect(await s.listAlertsPendingCloud('u1')).toEqual([]);
  });

  it('respects the limit', async () => {
    const s = new MemorySessionStore();
    for (const id of ['a1', 'a2', 'a3']) await s.insertAlert(alert(id));
    expect((await s.listAlertsPendingCloud('u1', 2)).map((p) => p.alert.id)).toEqual(['a1', 'a2']);
  });
});
