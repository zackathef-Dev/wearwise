import type {
  AlertItem, ChannelRow, FallRow, MyGrant, RedeemResult, SessionRow, SharedParticipant, ViewerProfile,
} from './types';

/* Row → model mappers. Pure and defensive: PostgREST returns bigint columns as
 * numbers or strings depending on size, smallint[] as number[], and jsonb as
 * whatever was stored, so every field is coerced explicitly here and nowhere else.
 */

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (v == null ? fallback : String(v));
const strOrNull = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const bigOrNull = (v: unknown): bigint | null => {
  if (v == null || v === '') return null;
  try { return BigInt(String(v)); } catch { return null; }
};

export const toProfile = (r: Row): ViewerProfile => ({
  id: str(r.id), displayName: str(r.display_name), role: str(r.account_role), status: str(r.account_status),
  ...('adult_confirmed_at' in r ? { adultConfirmedAt: strOrNull(r.adult_confirmed_at) } : {}),
  ...('terms_version' in r ? { termsVersion: strOrNull(r.terms_version) } : {}),
});

export const toSharedParticipant = (r: Row): SharedParticipant => ({
  grantId: str(r.grant_id),
  participantId: str(r.participant_id),
  name: str(r.participant_name).trim(),
  sensorTypes: Array.isArray(r.sensor_types) ? r.sensor_types.map((t) => num(t)).filter((t) => t > 0) : [],
  includeFalls: r.include_falls === true,
  sharedSince: str(r.shared_since),
  lastSessionAt: strOrNull(r.last_session_at),
  sessionCount: num(r.session_count),
});

export const toMyGrant = (r: Row): MyGrant => ({
  grantId: str(r.grant_id),
  name: str(r.grantee_name).trim(),
  email: str(r.grantee_email),
  role: str(r.grantee_role),
  sensorTypes: Array.isArray(r.sensor_types) ? r.sensor_types.map((t) => num(t)).filter((t) => t > 0) : [],
  includeFalls: r.include_falls === true,
  createdAt: str(r.created_at),
  accessActive: r.access_active === true,
});

/* redeem_share_code returns jsonb; failures come back as {ok:false, reason}, not as errors. */
export function toRedeemResult(data: unknown): RedeemResult {
  const r = (data ?? {}) as Row;
  if (r.ok === true && typeof r.grant_id === 'string') {
    return { ok: true, grantId: r.grant_id, participantName: str(r.participant_name).trim() };
  }
  return { ok: false, reason: r.reason === 'rate_limited' ? 'rate_limited' : 'invalid_or_expired' };
}

/** Columns selected for a session; device fields come out of configuration_snapshot. */
export const SESSION_COLUMNS =
  'id, user_id, started_at, ended_at, duration_ms, status, simulated, ' +
  'device_name:configuration_snapshot->>deviceName, firmware_version:configuration_snapshot->>firmwareVersion';

export const toSession = (r: Row): SessionRow => ({
  id: str(r.id),
  participantId: str(r.user_id),
  startedAt: str(r.started_at),
  endedAt: strOrNull(r.ended_at),
  durationMs: numOrNull(r.duration_ms),
  status: str(r.status),
  simulated: r.simulated === true,
  deviceName: strOrNull(r.device_name),
  firmwareVersion: strOrNull(r.firmware_version),
});

export const CHANNEL_COLUMNS =
  'id, session_id, sensor_type, canonical_unit, sample_rate_hz, sample_count, minimum_value, maximum_value, ' +
  'average_value, first_timestamp_us, last_timestamp_us, storage_path';

export const toChannel = (r: Row): ChannelRow => ({
  id: str(r.id),
  sessionId: str(r.session_id),
  sensorType: num(r.sensor_type),
  unit: str(r.canonical_unit),
  sampleRateHz: num(r.sample_rate_hz),
  sampleCount: num(r.sample_count),
  min: numOrNull(r.minimum_value),
  max: numOrNull(r.maximum_value),
  avg: numOrNull(r.average_value),
  firstTimestampUs: bigOrNull(r.first_timestamp_us),
  lastTimestampUs: bigOrNull(r.last_timestamp_us),
  storagePath: str(r.storage_path),
});

export const FALL_COLUMNS = 'id, session_id, detected_at_ms, freefall_min_g, impact_peak_g, status, created_at';

export const toFall = (r: Row): FallRow => ({
  id: str(r.id),
  sessionId: str(r.session_id),
  detectedAtMs: num(r.detected_at_ms),
  freefallMinG: num(r.freefall_min_g),
  impactPeakG: num(r.impact_peak_g),
  status: str(r.status),
  createdAt: str(r.created_at),
});

export const VITAL_ALERT_COLUMNS = 'id, user_id, session_id, sensor_type, kind, value, started_at, ended_at';

export const toVitalAlert = (r: Row): AlertItem => ({
  id: str(r.id),
  kind: r.kind === 'low' ? 'low' : 'high',
  participantId: str(r.user_id),
  sessionId: strOrNull(r.session_id),
  sensorType: num(r.sensor_type),
  value: num(r.value),
  at: str(r.started_at),
  endedAt: strOrNull(r.ended_at),
  fallStatus: null,
  detectedAtMs: null,
});

export const FALL_ALERT_COLUMNS = 'id, user_id, session_id, detected_at_ms, impact_peak_g, status, created_at';

export const toFallAlert = (r: Row): AlertItem => ({
  id: str(r.id),
  kind: 'fall',
  participantId: str(r.user_id),
  sessionId: strOrNull(r.session_id),
  sensorType: null,
  value: num(r.impact_peak_g),
  at: str(r.created_at),
  endedAt: null,
  fallStatus: str(r.status),
  detectedAtMs: numOrNull(r.detected_at_ms),
});
