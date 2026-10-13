import { SequenceTracker, SensorType, type SensorPacket } from '../index';

const DEVICE = '0f2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const pkt = (sequenceNumber: number, bootId = 1, sensorType = SensorType.Ecg): SensorPacket => ({
  protocolVersion: 1, deviceId: DEVICE, bootId, sessionId: DEVICE, sensorType,
  sequenceNumber, deviceTimestampUs: 0n, sampleRateHz: 70, encoding: 1, flags: 0, samples: [0],
});

describe('SequenceTracker', () => {
  test('accepts a contiguous stream with zero gaps', () => {
    const t = new SequenceTracker();
    for (let i = 0; i < 5; i++) expect(t.observe(pkt(i))).toEqual({ kind: 'accept', gap: 0 });
  });

  test('reports the size of a gap', () => {
    const t = new SequenceTracker();
    t.observe(pkt(0)); t.observe(pkt(1));
    expect(t.observe(pkt(5))).toEqual({ kind: 'accept', gap: 3 }); // 2,3,4 missing
  });

  test('drops an exact duplicate (BLE retry / transport overlap)', () => {
    const t = new SequenceTracker();
    t.observe(pkt(3));
    expect(t.observe(pkt(3))).toEqual({ kind: 'duplicate' });
  });

  test('accepts a late out-of-order packet once, then treats it as a duplicate', () => {
    const t = new SequenceTracker();
    t.observe(pkt(0)); t.observe(pkt(2));
    expect(t.observe(pkt(1))).toEqual({ kind: 'accept', gap: 0 });
    expect(t.observe(pkt(1))).toEqual({ kind: 'duplicate' });
  });

  test('a new bootId is a restart, not a replay — sequence 0 is accepted again', () => {
    const t = new SequenceTracker();
    t.observe(pkt(0, 1)); t.observe(pkt(1, 1)); t.observe(pkt(2, 1));
    expect(t.observe(pkt(0, 2))).toEqual({ kind: 'accept-after-restart', previousBootId: 1 });
    expect(t.observe(pkt(1, 2))).toEqual({ kind: 'accept', gap: 0 });
  });

  test('streams are independent per sensor type', () => {
    const t = new SequenceTracker();
    t.observe(pkt(0, 1, SensorType.Ecg));
    expect(t.observe(pkt(0, 1, SensorType.SpO2))).toEqual({ kind: 'accept', gap: 0 });
  });

  test('something far behind the window is stale, not silently accepted', () => {
    const t = new SequenceTracker();
    t.observe(pkt(0)); t.observe(pkt(2000));
    expect(t.observe(pkt(5))).toEqual({ kind: 'stale' });
  });

  test('a new session starts clean even after the preview taught it high numbers (real-device bug)', () => {
    const t = new SequenceTracker();
    const PREVIEW = '11111111-1111-4111-8111-111111111111';
    const RECORDING = '22222222-2222-4222-8222-222222222222';
    const inSession = (seq: number, sessionId: string): SensorPacket => ({ ...pkt(seq), sessionId });
    for (let i = 0; i < 600; i++) t.observe(inSession(i, PREVIEW));
    // The recording's stream restarts at 0 on the same boot: every packet must be kept.
    expect(t.observe(inSession(0, RECORDING))).toEqual({ kind: 'accept', gap: 0 });
    expect(t.observe(inSession(1, RECORDING))).toEqual({ kind: 'accept', gap: 0 });
    // Duplicates within the session are still dropped.
    expect(t.observe(inSession(1, RECORDING))).toEqual({ kind: 'duplicate' });
  });
});

