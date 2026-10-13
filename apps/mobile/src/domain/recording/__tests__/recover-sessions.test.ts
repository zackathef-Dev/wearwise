import { SensorType, crc32 } from '@wearwise/sensor-protocol';
import { MemorySessionStore } from '@/data/local/memory-session-store';
import { recoverUnfinishedSessions } from '../recover-sessions';

const int16 = (values: number[], scale: number) => {
  const u = new Uint8Array(values.length * 2);
  const dv = new DataView(u.buffer);
  values.forEach((v, i) => dv.setInt16(i * 2, Math.round(v / scale), true));
  return u;
};

async function seedCrashedSession(store: MemorySessionStore) {
  await store.createSession({
    id: 's1', userId: 'u', deviceId: 'd', startedAt: new Date(Date.now() - 60_000).toISOString(), simulated: true,
    initialTransport: 'simulation', configurationSnapshot: { deviceName: 'x', firmwareVersion: null, protocolVersion: 1, channels: [] },
  });
  await store.createChannel({ id: 'c-ecg', sessionId: 's1', sensorType: SensorType.Ecg, canonicalUnit: 'mV', sampleRateHz: 70 });
  const good1 = int16([0.1, 0.2, 1.1, -0.3], 0.001);
  const good2 = int16([0.0, 0.5], 0.001);
  const bad = int16([9, 9, 9], 0.001);
  await store.appendChunk({ id: 'k0', sessionId: 's1', channelId: 'c-ecg', chunkNumber: 0, firstSequence: 0, lastSequence: 1, startedAtUs: 0n, endedAtUs: 42857n, sampleCount: 4, encoding: 'int16le-v1', payload: good1, checksum: crc32(good1) });
  await store.appendChunk({ id: 'k1', sessionId: 's1', channelId: 'c-ecg', chunkNumber: 1, firstSequence: 2, lastSequence: 2, startedAtUs: 57142n, endedAtUs: 71428n, sampleCount: 2, encoding: 'int16le-v1', payload: good2, checksum: crc32(good2) });
  /* Torn write: checksum does not match payload. */
  await store.appendChunk({ id: 'k2', sessionId: 's1', channelId: 'c-ecg', chunkNumber: 2, firstSequence: 3, lastSequence: 3, startedAtUs: 85714n, endedAtUs: 114285n, sampleCount: 3, encoding: 'int16le-v1', payload: bad, checksum: 0xdeadbeef });
}

describe('startup recovery', () => {
  test('marks the crashed session interrupted, verifies chunks, rebuilds the summary, and keeps the data', async () => {
    const store = new MemorySessionStore();
    await seedCrashedSession(store);

    const recovered = await recoverUnfinishedSessions(store, 'u');
    expect(recovered).toHaveLength(1);
    const r = recovered[0]!;
    expect(r.session.status).toBe('interrupted');
    expect(r.recovery.chunksVerified).toBe(2);
    expect(r.recovery.chunksCorrupt).toBe(1);
    expect(r.recovery.lastGoodSequence[SensorType.Ecg]).toBe(2);
    expect(r.totalSamples).toBe(6);

    const row = store.sessions.get('s1')!;
    expect(row.status).toBe('interrupted');
    expect(row.endedAt).not.toBeNull();
    expect(row.durationMs).toBeGreaterThan(50_000);

    /* The summary reflects only verified chunks — the corrupt 9,9,9 does not
       inflate the maximum. */
    const ch = store.channels.get('c-ecg')!;
    expect(ch.sampleCount).toBe(6);
    expect(ch.maximumValue).toBeCloseTo(1.1, 3);
    expect(ch.minimumValue).toBeCloseTo(-0.3, 3);

    /* Nothing deleted: the person decides. */
    expect(store.chunks).toHaveLength(3);
  });

  test('is idempotent: a second run finds nothing to recover', async () => {
    const store = new MemorySessionStore();
    await seedCrashedSession(store);
    await recoverUnfinishedSessions(store, 'u');
    expect(await recoverUnfinishedSessions(store, 'u')).toHaveLength(0);
  });

  test('does not touch other users’ sessions', async () => {
    const store = new MemorySessionStore();
    await seedCrashedSession(store);
    expect(await recoverUnfinishedSessions(store, 'someone-else')).toHaveLength(0);
    expect(store.sessions.get('s1')!.status).toBe('recording');
  });

  test('rebuilds each channel at its OWN protocol scale, and packetsAccepted is per-channel', async () => {
    /* Regression: heart rate (0.1 bpm/unit) must not be recovered at ECG's scale,
       and each channel's packetsAccepted must count only its own verified chunks. */
    const store = new MemorySessionStore();
    await store.createSession({
      id: 's2', userId: 'u', deviceId: 'd', startedAt: new Date().toISOString(), simulated: true,
      initialTransport: 'simulation', configurationSnapshot: { deviceName: 'x', firmwareVersion: null, protocolVersion: 1, channels: [] },
    });
    await store.createChannel({ id: 'c-ecg', sessionId: 's2', sensorType: SensorType.Ecg, canonicalUnit: 'mV', sampleRateHz: 70 });
    await store.createChannel({ id: 'c-hr', sessionId: 's2', sensorType: SensorType.HeartRate, canonicalUnit: 'bpm', sampleRateHz: 1 });
    // ECG: 2 chunks
    const e0 = int16([0.2, 0.4], 0.001), e1 = int16([0.6], 0.001);
    await store.appendChunk({ id: 'e0', sessionId: 's2', channelId: 'c-ecg', chunkNumber: 0, firstSequence: 0, lastSequence: 0, startedAtUs: 0n, endedAtUs: 1n, sampleCount: 2, encoding: 'int16le-v1', payload: e0, checksum: crc32(e0) });
    await store.appendChunk({ id: 'e1', sessionId: 's2', channelId: 'c-ecg', chunkNumber: 1, firstSequence: 1, lastSequence: 1, startedAtUs: 2n, endedAtUs: 3n, sampleCount: 1, encoding: 'int16le-v1', payload: e1, checksum: crc32(e1) });
    // Heart rate: 1 chunk, real values 66..70 bpm encoded at 0.1 scale
    const h0 = int16([66, 70, 68], 0.1);
    await store.appendChunk({ id: 'h0', sessionId: 's2', channelId: 'c-hr', chunkNumber: 0, firstSequence: 0, lastSequence: 0, startedAtUs: 0n, endedAtUs: 3_000_000n, sampleCount: 3, encoding: 'int16le-v1', payload: h0, checksum: crc32(h0) });

    await recoverUnfinishedSessions(store, 'u');
    const hr = [...store.channels.values()].find((c) => c.sensorType === SensorType.HeartRate)!;
    const ecg = [...store.channels.values()].find((c) => c.sensorType === SensorType.Ecg)!;
    // scale: average must be ~68 bpm, NOT ~680 (10× from using scale 1)
    expect(hr.averageValue!).toBeGreaterThan(65);
    expect(hr.averageValue!).toBeLessThan(71);
    // per-channel packet counts: each channel counts only its own verified chunks
    expect(ecg.sampleCount).toBe(3);
    expect(hr.sampleCount).toBe(3);
  });
});
