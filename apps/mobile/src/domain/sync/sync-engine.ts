import type { Session, SyncState } from '@/domain/entities/session';
import type { SessionStore } from '@/domain/repositories/session-store';
import type { SyncGateway, RemoteVitalAlert } from '@/domain/repositories/sync-gateway';
import { packChannelChunks, unpackChannelChunks } from '@/data/sync/chunk-container';
import { SENSOR_CODES } from '@wearwise/sensor-protocol';

/* SyncEngine — pushes finished sessions to the cloud, offline-first and resumable.
 *
 * Rules (build instruction §6, §25):
 *  - The local encrypted store is the source of truth. Sync only ever UPLOADS;
 *    it never mutates local data beyond the sync-state bookkeeping.
 *  - Only finished sessions sync. A `recording` session is never touched.
 *  - Falls ride along with their session, so a lost phone doesn't lose them.
 *  - Vital alerts (high/low) go up on their own, soon after they open or change, so
 *    the people a participant shares with see them while they matter. An alert from a
 *    recording links to that session only once the session itself is uploaded; until
 *    then its cloud row says "no session" and the link is added on a later sync.
 *  - restoreOnce() is the reverse path for a phone with no local copy (reinstall,
 *    new device): it only ever ADDS sessions that are missing locally.
 *  - Idempotent: every remote write is keyed by the row's UUID or the object path,
 *    and per-channel progress is recorded, so a retry after a crash or a dropped
 *    network resumes exactly where it stopped and never duplicates.
 *  - A failure on one session is recorded and does not stop the others.
 *
 * No React Native, no supabase-js here — only the two ports and a clock.
 */

export interface SyncOutcome {
  configured: boolean;
  attempted: number;
  synced: number;
  failed: number;
  errors: { sessionId: string; message: string }[];
  /* The vital-alert pass that follows the sessions (absent if the run was aborted). */
  alerts?: AlertSyncOutcome;
}

export interface AlertSyncOutcome {
  /* 'unavailable': the backend has no vital_alerts table yet — nothing is lost, the
     alerts go up once it does. 'failed': worth retrying soon (offline, server error). */
  status: 'ok' | 'unavailable' | 'failed' | 'not-configured';
  uploaded: number;
  /* Still to upload after this run. */
  pending: number;
  /* Linked to a session the server refused (not in the cloud yet, or gone): left as
     they are for a later sync rather than holding back the rest. */
  deferred: number;
  error?: string;
}

/* Per upsert request; ~200 bytes a row. */
const ALERT_BATCH = 100;
/* Alerts considered per run; the rest follow on the next. */
const ALERT_SCAN_LIMIT = 500;
/* Linked alerts the server refused, in a row, before the rest of a batch is deferred
   without asking (an account that can't upload at all would refuse every one). */
const MAX_REFUSALS = 3;

type AlertUpload = RemoteVitalAlert & { revision: number };

export class SyncEngine {
  constructor(
    private store: SessionStore,
    private gateway: SyncGateway,
    private userId: string,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  /* The Storage object path for a channel. `{userId}/...` is what the Storage RLS
     policy keys on, so a participant can only ever write under their own folder. */
  private channelPath(sessionId: string, channelId: string): string {
    return `${this.userId}/${sessionId}/${channelId}.wwch`;
  }

  async syncOnce(shouldAbort?: () => boolean): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { configured: this.gateway.isConfigured(), attempted: 0, synced: 0, failed: 0, errors: [] };
    if (!outcome.configured) return outcome;

    const pending = await this.store.listSessionsPendingSync(this.userId);
    for (const session of pending) {
      /* Yield the JS thread back to a recording that started mid-sync — the rest
         stays pending and is retried on the next trigger. */
      if (shouldAbort && shouldAbort()) break;
      outcome.attempted++;
      try {
        await this.syncSession(session);
        outcome.synced++;
      } catch (e) {
        outcome.failed++;
        const message = e instanceof Error ? e.message : 'sync failed';
        outcome.errors.push({ sessionId: session.id, message });
        await this.recordFailure(session.id, message);
        /* keep going — one bad session must not block the rest */
      }
    }
    if (!(shouldAbort && shouldAbort())) await this.backfillFalls();
    /* After the sessions, so an alert from a session uploaded just now gets its link. */
    if (!(shouldAbort && shouldAbort())) outcome.alerts = await this.syncAlerts(shouldAbort);
    return outcome;
  }

