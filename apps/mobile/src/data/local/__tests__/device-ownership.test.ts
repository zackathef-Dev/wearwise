import { MemorySessionStore } from '../memory-session-store';

test('device metadata and forgetting are isolated between accounts', async () => {
  const store = new MemorySessionStore();
  await store.upsertDevice({ id: 'device', userId: 'owner', displayName: 'Private device name', model: null, firmwareVersion: null, preferredTransport: 'bluetooth', address: 'private-address', pairedAt: '2026-09-20', lastSeenAt: null });
  expect(await store.listDevices('other')).toEqual([]);
  await store.deleteDevice('device', 'other');
  expect(await store.listDevices('owner')).toHaveLength(1);
  await store.deleteDevice('device', 'owner');
  expect(await store.listDevices('owner')).toEqual([]);
});
