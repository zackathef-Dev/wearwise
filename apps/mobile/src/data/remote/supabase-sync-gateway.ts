import type { SupabaseClient } from '@supabase/supabase-js';
import type { Session, SessionChannel, FallEventRecord } from '@/domain/entities/session';
import type { SyncGateway, RemoteChannelRow, RemoteVitalAlert, VitalAlertsResult } from '@/domain/repositories/sync-gateway';
import type { SensorType } from '@wearwise/sensor-protocol';
import { supabase } from './supabase-client';
import { base64ToBytes } from '@/data/ble/base64';

/* Supabase implementation of the sync port.
 *
 * Metadata → Postgres (recorded_sessions / recorded_channels), sample bytes →
 * Storage (bucket 'recordings'). Every write is an UPSERT keyed by the row's UUID
 * or the object path, so a retried or resumed sync never duplicates. RLS on the
 * server is the real guard: these calls carry the participant's JWT and can only
 * write rows and objects under their own id.
 */

const BUCKET = 'recordings';

/* PostgREST / Postgres codes for "that table does not exist" — the fall_events
   migration not yet applied to this project. */
const missingTable = (code: string | undefined) => code === 'PGRST205' || code === '42P01';

/* Row-level security said no (42501), or a linked row the server doesn't have (23503). */
const refusedWrite = (code: string | undefined) => code === '42501' || code === '23503';

/* React Native's Blob has no arrayBuffer(); FileReader.readAsDataURL is the one
   reader it reliably implements, so decode through base64 when needed. */
async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Cloud recording could not be read.'));
    reader.readAsDataURL(blob);
  });
  return base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

const big = (v: unknown): bigint | null => (v == null ? null : BigInt(String(v)));

const toSession = (r: any): Session => ({
  id: r.id, userId: r.user_id, deviceId: r.device_id, startedAt: r.started_at, endedAt: r.ended_at,
  durationMs: r.duration_ms == null ? null : Number(r.duration_ms), status: r.status, simulated: !!r.simulated,
  initialTransport: r.initial_transport, finalTransport: r.final_transport,
  transportSwitchCount: Number(r.transport_switch_count ?? 0), configurationSnapshot: r.configuration_snapshot,
  recoveryState: r.recovery_state ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});

const toFall = (r: any): FallEventRecord => ({
  id: r.id, sessionId: r.session_id, detectedAtMs: Number(r.detected_at_ms), freefallMinG: Number(r.freefall_min_g),
  impactPeakG: Number(r.impact_peak_g), status: r.status, createdAt: r.created_at,
});

export class SupabaseSyncGateway implements SyncGateway {
  constructor(private client: SupabaseClient | null = supabase) {}

  isConfigured(): boolean {
    return this.client != null;
  }

  private require(): SupabaseClient {
    if (!this.client) throw new Error('backend not configured');
    return this.client;
  }

  async putSession(session: Session): Promise<void> {
    const { error } = await this.require()
      .from('recorded_sessions')
      .upsert({
        id: session.id,
        user_id: session.userId,
        // user_id is defaulted to auth.uid() server-side; RLS pins it either way.
        device_id: session.deviceId,
        started_at: session.startedAt,
        ended_at: session.endedAt,
        duration_ms: session.durationMs,
        status: session.status,
        simulated: session.simulated,
        initial_transport: session.initialTransport,
        final_transport: session.finalTransport,
        transport_switch_count: session.transportSwitchCount,
        configuration_snapshot: session.configurationSnapshot,
        recovery_state: session.recoveryState,
      }, { onConflict: 'id' });
    if (error) throw new Error('Cloud session could not be saved. Please try again.');
  }

  async putChannelPayload(path: string, bytes: Uint8Array): Promise<void> {
    /* Slice to a standalone ArrayBuffer — supabase-js/Storage wants a buffer it
       owns, and a subarray view could carry the whole backing store. */
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const { error } = await this.require()
      .storage.from(BUCKET)
      .upload(path, body, { contentType: 'application/octet-stream', upsert: true, cacheControl: '0' });
    if (error) throw new Error('Cloud recording upload failed. Please try again.');
  }