  /* Upload vital alerts that are new or changed since their last upload (and add the
     session link to ones whose session has reached the cloud since). Light enough to
     run on its own while recording. Never throws: the outcome says what happened. */
  async syncAlerts(shouldAbort?: () => boolean): Promise<AlertSyncOutcome> {
    const out: AlertSyncOutcome = { status: 'ok', uploaded: 0, pending: 0, deferred: 0 };
    if (!this.gateway.isConfigured()) return { ...out, status: 'not-configured' };
    let total = 0;
    const done = (status: AlertSyncOutcome['status'], error?: string): AlertSyncOutcome =>
      ({ ...out, status, pending: total - out.uploaded - out.deferred, ...(error ? { error } : {}) });
    try {
      const work = await this.alertsToUpload();
      total = work.length;
      for (let i = 0; i < work.length; i += ALERT_BATCH) {
        if (shouldAbort && shouldAbort()) return done('ok');
        const batch = work.slice(i, i + ALERT_BATCH);
        const result = await this.gateway.putVitalAlerts(this.userId, batch);
        if (result === 'unavailable') return done('unavailable');
        const sent = result === 'ok' ? batch : await this.retryRefused(batch, out);
        await this.store.markAlertsCloudSynced(sent.map((w) => ({
          id: w.alert.id, revision: w.revision,
          /* No session to link, or linked now: either way nothing more to add later. */
          linkSettled: w.sessionId != null || w.alert.sessionId == null,
        })));
        out.uploaded += sent.length;
      }
      return done('ok');
    } catch (e) {
      return done('failed', e instanceof Error ? e.message : 'alert sync failed');
    }
  }

  private async alertsToUpload(): Promise<AlertUpload[]> {
    const candidates = await this.store.listAlertsPendingCloud(this.userId, ALERT_SCAN_LIMIT);
    const inCloud = new Map<string, boolean>();   // sessionId → uploaded
    const work: AlertUpload[] = [];
    for (const { alert, cloud } of candidates) {
      if (alert.userId !== this.userId || (alert.kind !== 'high' && alert.kind !== 'low') || alert.sensorType == null) continue;
      let link: string | null = null;
      if (alert.sessionId) {
        let uploaded = inCloud.get(alert.sessionId);
        if (uploaded === undefined) {
          uploaded = (await this.store.getSyncState(alert.sessionId))?.status === 'synced';
          inCloud.set(alert.sessionId, uploaded);
        }
        if (uploaded) link = alert.sessionId;
      }
      const changed = cloud.revision > cloud.syncedRevision;
      const linkToAdd = link != null && !cloud.linkSettled;
      if (changed || linkToAdd) work.push({ alert, sessionId: link, revision: cloud.revision });
    }
    return work;
  }

  /* The server refused a batch. Unlinked alerts only fail that way when this account
     can't upload at all (retried later, as a failure); an alert linked to a session the
     server doesn't have is left for a later sync. So: the unlinked ones together, then
     each linked one alone, so one alert can never hold back the rest. */
  private async retryRefused(batch: AlertUpload[], out: AlertSyncOutcome): Promise<AlertUpload[]> {
    const unlinked = batch.filter((w) => w.sessionId == null);
    const linked = batch.filter((w) => w.sessionId != null);
    const sent: AlertUpload[] = [];
    if (unlinked.length) {
      if ((await this.gateway.putVitalAlerts(this.userId, unlinked)) !== 'ok') throw new Error('Cloud alerts were refused.');
      sent.push(...unlinked);
    }
    let refusals = 0;
    for (const w of linked) {
      if (refusals >= MAX_REFUSALS) { out.deferred++; continue; }
      const result = await this.gateway.putVitalAlerts(this.userId, [w]);
      if (result === 'ok') { sent.push(w); refusals = 0; } else { out.deferred++; refusals++; }
    }
    return sent;
  }

