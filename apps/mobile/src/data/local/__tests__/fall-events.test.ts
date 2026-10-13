import { MemorySessionStore } from '../memory-session-store';
import type { FallEventRecord, FallStatus } from '@/domain/entities/session';

/* Contract for the fall-event store surface, on the in-memory implementation the
 * app falls back to when SQLCipher can't open. The SQLite store mirrors these. */

async function makeSession(store: MemorySessionStore, id: string, userId: string) {
  await store.createSession({
    id, userId, deviceId: 'device-1', startedAt: '2026-01-01T00:00:00Z',
    simulated: true, initialTransport: 'simulation',
    configurationSnapshot: { deviceName: 'Sim', firmwareVersion: null, protocolVersion: 1, channels: [] },
  });
}

const fall = (id: string, sessionId: string, detectedAtMs: number, status: FallStatus): FallEventRecord =>
  ({ id, sessionId, detectedAtMs, freefallMinG: 0.3, impactPeakG: 4.2, status, createdAt: '2026-01-01T00:00:05Z' });

describe('fall event persistence (memory store)', () => {
  it('insert then list returns a session\'s falls earliest first', async () => {
    const s = new MemorySessionStore();
    await makeSession(s, 'sess-1', 'user-1');
    await s.insertFallEvent(fall('f2', 'sess-1', 5000, 'emergency'));
    await s.insertFallEvent(fall('f1', 'sess-1', 1000, 'cancelled'));
    const list = await s.listFallEvents('sess-1');
    expect(list.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(list[0]!.status).toBe('cancelled');
    expect(list[1]!.impactPeakG).toBe(4.2);
  });

  it('fallCountsForUser groups by session and scopes to the user', async () => {
    const s = new MemorySessionStore();
    await makeSession(s, 'a', 'user-1');
    await makeSession(s, 'b', 'user-1');   // no falls
    await makeSession(s, 'c', 'user-2');   // other user
    await s.insertFallEvent(fall('1', 'a', 1000, 'emergency'));
    await s.insertFallEvent(fall('2', 'a', 2000, 'cancelled'));
    await s.insertFallEvent(fall('3', 'c', 1000, 'emergency'));
    expect(await s.fallCountsForUser('user-1')).toEqual({ a: 2 });
    expect(await s.fallCountsForUser('user-2')).toEqual({ c: 1 });
  });

  it('deleting a session removes its falls', async () => {
    const s = new MemorySessionStore();
    await makeSession(s, 'sess-1', 'user-1');
    await s.insertFallEvent(fall('f1', 'sess-1', 1000, 'emergency'));
    await s.deleteSession('sess-1');
    expect(await s.listFallEvents('sess-1')).toEqual([]);
    expect(await s.fallCountsForUser('user-1')).toEqual({});
  });
});
