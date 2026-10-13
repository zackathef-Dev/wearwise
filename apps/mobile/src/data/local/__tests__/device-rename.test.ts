import { MemorySessionStore } from '../memory-session-store';
import { deviceName, type DeviceRecord } from '@/domain/entities/session';

const patch = (over: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id: 'dev-1', userId: 'u1', displayName: 'WearWise-6280', model: 'Wearable sensor · Bluetooth', firmwareVersion: null,
  preferredTransport: 'bluetooth', address: '8C:94:DF:6E:62:82', pairedAt: '2026-10-12T00:00:00Z', lastSeenAt: '2026-10-12T00:00:00Z',
  ...over,
});

describe('device rename', () => {
  test('a custom name is shown instead of the advertised one', async () => {
    const store = new MemorySessionStore();
    await store.upsertDevice(patch());
    await store.renameDevice('dev-1', 'u1', '  Chest patch A  ');
    const [d] = await store.listDevices('u1');
    expect(d!.customName).toBe('Chest patch A');      // trimmed
    expect(d!.displayName).toBe('WearWise-6280');     // advertised name kept
    expect(deviceName(d!)).toBe('Chest patch A');
  });

  test('reconnecting refreshes the advertised name but never undoes a rename', async () => {
    const store = new MemorySessionStore();
    await store.upsertDevice(patch());
    await store.renameDevice('dev-1', 'u1', 'Chest patch A');
    await store.upsertDevice(patch({ displayName: 'WearWise-6280', lastSeenAt: '2026-10-13T00:00:00Z' }));
    const [d] = await store.listDevices('u1');
    expect(deviceName(d!)).toBe('Chest patch A');
    expect(d!.lastSeenAt).toBe('2026-10-13T00:00:00Z');
  });

  test('clearing the name restores the advertised one', async () => {
    const store = new MemorySessionStore();
    await store.upsertDevice(patch());
    await store.renameDevice('dev-1', 'u1', 'Chest patch A');
    await store.renameDevice('dev-1', 'u1', null);
    expect(deviceName((await store.listDevices('u1'))[0]!)).toBe('WearWise-6280');
    await store.renameDevice('dev-1', 'u1', '   ');      // blank = no custom name
    expect((await store.listDevices('u1'))[0]!.customName).toBeNull();
  });

  test('another participant cannot rename my device', async () => {
    const store = new MemorySessionStore();
    await store.upsertDevice(patch());
    await store.renameDevice('dev-1', 'someone-else', 'Hijacked');
    expect(deviceName((await store.listDevices('u1'))[0]!)).toBe('WearWise-6280');
  });
});
