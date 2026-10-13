import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CHANNEL_COLUMNS, FALL_ALERT_COLUMNS, FALL_COLUMNS, SESSION_COLUMNS, VITAL_ALERT_COLUMNS,
  toChannel, toFall, toFallAlert, toMyGrant, toProfile, toRedeemResult, toSession, toSharedParticipant, toVitalAlert,
} from './rows';
import type { AlertItem, ChannelRow, FallRow, MyGrant, RedeemResult, SessionRow, SharedParticipant, ViewerProfile } from './types';

/* The whole backend surface the dashboard uses, in one place.
 *
 * Read-only apart from redeem and revoke. Every call carries the viewer's JWT; the
 * server decides what is visible (RLS + the security-definer RPCs in
 * 20261014000005_data_sharing.sql), so nothing here filters for privacy itself —
 * a revoked grant simply returns nothing on the next call.
 *
 * Errors are rethrown as ApiError with a message fit to show a person. The raw
 * PostgREST/Storage error is kept on `cause` for debugging but never logged, since
 * it can echo request details.
 */

const BUCKET = 'recordings';

export class ApiError extends Error {
  constructor(message: string, readonly code?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiError';
  }
}

interface PgError { code?: string; message?: string; status?: number }

const fail = (message: string, error: PgError | null | undefined): never => {
  throw new ApiError(message, error?.code, { cause: error });
};

/* A table the server doesn't have yet (a project not migrated to the latest
   schema): PostgREST answers PGRST205 / 404, Postgres 42P01. */
const isMissingTable = (e: PgError): boolean => e.code === 'PGRST205' || e.code === '42P01' || e.status === 404;

/* 42501 = insufficient privilege: the RPCs raise it when the caller isn't an active viewer. */
const NOT_AUTHORISED = 'Your account is not authorised to view shared data. Ask a WearWise administrator to check your access.';

export class ViewerApi {
  constructor(private readonly db: SupabaseClient) {}

  async getProfile(userId: string): Promise<ViewerProfile | null> {
    const base = 'id, display_name, account_role, account_status';
    let { data, error } = await this.db
      .from('profiles').select(`${base}, adult_confirmed_at, terms_version`).eq('id', userId).maybeSingle();
    /* 42703: a server without the 18+/terms columns yet (before migrations 7, 8). */
    if (error?.code === '42703') ({ data, error } = await this.db.from('profiles').select(base).eq('id', userId).maybeSingle());
    if (error) fail('Your account details could not be loaded.', error);
    return data ? toProfile(data as Record<string, unknown>) : null;
  }

  async listSharedParticipants(): Promise<SharedParticipant[]> {
    const { data, error } = await this.db.rpc('list_shared_participants');
    if (error) fail(error.code === '42501' ? NOT_AUTHORISED : 'The participant list could not be loaded.', error);
    return ((data ?? []) as Record<string, unknown>[]).map(toSharedParticipant);
  }

  /** Who the signed-in participant shares with (their live grants). */
  async listMyGrants(): Promise<MyGrant[]> {
    const { data, error } = await this.db.rpc('list_my_access_grants');
    if (error) fail('The list of people you share with could not be loaded.', error);
    return ((data ?? []) as Record<string, unknown>[]).map(toMyGrant);
  }

  /** Alerts visible to the caller, newest first: their own, plus those of participants
   *  who share the signal (vitals) or falls with them (RLS decides). */
  async listAlerts(limit = 200): Promise<AlertItem[]> {
    const [vitals, falls] = await Promise.all([
      this.db.from('vital_alerts').select(VITAL_ALERT_COLUMNS).order('started_at', { ascending: false }).limit(limit),
      this.db.from('fall_events').select(FALL_ALERT_COLUMNS).order('created_at', { ascending: false }).limit(limit),
    ]);
    if (vitals.error && !isMissingTable(vitals.error)) fail('Alerts could not be loaded.', vitals.error);
    if (falls.error) fail('Alerts could not be loaded.', falls.error);
    const rows = [
      ...((vitals.error ? [] : vitals.data ?? []) as unknown as Record<string, unknown>[]).map(toVitalAlert),
      ...((falls.data ?? []) as unknown as Record<string, unknown>[]).map(toFallAlert),
    ];
    return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
  }

  async redeemShareCode(code: string): Promise<RedeemResult> {
    const { data, error } = await this.db.rpc('redeem_share_code', { p_code: code });
    if (error) fail(error.code === '42501' ? NOT_AUTHORISED : 'The code could not be checked. Please try again.', error);
    return toRedeemResult(data);
  }

  /** True if this call ended the grant; false if it was already ended (by either side) or isn't ours. */
  async revokeAccessGrant(grantId: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('revoke_access_grant', { p_grant_id: grantId });
    if (error) fail('The participant could not be removed. Please try again.', error);
    return data === true;
  }

  /** One page of a participant's sessions, newest first, with the total count. */
  async listSessions(participantId: string, page: number, pageSize: number): Promise<{ rows: SessionRow[]; total: number }> {
    const from = page * pageSize;
    const { data, error, count } = await this.db
      .from('recorded_sessions').select(SESSION_COLUMNS, { count: 'exact' })
      .eq('user_id', participantId)
      .order('started_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) fail('Sessions could not be loaded.', error);
    return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(toSession), total: count ?? 0 };
  }

  async getSession(sessionId: string): Promise<SessionRow | null> {
    const { data, error } = await this.db
      .from('recorded_sessions').select(SESSION_COLUMNS).eq('id', sessionId).maybeSingle();
    if (error) fail('The session could not be loaded.', error);
    return data ? toSession(data as unknown as Record<string, unknown>) : null;
  }

  /** Channels of several sessions at once (a page of the sessions list). */
  async listChannelsForSessions(sessionIds: string[]): Promise<ChannelRow[]> {
    if (!sessionIds.length) return [];
    const { data, error } = await this.db.from('recorded_channels').select(CHANNEL_COLUMNS).in('session_id', sessionIds);
    if (error) fail('Signal details could not be loaded.', error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toChannel);
  }

  async listChannels(sessionId: string): Promise<ChannelRow[]> {
    return this.listChannelsForSessions([sessionId]);
  }

  async listFallsForParticipant(participantId: string, limit = 200): Promise<FallRow[]> {
    const { data, error } = await this.db
      .from('fall_events').select(FALL_COLUMNS).eq('user_id', participantId)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) fail('Falls could not be loaded.', error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toFall);
  }

  async listFallsForSession(sessionId: string): Promise<FallRow[]> {
    const { data, error } = await this.db
      .from('fall_events').select(FALL_COLUMNS).eq('session_id', sessionId).order('detected_at_ms');
    if (error) fail('Falls could not be loaded.', error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toFall);
  }

  /** The channel's chunk container bytes from Storage (private bucket, viewer's JWT). */
  async downloadChannel(storagePath: string): Promise<Uint8Array> {
    const { data, error } = await this.db.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      fail('The recording could not be downloaded. It may no longer be shared with you.', error as PgError | null);
    }
    return new Uint8Array(await (data as Blob).arrayBuffer());
  }
}
