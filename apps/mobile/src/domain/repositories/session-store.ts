import type { SensorType } from '@wearwise/sensor-protocol';
import type {
  Session, SessionChannel, SampleChunk, ChannelSummary, SessionStatus, RecoveryState, SyncState, DeviceRecord,
  FallEventRecord, AlertRecord, HealthProfile, NotificationRecord, PendingCloudAlert,
} from '@/domain/entities/session';

/* Local persistence port. The encrypted SQLite implementation lives in data/local;
 * the recording engine and every screen depend only on this.
 *
 * Writes are shaped for crash safety: a chunk append is one row, a channel
 * summary update is one row, and closing a session is one status flip. There is
 * no multi-step write the engine could be interrupted halfway through and leave
 * unrecoverable — recovery reconstructs from whatever chunks landed.
 */

export interface NewSession {
  id: string;
  userId: string;
  deviceId: string;
  startedAt: string;
  simulated: boolean;
  initialTransport: Session['initialTransport'];
  configurationSnapshot: Session['configurationSnapshot'];
}

export interface NewChannel {
  id: string;
  sessionId: string;
  sensorType: SensorType;
  canonicalUnit: string;
  sampleRateHz: number;
}

export interface SessionSummaryRow {
  session: Session;
  channels: SessionChannel[];
}

export interface SessionStore {
  createSession(s: NewSession): Promise<void>;
  createChannel(c: NewChannel): Promise<void>;

  appendChunk(chunk: Omit<SampleChunk, 'createdAt'>): Promise<void>;
  updateChannelSummary(channelId: string, summary: ChannelSummary): Promise<void>;

  closeSession(id: string, patch: {
    endedAt: string; durationMs: number; status: SessionStatus;
    finalTransport: Session['finalTransport']; transportSwitchCount: number;
    /* Reconciled from packet flags: a BLE transport is real hardware, but the
       firmware may still emit FLAG_SIMULATED data. If any packet was simulated,
       the stored session says so, regardless of transport. */
    simulated?: boolean;
  }): Promise<void>;

  /* Sessions still marked `recording` at startup are interrupted sessions. */
  findUnfinishedSessions(userId: string): Promise<Session[]>;
  markInterrupted(id: string, recovery: RecoveryState): Promise<void>;
  setStatus(id: string, status: SessionStatus): Promise<void>;

  listSessions(userId: string, limit?: number): Promise<SessionSummaryRow[]>;
  getSession(id: string): Promise<SessionSummaryRow | null>;

  /* Chunk access for recovery verification and (later) sync + charts. */
  listChunks(sessionId: string, channelId: string): Promise<SampleChunk[]>;
  countChunks(sessionId: string): Promise<number>;

  deleteSession(id: string): Promise<void>;

  /* ---- fall events (fall detection) ---- */

  /* Record a confirmed fall. Called when the alarm resolves — the countdown
     expiring (emergency) or the wearer tapping "I'm OK" (cancelled). */
  insertFallEvent(event: FallEventRecord): Promise<void>;
  /* Falls for a session, earliest first — for the history/session-detail screens. */
  listFallEvents(sessionId: string): Promise<FallEventRecord[]>;
  /* Fall count per session for one user, as { sessionId: count } — one query for the
     whole History list, so rows can show a fall badge without an N+1 fetch. */
  fallCountsForUser(userId: string): Promise<Record<string, number>>;

  /* ---- alerts (abnormal readings and falls) ---- */

  insertAlert(alert: AlertRecord): Promise<void>;
  /* Close an open alert and/or record a more extreme value. */
  updateAlert(id: string, patch: { endedAt?: string | null; value?: number }): Promise<void>;
  /* Newest first. */
  listAlerts(userId: string, limit?: number): Promise<AlertRecord[]>;
  countUnseenAlerts(userId: string): Promise<number>;
  markAlertsSeen(userId: string): Promise<void>;
  /* A session's alerts, oldest first (session detail). */
  listSessionAlerts(sessionId: string): Promise<AlertRecord[]>;
  deleteAlert(id: string, userId: string): Promise<void>;
  deleteAllAlerts(userId: string): Promise<void>;
  /* Vital alerts (high/low, never falls) whose cloud copy may be behind: changed since
     their last upload, or uploaded before their session's link could be included.
     Changed ones first, then oldest first; at most `limit`. */
  listAlertsPendingCloud(userId: string, limit?: number): Promise<PendingCloudAlert[]>;
  /* Record what reached the cloud. A revision older than the one already recorded is
     ignored, so a slow upload can never mark a newer change as sent. */
  markAlertsCloudSynced(marks: { id: string; revision: number; linkSettled: boolean }[]): Promise<void>;

  /* ---- notifications (the bell) ---- */

  insertNotification(n: NotificationRecord): Promise<void>;
  /* Newest first. */
  listNotifications(userId: string, limit?: number): Promise<NotificationRecord[]>;
  countUnseenNotifications(userId: string): Promise<number>;
  markNotificationsSeen(userId: string): Promise<void>;
  deleteNotification(id: string, userId: string): Promise<void>;
  deleteAllNotifications(userId: string): Promise<void>;

  /* ---- health profile (Profile) ---- */

  getHealthProfile(userId: string): Promise<HealthProfile | null>;
  saveHealthProfile(profile: HealthProfile): Promise<void>;

  /* ---- device registry (Devices screen) ---- */

  /* Insert or refresh a device the app connected to (name/model/firmware/last-seen).
     Idempotent on the device id. */
  upsertDevice(device: DeviceRecord): Promise<void>;
  /* All known devices, most-recently-seen first. */
  listDevices(userId: string): Promise<DeviceRecord[]>;
  /* Forget a device: removes the registry row (and its capabilities). Recorded
     sessions keep their deviceId and are NOT deleted. */
  deleteDevice(id: string, userId: string): Promise<void>;
  /* Give a device the participant's own name; null restores its advertised name.
     Reconnecting never overwrites it. */
  renameDevice(id: string, userId: string, name: string | null): Promise<void>;

  /* ---- cloud-sync state (Milestone 6) ---- */

  /* Finished sessions (complete/interrupted) not yet fully synced, oldest first —
     the sync engine's work list. Never returns a `recording` session. */
  listSessionsPendingSync(userId: string): Promise<Session[]>;
  getSyncState(sessionId: string): Promise<SyncState | null>;
  upsertSyncState(state: SyncState): Promise<void>;
  countPendingSync(userId: string): Promise<number>;
}
