import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';
import type { SensorType } from '@wearwise/sensor-protocol';
import type { SessionStore, NewSession, NewChannel, SessionSummaryRow } from '@/domain/repositories/session-store';
import type {
  Session, SessionChannel, SampleChunk, ChannelSummary, SessionStatus, RecoveryState, SessionConfiguration, SyncState, DeviceRecord, TransportType,
  FallEventRecord, FallStatus, AlertRecord, AlertKind, HealthProfile, Sex, BloodGroup, NotificationRecord, NotificationKind,
  PendingCloudAlert,
} from '@/domain/entities/session';

/* SQLCipher-backed SessionStore (op-sqlite built with OP_SQLITE_USE_SQLCIPHER).
 *
 * Schema follows build-instruction §14. Two choices worth stating:
 *
 *  - Chunk payloads are BLOBs of raw int16 LE samples — what came off the wire.
 *    Nothing is re-encoded on the way in, so a chunk can be checksum-verified
 *    against exactly what the device sent.
 *  - Microsecond timestamps are stored as TEXT (decimal string), not INTEGER:
 *    they are u64 and SQLite INTEGER is signed 64-bit, which is fine today but
 *    would silently corrupt the top bit. TEXT round-trips BigInt exactly.
 *
 * Migrations are numbered and applied in a transaction; `app_metadata` holds the
 * schema version. Adding a migration = appending to MIGRATIONS, never editing one
 * that shipped.
 */

