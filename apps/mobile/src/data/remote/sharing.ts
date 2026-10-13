import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SensorType } from '@wearwise/sensor-protocol';
import { supabase } from './supabase-client';

/* Participant-controlled data sharing, over the security-definer RPCs in
 * supabase/migrations/20261014000005_data_sharing.sql.
 *
 * The participant makes a one-time share code (24 h, single use) for chosen
 * signals; a researcher or clinician redeems it in the dashboard, which creates an
 * access grant. From here the participant lists, narrows/widens and removes those
 * grants, and sees or withdraws a code nobody has used yet. The server checks who is calling and what they may change — this module
 * only shapes rows and folds failures into a few codes a screen can word plainly.
 */

export type GranteeRole = 'researcher' | 'clinician';

/* What a code or grant covers. */
export interface ShareScope {
  sensorTypes: SensorType[];
  includeFalls: boolean;
}

export interface ShareCode {
  code: string;       // 'ABCDE-FGHJK' — shown once, never stored server-side
  expiresAt: string;  // ISO timestamp
}

/* The participant's unused code. The code text isn't stored server-side, so only
   what it covers and when it lapses can be shown again. */
export interface PendingShareCode extends ShareScope {
  expiresAt: string;
}

export interface AccessGrant extends ShareScope {
  id: string;
  name: string | null;    // the viewer's display name, if they set one
  email: string | null;
  role: GranteeRole | null;  // null: the account no longer holds a viewer role
  /* false while the viewer is suspended or no longer a researcher/clinician: the
     grant stands, but the server shows them nothing. */
  accessActive: boolean;
  createdAt: string;
}

export type SharingFailureCode =
  | 'offline'          // no connection / server unreachable — retryable
  | 'not-configured'   // build has no backend
  | 'not-allowed'      // not an active participant account (42501)
  | 'no-signals'       // empty or unknown signal list (22023, or caught before the call)
  | 'unavailable'      // the sharing functions aren't on this backend yet
  | 'unknown';

export class SharingFailure extends Error {
  readonly code: SharingFailureCode;

