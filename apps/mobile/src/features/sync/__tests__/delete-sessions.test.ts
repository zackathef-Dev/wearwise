import { deleteSessionsEverywhere } from '../delete-sessions';

/* jest hoists these above the imports. */
type Sync = { status: string; attempts: number };
const mockSyncStates = new Map<string, Sync>();
const mockStore: { deleted: string[]; getSyncState(id: string): Promise<Sync | null>; deleteSession(id: string): Promise<void> } = {
  deleted: [],
  getSyncState: async (id) => mockSyncStates.get(id) ?? null,
  deleteSession: async (id) => { mockStore.deleted.push(id); },
};
const mockEngine: { sessionId: string | null; state: string } = { sessionId: null, state: 'idle' };
jest.mock('@/features/monitoring/monitoring-store', () => ({
  getSessionStore: () => mockStore,
  useMonitoring: { getState: () => ({ engine: mockEngine }) },
}));
const mockCloudDeleted: string[] = [];
let mockCloudFails = new Set<string>();
jest.mock('@/data/remote/supabase-sync-gateway', () => ({
  SupabaseSyncGateway: jest.fn().mockImplementation(() => ({
    isConfigured: () => true,
    deleteSession: async (_u: string, id: string) => {
      if (mockCloudFails.has(id)) throw new Error('offline');
      mockCloudDeleted.push(id);
    },
  })),
}));

beforeEach(() => {
  mockSyncStates.clear(); mockStore.deleted = []; mockCloudDeleted.length = 0; mockCloudFails = new Set();
  mockEngine.sessionId = null; mockEngine.state = 'idle';
});

describe('deleting several sessions', () => {
  test('phone-only sessions skip the cloud; uploaded ones are deleted there first', async () => {
    mockSyncStates.set('b', { status: 'synced', attempts: 1 });
    mockSyncStates.set('c', { status: 'pending', attempts: 2 });   // a failed upload may have left a cloud copy
    const progress: number[] = [];
    const r = await deleteSessionsEverywhere('u1', ['a', 'b', 'c'], (n) => progress.push(n));
    expect(r.deleted).toEqual(['a', 'b', 'c']);
    expect(r.failed).toEqual([]);
    expect(mockCloudDeleted).toEqual(['b', 'c']);
    expect(mockStore.deleted).toEqual(['a', 'b', 'c']);
    expect(progress).toEqual([1, 2, 3]);
  });

  test('a cloud failure keeps that phone copy and does not stop the others', async () => {
    mockSyncStates.set('b', { status: 'synced', attempts: 1 });
    mockCloudFails = new Set(['b']);
    const r = await deleteSessionsEverywhere('u1', ['a', 'b', 'c']);
    expect(r.deleted).toEqual(['a', 'c']);
    expect(r.failed.map((f) => f.id)).toEqual(['b']);
    expect(mockStore.deleted).toEqual(['a', 'c']);           // b stays on the phone for a retry
  });

  test('the session being recorded is never deleted', async () => {
    mockEngine.sessionId = 'live'; mockEngine.state = 'recording';
    const r = await deleteSessionsEverywhere('u1', ['live', 'old']);
    expect(r.deleted).toEqual(['old']);
    expect(r.failed[0]!.reason).toMatch(/Stop the recording/);
  });
});