const MIGRATIONS: string[] = [
  /* v1 */ `
  create table if not exists app_metadata (
    key text primary key,
    value text not null
  );
  create table if not exists devices (
    id text primary key,
    display_name text not null,
    model text,
    firmware_version text,
    preferred_transport text,
    paired_at text not null,
    last_seen_at text
  );
  create table if not exists device_capabilities (
    device_id text not null references devices(id) on delete cascade,
    sensor_type integer not null,
    sample_rate_hz integer not null,
    unit text not null,
    primary key (device_id, sensor_type)
  );
  create table if not exists sessions (
    id text primary key,
    user_id text not null,
    device_id text not null,
    started_at text not null,
    ended_at text,
    duration_ms integer,
    status text not null check (status in ('recording','complete','interrupted','discarded')),
    simulated integer not null default 0,
    initial_transport text not null,
    final_transport text not null,
    transport_switch_count integer not null default 0,
    configuration_snapshot text not null,
    recovery_state text,
    created_at text not null,
    updated_at text not null
  );
  create index if not exists sessions_user_started on sessions(user_id, started_at desc);
  create index if not exists sessions_status on sessions(status);
  create table if not exists session_channels (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    sensor_type integer not null,
    canonical_unit text not null,
    sample_rate integer not null,
    sample_count integer not null default 0,
    minimum_value real,
    maximum_value real,
    average_value real,
    first_timestamp text,
    last_timestamp text
  );
  create index if not exists channels_session on session_channels(session_id);
  create table if not exists sample_chunks (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    channel_id text not null references session_channels(id) on delete cascade,
    chunk_number integer not null,
    first_sequence integer not null,
    last_sequence integer not null,
    started_at text not null,
    ended_at text not null,
    sample_count integer not null,
    encoding text not null,
    payload blob not null,
    checksum integer not null,
    created_at text not null,
    unique (channel_id, chunk_number)
  );
  create index if not exists chunks_session on sample_chunks(session_id);
  create table if not exists sync_queue (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    operation text not null,
    state text not null,
    attempt_count integer not null default 0,
    next_attempt_at text,
    last_attempt_at text,
    last_error_code text,
    last_error_message_safe text,
    created_at text not null,
    updated_at text not null
  );
  create table if not exists connection_events (
    id integer primary key autoincrement,
    session_id text,
    at text not null,
    transport text,
    state text not null,
    detail text
  );
  insert or replace into app_metadata (key, value) values ('schema_version', '1');
  `,
  // v2 — per-session cloud-sync state (Milestone 6).
  `
  create table if not exists session_sync (
    session_id text primary key references sessions(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending','uploading','synced','failed')),
    uploaded_channels text not null default '[]',
    attempts integer not null default 0,
    last_error text,
    synced_at text,
    updated_at text not null
  );
  create index if not exists session_sync_status on session_sync(status);
  insert or replace into app_metadata (key, value) values ('schema_version', '2');
  `,
  // v3 — device reconnect address (the transport-specific handle: BLE peripheralId,
  // sim address). Needed to reconnect a remembered device from the Devices screen.
  `
  alter table devices add column address text;
  insert or replace into app_metadata (key, value) values ('schema_version', '3');
  `,
  // v4 — fall events. Each confirmed fall during a session; cascades with the session.
  `
  create table if not exists fall_events (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    detected_at_ms integer not null,
    freefall_min_g real not null,
    impact_peak_g real not null,
    status text not null check (status in ('emergency','cancelled')),
    created_at text not null
  );
  create index if not exists fall_events_session on fall_events(session_id);
  insert or replace into app_metadata (key, value) values ('schema_version', '4');
  `,
  // v5: unowned legacy device metadata stays hidden until explicitly paired again.
  `
  alter table devices add column user_id text;
  create index if not exists devices_user on devices(user_id);
  insert or replace into app_metadata (key, value) values ('schema_version', '5');
  `,
  // v6: the participant's own name for a device, kept apart from the advertised
  // display_name that every reconnect refreshes.
  `
  alter table devices add column custom_name text;
  insert or replace into app_metadata (key, value) values ('schema_version', '6');
  `,
  // v7: abnormal-reading alerts (session optional: live preview has none) and the
  // participant's basic health profile.
  `
  create table if not exists alerts (
    id text primary key,
    user_id text not null,
    session_id text references sessions(id) on delete set null,
    device_id text,
    sensor_type integer,
    kind text not null check (kind in ('high','low','fall')),
    value real not null,
    started_at text not null,
    ended_at text,
    seen integer not null default 0
  );
  create index if not exists alerts_user_started on alerts(user_id, started_at);
  create index if not exists alerts_session on alerts(session_id);
  create table if not exists health_profile (
    user_id text primary key,
    sex text,
    date_of_birth text,
    height_cm real,
    weight_kg real,
    blood_group text,
    updated_at text not null
  );
  insert or replace into app_metadata (key, value) values ('schema_version', '7');
  `,
  // v8: the notifications list (app events behind the bell).
  `
  create table if not exists notifications (
    id text primary key,
    user_id text not null,
    kind text not null,
    title text not null,
    body text not null,
    route text,
    created_at text not null,
    seen integer not null default 0
  );
  create index if not exists notifications_user_created on notifications(user_id, created_at);
  insert or replace into app_metadata (key, value) values ('schema_version', '8');
  `,
  // v9: cloud copies of vital alerts (public.vital_alerts). cloud_revision counts local
  // changes and cloud_synced_revision is the last one uploaded, so alerts recorded before
  // this version (synced 0) are uploaded once too. cloud_link_settled: the cloud row has
  // its session link, or never will.
  `
  alter table alerts add column cloud_revision integer not null default 1;
  alter table alerts add column cloud_synced_revision integer not null default 0;
  alter table alerts add column cloud_link_settled integer not null default 0;
  insert or replace into app_metadata (key, value) values ('schema_version', '9');
  `,
];

const now = () => new Date().toISOString();
const bigOrNull = (v: unknown): bigint | null => (v == null ? null : BigInt(String(v)));
const bigToText = (v: bigint | null): Scalar => (v == null ? null : v.toString());

export class SqliteSessionStore implements SessionStore {
  private constructor(private db: DB) {}

  /* Opens (creating on first run) the encrypted database and applies migrations.
     Throws if the key is wrong or the file is not a SQLCipher database — the
     caller decides what "cannot open" means for the UI; this never falls back. */
  static async open(encryptionKey: string, name = 'wearwise.db'): Promise<SqliteSessionStore> {
    const db = open({ name, encryptionKey });
    /* SQLCipher: a wrong key surfaces as "file is not a database" on first read. */
    await db.execute('pragma journal_mode = wal');
    await db.execute('pragma foreign_keys = on');
    const store = new SqliteSessionStore(db);
    await store.migrate();
    return store;
  }

  private async migrate(): Promise<void> {
    await this.db.execute('create table if not exists app_metadata (key text primary key, value text not null)');
    const r = await this.db.execute(`select value from app_metadata where key = 'schema_version'`);
    const current = Number((r.rows?.[0] as { value?: string } | undefined)?.value ?? 0);
    for (let v = current; v < MIGRATIONS.length; v++) {
      await this.db.transaction(async (tx) => {
        for (const stmt of MIGRATIONS[v]!.split(';').map((s) => s.trim()).filter(Boolean)) {
          await tx.execute(stmt);
        }
      });
    }
  }