  constructor(code: SharingFailureCode, cause?: unknown) {
    super(`sharing failure: ${code}`);
    this.name = 'SharingFailure';
    this.code = code;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export const isSharingFailure = (e: unknown): e is SharingFailure => e instanceof SharingFailure;

/* Every signal the server accepts (SensorType 1..6), in the order the app lists
   them when recording. */
export const SHAREABLE_SIGNALS: readonly SensorType[] = [
  SensorType.Ecg, SensorType.HeartRate, SensorType.SpO2,
  SensorType.Temperature, SensorType.Accelerometer, SensorType.Ppg,
];

/* Deduped, known codes only, in display order — so the request is stable and the
   server's own check never sees junk. */
export const normaliseSignals = (types: readonly number[]): SensorType[] =>
  SHAREABLE_SIGNALS.filter((t) => types.includes(t));

type RpcError = { message?: string; code?: string } | null | undefined;

/* PostgREST / Postgres → domain. A dropped connection comes back as status 0 with
   the fetch error's message; the RPCs raise 42501 (wrong account) and 22023 (no
   signals). Anything unrecognised is 'unknown', never a guess. */
export function foldSharingError(error: RpcError, status?: number): SharingFailure {
  const msg = (error?.message ?? '').toLowerCase();
  const code = error?.code ?? '';
  if (status === 0 || /network request failed|fetch failed|failed to fetch|load failed|aborterror/.test(msg)) {
    return new SharingFailure('offline', error);
  }
  if (code === '42501') return new SharingFailure('not-allowed', error);
  if (code === '22023') return new SharingFailure('no-signals', error);
  /* Function missing from the schema cache / database: migration not applied. */
  if (code === 'PGRST202' || code === '42883') return new SharingFailure('unavailable', error);
  return new SharingFailure('unknown', error);
}

const codeRow = z.object({ code: z.string().min(1), expires_at: z.string() });

const pendingRow = z.object({
  expires_at: z.string(),
  sensor_types: z.array(z.number()).nullable(),
  include_falls: z.boolean().nullable(),
});

const grantRow = z.object({
  grant_id: z.string(),
  grantee_name: z.string().nullable(),
  grantee_email: z.string().nullable(),
  grantee_role: z.string().nullable(),
  sensor_types: z.array(z.number()).nullable(),
  include_falls: z.boolean().nullable(),
  created_at: z.string(),
  access_active: z.boolean().nullable(),
});

const toGrant = (r: z.infer<typeof grantRow>): AccessGrant => ({
  id: r.grant_id,
  name: r.grantee_name?.trim() || null,
  email: r.grantee_email?.trim() || null,
  role: r.grantee_role === 'researcher' || r.grantee_role === 'clinician' ? r.grantee_role : null,
  sensorTypes: normaliseSignals(r.sensor_types ?? []),
  includeFalls: !!r.include_falls,
  /* Unknown counts as not active: never claim someone can see data when unsure. */
  accessActive: r.access_active === true,
  createdAt: r.created_at,
});

export class SupabaseSharing {
  constructor(private client: SupabaseClient | null = supabase) {}

  private async rpc(fn: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new SharingFailure('not-configured');
    let result: { data: unknown; error: RpcError; status?: number };
    try {
      result = await this.client.rpc(fn, args);
    } catch (e) {
      /* supabase-js normally returns fetch failures as { error, status: 0 }; a throw
         here is the same thing arriving by another route. */
      throw new SharingFailure('offline', e);
    }
    if (result.error) throw foldSharingError(result.error, result.status);
    return result.data;
  }

  /* The boolean RPCs: true if the call changed something. Anything else is a contract
     break, not a quiet "no". */
  private async changed(fn: string, args?: Record<string, unknown>): Promise<boolean> {
    const data = await this.rpc(fn, args);
    if (typeof data !== 'boolean') throw new SharingFailure('unknown', data);
    return data;
  }

  private static scopeArgs(scope: ShareScope) {
    const types = normaliseSignals(scope.sensorTypes);
    if (!types.length) throw new SharingFailure('no-signals');
    return { p_sensor_types: types, p_include_falls: scope.includeFalls };
  }

  /* A new one-time code. Replaces any earlier code the participant hasn't had used. */
  async createShareCode(scope: ShareScope): Promise<ShareCode> {
    const data = await this.rpc('create_share_code', SupabaseSharing.scopeArgs(scope));
    const parsed = codeRow.safeParse(Array.isArray(data) ? data[0] : data);
    if (!parsed.success) throw new SharingFailure('unknown', parsed.error);
    return { code: parsed.data.code, expiresAt: parsed.data.expires_at };
  }

  /* Everyone who can currently see this participant's data, newest first. */
  async listAccessGrants(): Promise<AccessGrant[]> {
    const data = await this.rpc('list_my_access_grants');
    /* All or nothing: silently dropping a row we couldn't read would hide someone
       who has access from the person deciding about it. */
    const parsed = z.array(grantRow).safeParse(data ?? []);
    if (!parsed.success) throw new SharingFailure('unknown', parsed.error);
    return parsed.data.map(toGrant);
  }

  /* Change what one person can see. False: the grant had already ended (the viewer
     may have removed it) or isn't this participant's — nothing changed. */
  async updateAccessGrant(grantId: string, scope: ShareScope): Promise<boolean> {
    return this.changed('update_access_grant', { p_grant_id: grantId, ...SupabaseSharing.scopeArgs(scope) });
  }

  /* End one person's access, effective on their next query. False: it had already
     ended (or isn't this participant's) — either way they can't see anything now. */
  async revokeAccessGrant(grantId: string): Promise<boolean> {
    return this.changed('revoke_access_grant', { p_grant_id: grantId });
  }

  /* The participant's unused, unexpired code, if any (at most one). */
  async pendingShareCode(): Promise<PendingShareCode | null> {
    const data = await this.rpc('my_pending_share_code');
    const row = Array.isArray(data) ? data[0] : data;
    if (row == null) return null;
    const parsed = pendingRow.safeParse(row);
    if (!parsed.success) throw new SharingFailure('unknown', parsed.error);
    return {
      expiresAt: parsed.data.expires_at,
      sensorTypes: normaliseSignals(parsed.data.sensor_types ?? []),
      includeFalls: !!parsed.data.include_falls,
    };
  }

  /* Withdraw the unused code. False: there wasn't one (already used or expired). */
  async cancelShareCode(): Promise<boolean> {
    return this.changed('cancel_share_code');
  }
}

export const sharing = new SupabaseSharing();