  /* Falls of already-synced sessions — covers sessions uploaded before the cloud
     had a fall_events table. Idempotent upserts; only sessions that have falls. */
  private async backfillFalls(): Promise<void> {
    try {
      const counts = await this.store.fallCountsForUser(this.userId);
      for (const sessionId of Object.keys(counts)) {
        const state = await this.store.getSyncState(sessionId);
        if (state?.status !== 'synced') continue;
        const events = await this.store.listFallEvents(sessionId);
        if ((await this.gateway.putFallEvents(this.userId, events)) === 'unavailable') return;
      }
    } catch { /* best effort — retried on the next sync */ }
  }

  /* Rebuild sessions that exist in the cloud but not on this phone. Verified on the
     way in: every chunk's CRC is checked by unpackChannelChunks, so a corrupted
     download fails that session rather than storing bad samples. */
  async restoreOnce(shouldAbort?: () => boolean): Promise<{ restored: number; failed: number; errors?: string[] }> {
    const result: { restored: number; failed: number; errors?: string[] } = { restored: 0, failed: 0 };
    if (!this.gateway.isConfigured()) return result;
    const remote = await this.gateway.listRemoteSessions();
    for (const session of remote) {
      if (shouldAbort && shouldAbort()) break;
      if (session.userId !== this.userId) continue;
      if (await this.store.getSession(session.id)) continue;   // already on this phone
      try {
        await this.restoreSession(session);
        result.restored++;
      } catch (e) {
        result.failed++;
        (result.errors ??= []).push(`${session.id}: ${e instanceof Error ? e.message : String(e)}`);
        try { await this.store.deleteSession(session.id); } catch { /* nothing written */ }
      }
    }
    return result;
  }

  private async restoreSession(session: Session): Promise<void> {
    /* Download and verify everything BEFORE writing, so a failed download never
       leaves a half-restored session on the phone. */
    const channels = await this.gateway.listRemoteChannels(session.id);
    /* What the cloud says is checked like anything else from outside: a channel this app
       can't draw would break the session screen every time it opened. */
    for (const { channel } of channels) {
      if (!(channel.sensorType in SENSOR_CODES)) throw new Error(`unknown sensor type ${String(channel.sensorType)}`);
      if (!Number.isFinite(channel.sampleRateHz) || channel.sampleRateHz <= 0 || channel.sampleRateHz > 1000) {
        throw new Error(`implausible sample rate ${String(channel.sampleRateHz)}`);
      }
    }
    const payloads = await Promise.all(channels.map(async (c) =>
      unpackChannelChunks(await this.gateway.getChannelPayload(c.storagePath))));
    const falls = await this.gateway.listRemoteFallEvents(session.id);

    await this.store.createSession({
      id: session.id, userId: this.userId, deviceId: session.deviceId, startedAt: session.startedAt,
      simulated: session.simulated, initialTransport: session.initialTransport,
      configurationSnapshot: session.configurationSnapshot,
    });
    /* Mark it synced up front: it came FROM the cloud, so it must never be queued
       for re-upload (an interrupted restore would otherwise overwrite the cloud). */
    await this.store.upsertSyncState({
      sessionId: session.id, status: 'synced', uploadedChannelIds: channels.map((c) => c.channel.id),
      attempts: 0, lastError: null, syncedAt: this.now(), updatedAt: this.now(),
    });
    for (let i = 0; i < channels.length; i++) {
      const { channel } = channels[i]!;
      await this.store.createChannel({
        id: channel.id, sessionId: session.id, sensorType: channel.sensorType,
        canonicalUnit: channel.canonicalUnit, sampleRateHz: channel.sampleRateHz,
      });
      for (const c of payloads[i]!) {
        await this.store.appendChunk({
          id: `${channel.id}:${c.chunkNumber}`, sessionId: session.id, channelId: channel.id,
          chunkNumber: c.chunkNumber, firstSequence: c.firstSequence, lastSequence: c.lastSequence,
          startedAtUs: c.startedAtUs, endedAtUs: c.endedAtUs, sampleCount: c.sampleCount,
          encoding: 'int16le-v1', payload: c.payload, checksum: c.checksum,
        });
      }
      const n = channel.sampleCount;
      await this.store.updateChannelSummary(channel.id, {
        sampleCount: n, min: channel.minimumValue ?? Number.POSITIVE_INFINITY, max: channel.maximumValue ?? Number.NEGATIVE_INFINITY,
        sum: (channel.averageValue ?? 0) * n, firstTimestampUs: channel.firstTimestampUs, lastTimestampUs: channel.lastTimestampUs,
        packetsAccepted: 0, packetsDuplicate: 0, sequenceGaps: 0,
      });
    }
    for (const f of falls) await this.store.insertFallEvent(f);
    await this.store.closeSession(session.id, {
      endedAt: session.endedAt ?? session.startedAt, durationMs: session.durationMs ?? 0,
      status: session.status === 'interrupted' ? 'interrupted' : 'complete',
      finalTransport: session.finalTransport, transportSwitchCount: session.transportSwitchCount,
      simulated: session.simulated,
    });
  }