  /* Encryption proof for the compatibility spike and the test matrix: the raw
     file must NOT contain the SQLite header. */
  path(): string { return this.db.getDbPath(); }

  async createSession(s: NewSession): Promise<void> {
    const t = now();
    await this.db.execute(
      `insert into sessions (id, user_id, device_id, started_at, status, simulated, initial_transport, final_transport,
         transport_switch_count, configuration_snapshot, created_at, updated_at)
       values (?, ?, ?, ?, 'recording', ?, ?, ?, 0, ?, ?, ?)`,
      [s.id, s.userId, s.deviceId, s.startedAt, s.simulated ? 1 : 0, s.initialTransport, s.initialTransport,
        JSON.stringify(s.configurationSnapshot), t, t],
    );
  }

  async createChannel(c: NewChannel): Promise<void> {
    await this.db.execute(
      `insert into session_channels (id, session_id, sensor_type, canonical_unit, sample_rate) values (?, ?, ?, ?, ?)`,
      [c.id, c.sessionId, c.sensorType, c.canonicalUnit, c.sampleRateHz],
    );
  }

  async appendChunk(c: Omit<SampleChunk, 'createdAt'>): Promise<void> {
    /* Slice to a standalone ArrayBuffer: op-sqlite binds the whole underlying
       buffer, and a view into a larger one would store the neighbours too. */
    const payload = c.payload.buffer.slice(c.payload.byteOffset, c.payload.byteOffset + c.payload.byteLength) as ArrayBuffer;
    await this.db.execute(
      `insert into sample_chunks (id, session_id, channel_id, chunk_number, first_sequence, last_sequence, started_at, ended_at,
         sample_count, encoding, payload, checksum, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.sessionId, c.channelId, c.chunkNumber, c.firstSequence, c.lastSequence,
        bigToText(c.startedAtUs), bigToText(c.endedAtUs), c.sampleCount, c.encoding, payload, c.checksum, now()],
    );
  }

  async updateChannelSummary(channelId: string, s: ChannelSummary): Promise<void> {
    const has = s.sampleCount > 0;
    await this.db.execute(
      `update session_channels set sample_count = ?, minimum_value = ?, maximum_value = ?, average_value = ?,
         first_timestamp = ?, last_timestamp = ? where id = ?`,
      [s.sampleCount, has ? s.min : null, has ? s.max : null, has ? s.sum / s.sampleCount : null,
        bigToText(s.firstTimestampUs), bigToText(s.lastTimestampUs), channelId],
    );
  }

  async closeSession(id: string, p: Parameters<SessionStore['closeSession']>[1]): Promise<void> {
    /* COALESCE keeps the existing value when the caller omits `simulated`; when
       provided it wins, so a session that carried any simulated packet is marked
       simulated even though its transport was real BLE. */
    await this.db.execute(
      `update sessions set ended_at = ?, duration_ms = ?, status = ?, final_transport = ?, transport_switch_count = ?,
         simulated = COALESCE(?, simulated), updated_at = ?
       where id = ?`,
      [p.endedAt, p.durationMs, p.status, p.finalTransport, p.transportSwitchCount,
       p.simulated == null ? null : p.simulated ? 1 : 0, now(), id],
    );
  }

  async findUnfinishedSessions(userId: string): Promise<Session[]> {
    const r = await this.db.execute(`select * from sessions where user_id = ? and status = 'recording' order by started_at`, [userId]);
    return (r.rows ?? []).map(rowToSession);
  }

  async markInterrupted(id: string, recovery: RecoveryState): Promise<void> {
    await this.db.execute(`update sessions set status = 'interrupted', recovery_state = ?, updated_at = ? where id = ?`,
      [JSON.stringify(recovery), now(), id]);
  }

  async setStatus(id: string, status: SessionStatus): Promise<void> {
    await this.db.execute(`update sessions set status = ?, updated_at = ? where id = ?`, [status, now(), id]);
  }

  async listSessions(userId: string, limit = 100): Promise<SessionSummaryRow[]> {
    const r = await this.db.execute(
      `select * from sessions where user_id = ? and status != 'discarded' order by started_at desc limit ?`, [userId, limit]);
    const sessions = (r.rows ?? []).map(rowToSession);
    if (!sessions.length) return [];
    const ids = sessions.map((s) => s.id);
    const c = await this.db.execute(
      `select * from session_channels where session_id in (${ids.map(() => '?').join(',')})`, ids);
    const channels = (c.rows ?? []).map(rowToChannel);
    return sessions.map((session) => ({ session, channels: channels.filter((ch) => ch.sessionId === session.id) }));
  }

  async getSession(id: string): Promise<SessionSummaryRow | null> {
    const r = await this.db.execute(`select * from sessions where id = ?`, [id]);
    const row = r.rows?.[0];
    if (!row) return null;
    const c = await this.db.execute(`select * from session_channels where session_id = ?`, [id]);
    return { session: rowToSession(row), channels: (c.rows ?? []).map(rowToChannel) };
  }

  async listChunks(sessionId: string, channelId: string): Promise<SampleChunk[]> {
    const r = await this.db.execute(
      `select * from sample_chunks where session_id = ? and channel_id = ? order by chunk_number`, [sessionId, channelId]);
    return (r.rows ?? []).map(rowToChunk);
  }

  async countChunks(sessionId: string): Promise<number> {
    const r = await this.db.execute(`select count(*) as n from sample_chunks where session_id = ?`, [sessionId]);
    return Number((r.rows?.[0] as { n?: number } | undefined)?.n ?? 0);
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.execute(`delete from sessions where id = ?`, [id]); // cascades
  }

  /* ---- alerts ---- */

  async insertAlert(a: AlertRecord): Promise<void> {
    await this.db.execute(
      `insert into alerts (id, user_id, session_id, device_id, sensor_type, kind, value, started_at, ended_at, seen)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.userId, a.sessionId, a.deviceId, a.sensorType, a.kind, a.value, a.startedAt, a.endedAt, a.seen ? 1 : 0],
    );
  }

  async updateAlert(id: string, patch: { endedAt?: string | null; value?: number }): Promise<void> {
    /* One statement, one revision: the cloud copy is now behind. */
    const sets: string[] = [];
    const args: Scalar[] = [];
    if (patch.endedAt !== undefined) { sets.push('ended_at = ?'); args.push(patch.endedAt); }
    if (patch.value !== undefined) { sets.push('value = ?'); args.push(patch.value); }
    if (!sets.length) return;
    await this.db.execute(`update alerts set ${sets.join(', ')}, cloud_revision = cloud_revision + 1 where id = ?`, [...args, id]);
  }

  async listAlerts(userId: string, limit = 100): Promise<AlertRecord[]> {
    const r = await this.db.execute(`select * from alerts where user_id = ? order by started_at desc limit ?`, [userId, limit]);
    return (r.rows ?? []).map(rowToAlert);
  }

  async countUnseenAlerts(userId: string): Promise<number> {
    const r = await this.db.execute(`select count(*) as n from alerts where user_id = ? and seen = 0`, [userId]);
    return Number((r.rows?.[0] as { n?: number } | undefined)?.n ?? 0);
  }

  async markAlertsSeen(userId: string): Promise<void> {
    await this.db.execute(`update alerts set seen = 1 where user_id = ? and seen = 0`, [userId]);
  }

  async listSessionAlerts(sessionId: string): Promise<AlertRecord[]> {
    const r = await this.db.execute(`select * from alerts where session_id = ? order by started_at`, [sessionId]);
    return (r.rows ?? []).map(rowToAlert);
  }

  async deleteAlert(id: string, userId: string): Promise<void> {
    await this.db.execute(`delete from alerts where id = ? and user_id = ?`, [id, userId]);
  }

  async deleteAllAlerts(userId: string): Promise<void> {
    await this.db.execute(`delete from alerts where user_id = ?`, [userId]);
  }

  async listAlertsPendingCloud(userId: string, limit = 500): Promise<PendingCloudAlert[]> {
    const r = await this.db.execute(
      `select * from alerts
        where user_id = ? and kind in ('high','low') and sensor_type is not null
          and (cloud_revision > cloud_synced_revision or (session_id is not null and cloud_link_settled = 0))
        order by (cloud_revision > cloud_synced_revision) desc, started_at asc
        limit ?`,
      [userId, limit],
    );
    return (r.rows ?? []).map((row) => {
      const x = row as Row;
      return {
        alert: rowToAlert(x),
        cloud: {
          revision: Number(x.cloud_revision ?? 1), syncedRevision: Number(x.cloud_synced_revision ?? 0),
          linkSettled: Number(x.cloud_link_settled) === 1,
        },
      };
    });
  }

  async markAlertsCloudSynced(marks: { id: string; revision: number; linkSettled: boolean }[]): Promise<void> {
    if (!marks.length) return;
    await this.db.transaction(async (tx) => {
      for (const m of marks) {
        await tx.execute(
          `update alerts set cloud_synced_revision = max(cloud_synced_revision, ?),
             cloud_link_settled = max(cloud_link_settled, ?) where id = ?`,
          [m.revision, m.linkSettled ? 1 : 0, m.id],
        );
      }
    });
  }

  /* ---- notifications ---- */

  async insertNotification(n: NotificationRecord): Promise<void> {
    await this.db.execute(
      `insert into notifications (id, user_id, kind, title, body, route, created_at, seen) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [n.id, n.userId, n.kind, n.title, n.body, n.route, n.createdAt, n.seen ? 1 : 0],
    );
    /* Keep the list bounded: the newest 200 per user. */
    await this.db.execute(
      `delete from notifications where user_id = ? and id not in
         (select id from notifications where user_id = ? order by created_at desc limit 200)`,
      [n.userId, n.userId],
    );
  }

  async listNotifications(userId: string, limit = 100): Promise<NotificationRecord[]> {
    const r = await this.db.execute(`select * from notifications where user_id = ? order by created_at desc limit ?`, [userId, limit]);
    return (r.rows ?? []).map((row) => {
      const x = row as Row;
      return {
        id: String(x.id), userId: String(x.user_id), kind: String(x.kind) as NotificationKind,
        title: String(x.title), body: String(x.body), route: x.route == null ? null : String(x.route),
        createdAt: String(x.created_at), seen: Number(x.seen) === 1,
      };
    });
  }

  async countUnseenNotifications(userId: string): Promise<number> {
    const r = await this.db.execute(`select count(*) as n from notifications where user_id = ? and seen = 0`, [userId]);
    return Number((r.rows?.[0] as { n?: number } | undefined)?.n ?? 0);
  }

  async markNotificationsSeen(userId: string): Promise<void> {
    await this.db.execute(`update notifications set seen = 1 where user_id = ? and seen = 0`, [userId]);
  }

  async deleteNotification(id: string, userId: string): Promise<void> {
    await this.db.execute(`delete from notifications where id = ? and user_id = ?`, [id, userId]);
  }

  async deleteAllNotifications(userId: string): Promise<void> {
    await this.db.execute(`delete from notifications where user_id = ?`, [userId]);
  }

  /* ---- health profile ---- */

  async getHealthProfile(userId: string): Promise<HealthProfile | null> {
    const r = await this.db.execute(`select * from health_profile where user_id = ?`, [userId]);
    const row = r.rows?.[0] as Row | undefined;
    if (!row) return null;
    return {
      userId: String(row.user_id),
      sex: row.sex == null ? null : (String(row.sex) as Sex),
      dateOfBirth: row.date_of_birth == null ? null : String(row.date_of_birth),
      heightCm: row.height_cm == null ? null : Number(row.height_cm),
      weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
      bloodGroup: row.blood_group == null ? null : (String(row.blood_group) as BloodGroup),
      updatedAt: String(row.updated_at),
    };
  }

  async saveHealthProfile(p: HealthProfile): Promise<void> {
    await this.db.execute(
      `insert into health_profile (user_id, sex, date_of_birth, height_cm, weight_kg, blood_group, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)
       on conflict(user_id) do update set
         sex = excluded.sex, date_of_birth = excluded.date_of_birth, height_cm = excluded.height_cm,
         weight_kg = excluded.weight_kg, blood_group = excluded.blood_group, updated_at = excluded.updated_at`,
      [p.userId, p.sex, p.dateOfBirth, p.heightCm, p.weightKg, p.bloodGroup, p.updatedAt],
    );
  }

  /* ---- fall events ---- */

  async insertFallEvent(e: FallEventRecord): Promise<void> {
    await this.db.execute(
      `insert into fall_events (id, session_id, detected_at_ms, freefall_min_g, impact_peak_g, status, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      [e.id, e.sessionId, e.detectedAtMs, e.freefallMinG, e.impactPeakG, e.status, e.createdAt],
    );
  }

  async listFallEvents(sessionId: string): Promise<FallEventRecord[]> {
    const r = await this.db.execute(`select * from fall_events where session_id = ? order by detected_at_ms`, [sessionId]);
    return (r.rows ?? []).map(rowToFallEvent);
  }

  async fallCountsForUser(userId: string): Promise<Record<string, number>> {
    const r = await this.db.execute(
      `select f.session_id as sid, count(*) as n
         from fall_events f join sessions s on s.id = f.session_id
        where s.user_id = ?
        group by f.session_id`,
      [userId],
    );
    const out: Record<string, number> = {};
    for (const row of r.rows ?? []) out[String((row as Row).sid)] = Number((row as Row).n);
    return out;
  }

  /* ---- device registry ---- */

  async upsertDevice(d: DeviceRecord): Promise<void> {
    await this.db.execute(
      `insert into devices (id, display_name, model, firmware_version, preferred_transport, address, paired_at, last_seen_at, user_id)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         user_id = excluded.user_id,
         display_name = excluded.display_name,
         model = coalesce(excluded.model, devices.model),
         firmware_version = coalesce(excluded.firmware_version, devices.firmware_version),
         preferred_transport = excluded.preferred_transport,
         address = coalesce(excluded.address, devices.address),
         last_seen_at = excluded.last_seen_at`,
      [d.id, d.displayName, d.model, d.firmwareVersion, d.preferredTransport, d.address, d.pairedAt, d.lastSeenAt, d.userId ?? null],
    );
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    const r = await this.db.execute(`select * from devices where user_id = ? order by coalesce(last_seen_at, paired_at) desc`, [userId]);
    return (r.rows ?? []).map(rowToDevice);
  }

  async renameDevice(id: string, userId: string, name: string | null): Promise<void> {
    const value = name?.trim() ? name.trim() : null;
    await this.db.execute(`update devices set custom_name = ? where id = ? and user_id = ?`, [value, id, userId]);
  }

  async deleteDevice(id: string, userId: string): Promise<void> {
    /* device_capabilities cascades; sessions.device_id is a plain column, so
       recorded sessions are untouched. */
    await this.db.execute(`delete from devices where id = ? and user_id = ?`, [id, userId]);
  }

  /* ---- cloud-sync state (Milestone 6) ---- */

  async listSessionsPendingSync(userId: string): Promise<Session[]> {
    /* Finished sessions with no sync row, or a sync row not yet 'synced'. */
    const r = await this.db.execute(
      `select s.* from sessions s
         left join session_sync ss on ss.session_id = s.id
        where s.user_id = ?
          and s.status in ('complete','interrupted')
          and (ss.status is null or ss.status != 'synced')
        order by s.started_at asc`,
      [userId],
    );
    return (r.rows ?? []).map(rowToSession);
  }

  async getSyncState(sessionId: string): Promise<SyncState | null> {
    const r = await this.db.execute(`select * from session_sync where session_id = ?`, [sessionId]);
    const row = r.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      sessionId: String(row.session_id),
      status: String(row.status) as SyncState['status'],
      uploadedChannelIds: JSON.parse(String(row.uploaded_channels ?? '[]')) as string[],
      attempts: Number(row.attempts ?? 0),
      lastError: row.last_error == null ? null : String(row.last_error),
      syncedAt: row.synced_at == null ? null : String(row.synced_at),
      updatedAt: String(row.updated_at),
    };
  }

  async upsertSyncState(state: SyncState): Promise<void> {
    await this.db.execute(
      `insert into session_sync (session_id, status, uploaded_channels, attempts, last_error, synced_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict(session_id) do update set
         status = excluded.status, uploaded_channels = excluded.uploaded_channels,
         attempts = excluded.attempts, last_error = excluded.last_error,
         synced_at = excluded.synced_at, updated_at = excluded.updated_at`,
      [state.sessionId, state.status, JSON.stringify(state.uploadedChannelIds), state.attempts,
       state.lastError, state.syncedAt, state.updatedAt],
    );
  }

  async countPendingSync(userId: string): Promise<number> {
    const r = await this.db.execute(
      `select count(*) as n from sessions s
         left join session_sync ss on ss.session_id = s.id
        where s.user_id = ? and s.status in ('complete','interrupted')
          and (ss.status is null or ss.status != 'synced')`,
      [userId],
    );
    return Number((r.rows?.[0] as { n?: number } | undefined)?.n ?? 0);
  }
}