  async putChannel(channel: SessionChannel, path: string): Promise<void> {
    const { error } = await this.require()
      .from('recorded_channels')
      .upsert({
        id: channel.id,
        user_id: path.split('/')[0],
        session_id: channel.sessionId,
        sensor_type: channel.sensorType,
        canonical_unit: channel.canonicalUnit,
        sample_rate_hz: channel.sampleRateHz,
        sample_count: channel.sampleCount,
        minimum_value: channel.minimumValue,
        maximum_value: channel.maximumValue,
        average_value: channel.averageValue,
        first_timestamp_us: channel.firstTimestampUs == null ? null : channel.firstTimestampUs.toString(),
        last_timestamp_us: channel.lastTimestampUs == null ? null : channel.lastTimestampUs.toString(),
        storage_path: path,
      }, { onConflict: 'id' });
    if (error) throw new Error('Cloud channel could not be saved. Please try again.');
  }

  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const client = this.require();
    const failed = new Error('The cloud copy could not be deleted. Check your connection and try again.');
    /* Payloads first: if the row went first and this failed, the objects would be
       orphaned with nothing left pointing at them. */
    const folder = `${userId}/${sessionId}`;
    const { data: objects, error: listError } = await client.storage.from(BUCKET).list(folder, { limit: 1000 });
    if (listError) throw failed;
    if (objects && objects.length) {
      const { error } = await client.storage.from(BUCKET).remove(objects.map((o) => `${folder}/${o.name}`));
      if (error) throw failed;
    }
    const { error } = await client.from('recorded_sessions').delete().eq('id', sessionId);
    if (error) throw failed;
  }

  async putFallEvents(userId: string, events: FallEventRecord[]): Promise<'ok' | 'unavailable'> {
    if (!events.length) return 'ok';
    const { error } = await this.require()
      .from('fall_events')
      .upsert(events.map((e) => ({
        id: e.id, user_id: userId, session_id: e.sessionId, detected_at_ms: e.detectedAtMs,
        freefall_min_g: e.freefallMinG, impact_peak_g: e.impactPeakG, status: e.status, created_at: e.createdAt,
      })), { onConflict: 'id' });
    if (error && missingTable(error.code)) return 'unavailable';
    if (error) throw new Error('Cloud fall record could not be saved. Please try again.');
    return 'ok';
  }

  async putVitalAlerts(userId: string, alerts: RemoteVitalAlert[]): Promise<VitalAlertsResult> {
    if (!alerts.length) return 'ok';
    /* The contract's columns only: created_at/updated_at are the server's, and
       sending them is refused. */
    const { error, status } = await this.require()
      .from('vital_alerts')
      .upsert(alerts.map(({ alert: a, sessionId }) => ({
        id: a.id, user_id: userId, session_id: sessionId, sensor_type: a.sensorType, kind: a.kind,
        value: a.value, started_at: a.startedAt, ended_at: a.endedAt,
      })), { onConflict: 'id' });
    if (error && (missingTable(error.code) || status === 404)) return 'unavailable';
    if (error && refusedWrite(error.code)) return 'refused';
    if (error) throw new Error('Cloud alerts could not be saved. Please try again.');
    return 'ok';
  }

  async listRemoteSessions(): Promise<Session[]> {
    const { data, error } = await this.require()
      .from('recorded_sessions').select('*').order('started_at', { ascending: false }).limit(500);
    if (error) throw new Error('Cloud sessions could not be loaded.');
    return (data ?? []).map(toSession);
  }

  async listRemoteChannels(sessionId: string): Promise<RemoteChannelRow[]> {
    const { data, error } = await this.require()
      .from('recorded_channels').select('*').eq('session_id', sessionId);
    if (error) throw new Error('Cloud channels could not be loaded.');
    return (data ?? []).map((r) => ({
      storagePath: String(r.storage_path),
      channel: {
        id: r.id, sessionId: r.session_id, sensorType: Number(r.sensor_type) as SensorType,
        canonicalUnit: r.canonical_unit, sampleRateHz: Number(r.sample_rate_hz), sampleCount: Number(r.sample_count ?? 0),
        minimumValue: r.minimum_value, maximumValue: r.maximum_value, averageValue: r.average_value,
        firstTimestampUs: big(r.first_timestamp_us), lastTimestampUs: big(r.last_timestamp_us),
      },
    }));
  }

  async getChannelPayload(path: string): Promise<Uint8Array> {
    const { data, error } = await this.require().storage.from(BUCKET).download(path);
    if (error || !data) throw new Error('Cloud recording could not be downloaded.');
    return blobToBytes(data);
  }

  async listRemoteFallEvents(sessionId: string): Promise<FallEventRecord[]> {
    const { data, error } = await this.require()
      .from('fall_events').select('*').eq('session_id', sessionId).order('detected_at_ms');
    if (error && missingTable(error.code)) return [];
    if (error) throw new Error('Cloud fall records could not be loaded.');
    return (data ?? []).map(toFall);
  }
}
