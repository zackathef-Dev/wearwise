import type { SessionStore, NewSession, NewChannel, SessionSummaryRow } from '@/domain/repositories/session-store';
import type { Session, SessionChannel, SampleChunk, ChannelSummary, SessionStatus, RecoveryState, SyncState, DeviceRecord, FallEventRecord, AlertRecord, HealthProfile, NotificationRecord, AlertCloudState, PendingCloudAlert } from '@/domain/entities/session';

const FINISHED: SessionStatus[] = ['complete', 'interrupted'];

/* In-memory SessionStore. Used by tests, and by the app as the honest fallback
 * when the encrypted database cannot be opened (the UI then says recordings will
 * not survive a restart — it never silently falls back to a plaintext file).
 *
 * Mirrors the SQLite store's semantics exactly: same rows, same status flips,
 * same ordering — the engine tests run against this and would catch a behaviour
 * the SQL version must also have.
 */
export class MemorySessionStore implements SessionStore {
  sessions = new Map<string, Session>();
  channels = new Map<string, SessionChannel>();
  chunks: SampleChunk[] = [];
  syncStates = new Map<string, SyncState>();
  /* Optional failure injection for engine tests. */
  failNextAppend = false;

  async createSession(s: NewSession): Promise<void> {
    const now = new Date().toISOString();
    this.sessions.set(s.id, {
      ...s, endedAt: null, durationMs: null, status: 'recording',
      finalTransport: s.initialTransport, transportSwitchCount: 0, recoveryState: null,
      createdAt: now, updatedAt: now,
    });
  }

  async createChannel(c: NewChannel): Promise<void> {
    this.channels.set(c.id, {
      ...c, sampleCount: 0, minimumValue: null, maximumValue: null, averageValue: null,
      firstTimestampUs: null, lastTimestampUs: null,
    });
  }

  async appendChunk(chunk: Omit<SampleChunk, 'createdAt'>): Promise<void> {
    if (this.failNextAppend) { this.failNextAppend = false; throw new Error('disk full (injected)'); }
    this.chunks.push({ ...chunk, payload: new Uint8Array(chunk.payload), createdAt: new Date().toISOString() });
  }

  async updateChannelSummary(channelId: string, s: ChannelSummary): Promise<void> {
    const c = this.channels.get(channelId);
    if (!c) throw new Error(`no channel ${channelId}`);
    this.channels.set(channelId, {
      ...c, sampleCount: s.sampleCount,
      minimumValue: s.sampleCount ? s.min : null, maximumValue: s.sampleCount ? s.max : null,
      averageValue: s.sampleCount ? s.sum / s.sampleCount : null,
      firstTimestampUs: s.firstTimestampUs, lastTimestampUs: s.lastTimestampUs,
    });
  }