/* ---- row mappers: the only place column names meet entity fields ---- */
type Row = Record<string, unknown>;

function rowToSession(r: Row): Session {
  return {
    id: String(r.id), userId: String(r.user_id), deviceId: String(r.device_id),
    startedAt: String(r.started_at), endedAt: r.ended_at == null ? null : String(r.ended_at),
    durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
    status: r.status as SessionStatus, simulated: Number(r.simulated) === 1,
    initialTransport: r.initial_transport as Session['initialTransport'],
    finalTransport: r.final_transport as Session['finalTransport'],
    transportSwitchCount: Number(r.transport_switch_count),
    configurationSnapshot: JSON.parse(String(r.configuration_snapshot)) as SessionConfiguration,
    recoveryState: r.recovery_state == null ? null : (JSON.parse(String(r.recovery_state)) as RecoveryState),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

function rowToDevice(r: Row): DeviceRecord {
  return {
    userId: r.user_id == null ? undefined : String(r.user_id),
    id: String(r.id), displayName: String(r.display_name),
    customName: r.custom_name == null ? null : String(r.custom_name),
    model: r.model == null ? null : String(r.model),
    firmwareVersion: r.firmware_version == null ? null : String(r.firmware_version),
    preferredTransport: r.preferred_transport == null ? null : (String(r.preferred_transport) as TransportType),
    address: r.address == null ? null : String(r.address),
    pairedAt: String(r.paired_at), lastSeenAt: r.last_seen_at == null ? null : String(r.last_seen_at),
  };
}

function rowToAlert(r: Row): AlertRecord {
  return {
    id: String(r.id), userId: String(r.user_id),
    sessionId: r.session_id == null ? null : String(r.session_id),
    deviceId: r.device_id == null ? null : String(r.device_id),
    sensorType: r.sensor_type == null ? null : (Number(r.sensor_type) as SensorType),
    kind: String(r.kind) as AlertKind, value: Number(r.value),
    startedAt: String(r.started_at), endedAt: r.ended_at == null ? null : String(r.ended_at),
    seen: Number(r.seen) === 1,
  };
}

function rowToFallEvent(r: Row): FallEventRecord {
  return {
    id: String(r.id), sessionId: String(r.session_id),
    detectedAtMs: Number(r.detected_at_ms),
    freefallMinG: Number(r.freefall_min_g), impactPeakG: Number(r.impact_peak_g),
    status: String(r.status) as FallStatus, createdAt: String(r.created_at),
  };
}

function rowToChannel(r: Row): SessionChannel {
  return {
    id: String(r.id), sessionId: String(r.session_id), sensorType: Number(r.sensor_type) as SensorType,
    canonicalUnit: String(r.canonical_unit), sampleRateHz: Number(r.sample_rate), sampleCount: Number(r.sample_count),
    minimumValue: r.minimum_value == null ? null : Number(r.minimum_value),
    maximumValue: r.maximum_value == null ? null : Number(r.maximum_value),
    averageValue: r.average_value == null ? null : Number(r.average_value),
    firstTimestampUs: bigOrNull(r.first_timestamp), lastTimestampUs: bigOrNull(r.last_timestamp),
  };
}

function rowToChunk(r: Row): SampleChunk {
  const raw = r.payload as ArrayBuffer | Uint8Array;
  return {
    id: String(r.id), sessionId: String(r.session_id), channelId: String(r.channel_id),
    chunkNumber: Number(r.chunk_number), firstSequence: Number(r.first_sequence), lastSequence: Number(r.last_sequence),
    startedAtUs: BigInt(String(r.started_at)), endedAtUs: BigInt(String(r.ended_at)),
    sampleCount: Number(r.sample_count), encoding: 'int16le-v1',
    payload: raw instanceof Uint8Array ? raw : new Uint8Array(raw),
    checksum: Number(r.checksum), createdAt: String(r.created_at),
  };
}
