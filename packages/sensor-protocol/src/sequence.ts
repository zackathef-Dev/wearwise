import type { SensorPacket, SensorType } from './types.ts';

/* Per-stream sequence accounting: duplicates, gaps, and device restarts.
 *
 * A "stream" is one (deviceId, sessionId, sensorType). The firmware restarts its
 * sequence numbers for every new session and on every boot, so a lower number with a
 * NEW bootId is a restart, not a replay — and a lower number with the SAME bootId in
 * the same session is a duplicate (BLE retry, Wi-Fi→BLE overlap during a transport
 * switch) and must be dropped.
 *
 * The session is part of the key: keyed only by device and signal, packets from the
 * live preview that arrived while a recording was being set up taught the tracker
 * high numbers, and the new session's packets (from 0) were then dropped as
 * duplicates for minutes. Found in the real-device test (ECG and movement lost,
 * temperature kept because it sends rarely).
 *
 * This is where transport fallback stays honest: both transports may briefly
 * deliver the same packets, and the recording pipeline sees each sequence once.
 */

export type SequenceVerdict =
  | { kind: 'accept'; gap: 0 }
  | { kind: 'accept'; gap: number }          // packets missing before this one
  | { kind: 'accept-after-restart'; previousBootId: number }
  | { kind: 'duplicate' }
  | { kind: 'stale' };                      // older than the window, not a dup we can prove

const WINDOW = 512; // how far back we remember seen sequences, per stream

interface StreamState {
  bootId: number;
  next: number;              // the sequence we expect next
  seen: Set<number>;         // recent accepted sequences, for out-of-order dedup
}

export class SequenceTracker {
  private streams = new Map<string, StreamState>();

  static key(deviceId: string, sessionId: string, sensorType: SensorType): string {
    return `${deviceId}:${sessionId}:${sensorType}`;
  }

  observe(p: SensorPacket): SequenceVerdict {
    const k = SequenceTracker.key(p.deviceId, p.sessionId, p.sensorType);
    const s = this.streams.get(k);

    if (!s) {
      this.streams.set(k, { bootId: p.bootId, next: p.sequenceNumber + 1, seen: new Set([p.sequenceNumber]) });
      return { kind: 'accept', gap: 0 };
    }

    if (p.bootId !== s.bootId) {
      const previous = s.bootId;
      this.streams.set(k, { bootId: p.bootId, next: p.sequenceNumber + 1, seen: new Set([p.sequenceNumber]) });
      return { kind: 'accept-after-restart', previousBootId: previous };
    }

    if (s.seen.has(p.sequenceNumber)) return { kind: 'duplicate' };

    if (p.sequenceNumber < s.next - WINDOW) return { kind: 'stale' };

    const gap = p.sequenceNumber > s.next ? p.sequenceNumber - s.next : 0;
    s.seen.add(p.sequenceNumber);
    if (p.sequenceNumber >= s.next) s.next = p.sequenceNumber + 1;
    /* Bound memory: forget anything older than the window. */
    for (const n of s.seen) if (n < s.next - WINDOW) s.seen.delete(n);

    return { kind: 'accept', gap };
  }

  reset(): void {
    this.streams.clear();
  }
}