  async closeSession(id: string, patch: Parameters<SessionStore['closeSession']>[1]): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no session ${id}`);
    this.sessions.set(id, { ...s, ...patch, updatedAt: new Date().toISOString() });
  }

  async findUnfinishedSessions(userId: string): Promise<Session[]> {
    return [...this.sessions.values()].filter((s) => s.userId === userId && s.status === 'recording');
  }

  async markInterrupted(id: string, recovery: RecoveryState): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.set(id, { ...s, status: 'interrupted', recoveryState: recovery, updatedAt: new Date().toISOString() });
  }

  async setStatus(id: string, status: SessionStatus): Promise<void> {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, status, updatedAt: new Date().toISOString() });
  }

  async listSessions(userId: string, limit = 100): Promise<SessionSummaryRow[]> {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && s.status !== 'discarded')
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, limit)
      .map((session) => ({ session, channels: [...this.channels.values()].filter((c) => c.sessionId === session.id) }));
  }

  async getSession(id: string): Promise<SessionSummaryRow | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    return { session, channels: [...this.channels.values()].filter((c) => c.sessionId === id) };
  }

  async listChunks(sessionId: string, channelId: string): Promise<SampleChunk[]> {
    return this.chunks.filter((c) => c.sessionId === sessionId && c.channelId === channelId).sort((a, b) => a.chunkNumber - b.chunkNumber);
  }

  async countChunks(sessionId: string): Promise<number> {
    return this.chunks.filter((c) => c.sessionId === sessionId).length;
  }

  async deleteSession(id: string): Promise<void> {
    for (const a of this.alerts) if (a.sessionId === id) a.sessionId = null;
    this.sessions.delete(id);
    for (const [k, c] of this.channels) if (c.sessionId === id) this.channels.delete(k);
    this.chunks = this.chunks.filter((c) => c.sessionId !== id);
    this.syncStates.delete(id);
    this.fallEvents = this.fallEvents.filter((f) => f.sessionId !== id);
  }

  /* ---- fall events ---- */
  fallEvents: FallEventRecord[] = [];

  alerts: AlertRecord[] = [];
  healthProfiles = new Map<string, HealthProfile>();

  /* Cloud bookkeeping per alert id — the SQLite store's cloud_* columns. */
  alertCloud = new Map<string, AlertCloudState>();

  async insertAlert(a: AlertRecord): Promise<void> {
    this.alerts.push({ ...a });
    this.alertCloud.set(a.id, { revision: 1, syncedRevision: 0, linkSettled: false });
  }

  async updateAlert(id: string, patch: { endedAt?: string | null; value?: number }): Promise<void> {
    const a = this.alerts.find((x) => x.id === id);
    if (!a || (patch.endedAt === undefined && patch.value === undefined)) return;
    if (patch.endedAt !== undefined) a.endedAt = patch.endedAt;
    if (patch.value !== undefined) a.value = patch.value;
    const c = this.alertCloud.get(id);
    if (c) c.revision += 1;
  }

  async listAlertsPendingCloud(userId: string, limit = 500): Promise<PendingCloudAlert[]> {
    const behind = (c: AlertCloudState) => c.revision > c.syncedRevision;
    return this.alerts
      .filter((a) => a.userId === userId && (a.kind === 'high' || a.kind === 'low') && a.sensorType != null)
      .map((a) => ({ alert: { ...a }, cloud: { ...(this.alertCloud.get(a.id) ?? { revision: 1, syncedRevision: 0, linkSettled: false }) } }))
      .filter(({ alert, cloud }) => behind(cloud) || (alert.sessionId != null && !cloud.linkSettled))
      .sort((x, y) => Number(behind(y.cloud)) - Number(behind(x.cloud)) || x.alert.startedAt.localeCompare(y.alert.startedAt))
      .slice(0, limit);
  }

  async markAlertsCloudSynced(marks: { id: string; revision: number; linkSettled: boolean }[]): Promise<void> {
    for (const m of marks) {
      const c = this.alertCloud.get(m.id);
      if (!c) continue;
      c.syncedRevision = Math.max(c.syncedRevision, m.revision);
      c.linkSettled = c.linkSettled || m.linkSettled;
    }
  }

  async listAlerts(userId: string, limit = 100): Promise<AlertRecord[]> {
    return this.alerts.filter((a) => a.userId === userId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map((a) => ({ ...a }));
  }

  async countUnseenAlerts(userId: string): Promise<number> {
    return this.alerts.filter((a) => a.userId === userId && !a.seen).length;
  }

  async markAlertsSeen(userId: string): Promise<void> {
    for (const a of this.alerts) if (a.userId === userId) a.seen = true;
  }

  async listSessionAlerts(sessionId: string): Promise<AlertRecord[]> {
    return this.alerts.filter((a) => a.sessionId === sessionId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((a) => ({ ...a }));
  }

  async deleteAlert(id: string, userId: string): Promise<void> {
    this.alerts = this.alerts.filter((a) => !(a.id === id && a.userId === userId));
    if (!this.alerts.some((a) => a.id === id)) this.alertCloud.delete(id);
  }

  async deleteAllAlerts(userId: string): Promise<void> {
    for (const a of this.alerts) if (a.userId === userId) this.alertCloud.delete(a.id);
    this.alerts = this.alerts.filter((a) => a.userId !== userId);
  }

  notifications: NotificationRecord[] = [];

  async insertNotification(n: NotificationRecord): Promise<void> {
    this.notifications.push({ ...n });
    const mine = this.notifications.filter((x) => x.userId === n.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const keep = new Set(mine.slice(0, 200).map((x) => x.id));
    this.notifications = this.notifications.filter((x) => x.userId !== n.userId || keep.has(x.id));
  }

  async listNotifications(userId: string, limit = 100): Promise<NotificationRecord[]> {
    return this.notifications.filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((n) => ({ ...n }));
  }

  async countUnseenNotifications(userId: string): Promise<number> {
    return this.notifications.filter((n) => n.userId === userId && !n.seen).length;
  }

  async markNotificationsSeen(userId: string): Promise<void> {
    for (const n of this.notifications) if (n.userId === userId) n.seen = true;
  }

  async deleteNotification(id: string, userId: string): Promise<void> {
    this.notifications = this.notifications.filter((n) => !(n.id === id && n.userId === userId));
  }

  async deleteAllNotifications(userId: string): Promise<void> {
    this.notifications = this.notifications.filter((n) => n.userId !== userId);
  }

  async getHealthProfile(userId: string): Promise<HealthProfile | null> {
    const p = this.healthProfiles.get(userId);
    return p ? { ...p } : null;
  }

  async saveHealthProfile(p: HealthProfile): Promise<void> { this.healthProfiles.set(p.userId, { ...p }); }

  async insertFallEvent(e: FallEventRecord): Promise<void> {
    this.fallEvents.push({ ...e });
  }

  async listFallEvents(sessionId: string): Promise<FallEventRecord[]> {
    return this.fallEvents.filter((f) => f.sessionId === sessionId).sort((a, b) => a.detectedAtMs - b.detectedAtMs);
  }

  async fallCountsForUser(userId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const f of this.fallEvents) {
      if (this.sessions.get(f.sessionId)?.userId === userId) out[f.sessionId] = (out[f.sessionId] ?? 0) + 1;
    }
    return out;
  }

  /* ---- device registry ---- */
  devices = new Map<string, DeviceRecord>();

  async upsertDevice(d: DeviceRecord): Promise<void> {
    const prior = this.devices.get(d.id);
    this.devices.set(d.id, prior
      ? { ...prior, userId: d.userId, displayName: d.displayName, model: d.model ?? prior.model, firmwareVersion: d.firmwareVersion ?? prior.firmwareVersion, preferredTransport: d.preferredTransport, address: d.address ?? prior.address, lastSeenAt: d.lastSeenAt }
      : { ...d });
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    return [...this.devices.values()].filter((d) => d.userId === userId).sort((a, b) =>
      (b.lastSeenAt ?? b.pairedAt).localeCompare(a.lastSeenAt ?? a.pairedAt));
  }

  async renameDevice(id: string, userId: string, name: string | null): Promise<void> {
    const d = this.devices.get(id);
    if (d && d.userId === userId) this.devices.set(id, { ...d, customName: name?.trim() ? name.trim() : null });
  }

  async deleteDevice(id: string, userId: string): Promise<void> {
    if (this.devices.get(id)?.userId === userId) this.devices.delete(id);
  }

  async listSessionsPendingSync(userId: string): Promise<Session[]> {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && FINISHED.includes(s.status) && this.syncStates.get(s.id)?.status !== 'synced')
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)); // oldest first
  }

  async getSyncState(sessionId: string): Promise<SyncState | null> {
    return this.syncStates.get(sessionId) ?? null;
  }

  async upsertSyncState(state: SyncState): Promise<void> {
    this.syncStates.set(state.sessionId, { ...state, uploadedChannelIds: [...state.uploadedChannelIds] });
  }

  async countPendingSync(userId: string): Promise<number> {
    return (await this.listSessionsPendingSync(userId)).length;
  }
}