  private async syncSession(session: Session): Promise<void> {
    const prior = await this.store.getSyncState(session.id);
    const uploaded = new Set(prior?.uploadedChannelIds ?? []);
    const attempts = (prior?.attempts ?? 0) + 1;

    await this.store.upsertSyncState({
      sessionId: session.id, status: 'uploading', uploadedChannelIds: [...uploaded],
      attempts, lastError: null, syncedAt: null, updatedAt: this.now(),
    });

    /* Session row FIRST: the channels' RLS insert policy requires the parent
       session to already exist and belong to the caller. Idempotent upsert. */
    await this.gateway.putSession(session);

    const detail = await this.store.getSession(session.id);
    const channels = detail?.channels ?? [];

    for (const channel of channels) {
      if (uploaded.has(channel.id)) continue; // resume: already done
      const chunks = await this.store.listChunks(session.id, channel.id);
      const blob = packChannelChunks(chunks);
      const path = this.channelPath(session.id, channel.id);

      /* Payload to Storage, then the metadata row that points at it. If the second
         write fails, the payload just gets overwritten on the next attempt. */
      await this.gateway.putChannelPayload(path, blob);
      await this.gateway.putChannel(channel, path);

      uploaded.add(channel.id);
      await this.store.upsertSyncState({
        sessionId: session.id, status: 'uploading', uploadedChannelIds: [...uploaded],
        attempts, lastError: null, syncedAt: null, updatedAt: this.now(),
      });
    }

    /* Falls after the session row exists (their insert policy requires it). A backend
       without the fall_events table reports 'unavailable'; the session still syncs
       and backfillFalls() uploads them once the table exists. */
    await this.gateway.putFallEvents(this.userId, await this.store.listFallEvents(session.id));

    await this.store.upsertSyncState({
      sessionId: session.id, status: 'synced', uploadedChannelIds: [...uploaded],
      attempts, lastError: null, syncedAt: this.now(), updatedAt: this.now(),
    });
  }

  private async recordFailure(sessionId: string, message: string): Promise<void> {
    const prior = await this.store.getSyncState(sessionId);
    const state: SyncState = {
      sessionId,
      status: 'failed',
      uploadedChannelIds: prior?.uploadedChannelIds ?? [],
      attempts: prior?.attempts ?? 1,
      lastError: message.slice(0, 300), // safe, bounded; no payloads
      syncedAt: null,
      updatedAt: this.now(),
    };
    await this.store.upsertSyncState(state);
  }
}
