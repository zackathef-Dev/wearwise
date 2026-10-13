import type { Session, SessionChannel, FallEventRecord, AlertRecord } from '@/domain/entities/session';

/* The cloud-sync port. The engine depends only on this; the Supabase
 * implementation lives in data/remote. Every method is idempotent by the row's
 * UUID / the object path, so a retried upload never duplicates.
 */

export interface RemoteSessionRow {
  session: Session;
}

export interface RemoteChannelRow {
  channel: SessionChannel;
  storagePath: string;
}

/* A vital alert to upload. `sessionId` is what the cloud row links to: the alert's own
   session once that session is in the cloud, otherwise null (the server refuses a link
   to a session it doesn't have). */
export interface RemoteVitalAlert {
  alert: AlertRecord;
  sessionId: string | null;
}

/* 'refused': the server would not take the rows (permission, or a linked session it
   doesn't have) — nothing was written. 'unavailable': the backend has no vital_alerts
   table yet. Neither throws, so the engine can decide what to retry. */
export type VitalAlertsResult = 'ok' | 'unavailable' | 'refused';

export interface SyncGateway {
  /* Null client / no network → not configured; the engine stays offline-first. */
  isConfigured(): boolean;

  /* Upsert the session metadata row (by session.id). */
  putSession(session: Session): Promise<void>;

  /* Upload one channel's packed chunk container to Storage at `path`. Overwrites
     (idempotent) so a resumed upload is safe. */
  putChannelPayload(path: string, bytes: Uint8Array): Promise<void>;

  /* Upsert the channel metadata row (by channel.id), pointing at `path`. */
  putChannel(channel: SessionChannel, path: string): Promise<void>;

  /* Remove a session from the cloud: its Storage objects under `{userId}/{sessionId}/`
     and its row (channels cascade). Idempotent — deleting what is already gone is
     not an error. Throws if the cloud copy may still exist. */
  deleteSession(userId: string, sessionId: string): Promise<void>;

  /* Upsert a session's falls (by event id). Resolves 'unavailable' — without
     throwing — when the backend has no fall_events table yet, so a project that
     hasn't applied that migration still syncs sessions normally. */
  putFallEvents(userId: string, events: FallEventRecord[]): Promise<'ok' | 'unavailable'>;

  /* Upsert vital alerts (kind high/low) by alert id, all in one request. Throws only
     for a failure worth retrying as-is (offline, server error). */
  putVitalAlerts(userId: string, alerts: RemoteVitalAlert[]): Promise<VitalAlertsResult>;

  /* ---- restore (cloud → a phone with no local copy) ---- */

  /* The caller's sessions in the cloud, newest first (RLS limits this to the owner). */
  listRemoteSessions(): Promise<Session[]>;
  listRemoteChannels(sessionId: string): Promise<RemoteChannelRow[]>;
  /* The packed chunk container at `path` (see data/sync/chunk-container). */
  getChannelPayload(path: string): Promise<Uint8Array>;
  /* Falls for a session; [] when the backend has no fall_events table. */
  listRemoteFallEvents(sessionId: string): Promise<FallEventRecord[]>;
}
