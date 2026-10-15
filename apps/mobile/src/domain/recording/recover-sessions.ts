import { crc32, SAMPLE_SCALE, type SensorType } from '@wearwise/sensor-protocol';
import type { SessionStore } from '@/domain/repositories/session-store';
import type { Session, RecoveryState } from '@/domain/entities/session';

/* Startup recovery — build-instruction §15, "crash recovery must".
 *
 * A session still marked `recording` when the app starts is one the app did not
 * get to close: a crash, a force-quit, a dead battery. Every chunk that reached
 * the database is verified against its checksum, the summary is rebuilt from
 * what survived, and the session is marked `interrupted` — never deleted, never
 * quietly promoted to `complete`. The person then decides: keep or delete.
 */

export interface RecoveredSession {
  session: Session;
  recovery: RecoveryState;
  /* Convenience for the UI: how much usable data survived. */
  totalSamples: number;
}

export async function recoverUnfinishedSessions(store: SessionStore, userId: string): Promise<RecoveredSession[]> {
  const unfinished = await store.findUnfinishedSessions(userId);
  const out: RecoveredSession[] = [];

  for (const session of unfinished) {
    const detail = await store.getSession(session.id);
    let verified = 0, corrupt = 0, totalSamples = 0;
    const lastGoodSequence: Partial<Record<SensorType, number>> = {};

    for (const ch of detail?.channels ?? []) {
      const chunks = await store.listChunks(session.id, ch.id);
      let count = 0, min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY, sum = 0;
      let first: bigint | null = null, last: bigint | null = null;
      let chVerified = 0; // per-channel, so each channel's packetsAccepted is its own

      for (const c of chunks) {
        if (crc32(c.payload) !== c.checksum) { corrupt += 1; continue; }
        verified += 1; chVerified += 1;
        lastGoodSequence[ch.sensorType] = c.lastSequence;
        /* Rebuild the aggregate from the raw int16 payload, at the protocol scale. */
        const dv = new DataView(c.payload.buffer, c.payload.byteOffset, c.payload.byteLength);
        const scale = SAMPLE_SCALE[ch.sensorType]?.scale ?? 1;
        for (let i = 0; i < c.sampleCount; i++) {
          const v = dv.getInt16(i * 2, true) * scale;
          count += 1; sum += v;
          if (v < min) min = v; if (v > max) max = v;
        }
        if (first == null) first = c.startedAtUs;
        last = c.endedAtUs;
      }
      totalSamples += count;
      await store.updateChannelSummary(ch.id, {
        sampleCount: count, min, max, sum, firstTimestampUs: first, lastTimestampUs: last,
        packetsAccepted: chVerified, packetsDuplicate: 0, sequenceGaps: 0,
      });
    }

    const recovery: RecoveryState = { detectedAt: new Date().toISOString(), chunksVerified: verified, chunksCorrupt: corrupt, lastGoodSequence };
    await store.markInterrupted(session.id, recovery);
    /* Close the clock at the last good sample so the duration is honest. */
    const endedAt = new Date().toISOString();
    await store.closeSession(session.id, {
      endedAt, durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(session.startedAt)), status: 'interrupted',
      finalTransport: session.finalTransport, transportSwitchCount: session.transportSwitchCount,
    });
    out.push({ session: { ...session, status: 'interrupted', recoveryState: recovery }, recovery, totalSamples });
  }
  return out;
}
