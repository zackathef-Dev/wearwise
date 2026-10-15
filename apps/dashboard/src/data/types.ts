/* The dashboard's view of the backend contract (supabase/migrations, through
 * 20261015000006_alerts_and_live.sql). Every row the app reads is mapped into one of
 * these by a small, pure function in rows.ts, so the shape the UI depends on is
 * written down in one place and can be checked against the live API later.
 */

/* Every WearWise account may sign in. Researchers and clinicians ("staff") also see
   what participants share with them; everyone sees their own data. */
export const ACCOUNT_ROLES = ['participant', 'researcher', 'clinician'] as const;
export const VIEWER_ROLES = ['researcher', 'clinician'] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];

export const isStaff = (p: { role: string }): boolean => (VIEWER_ROLES as readonly string[]).includes(p.role);

export interface ViewerProfile {
  id: string;
  displayName: string;
  role: string;
  status: string;
  /** The server's record (migrations 7, 8); undefined on a server without those columns. */
  adultConfirmedAt?: string | null;
  termsVersion?: string | null;
}

/** A row of list_shared_participants(). */
export interface SharedParticipant {
  grantId: string;
  participantId: string;
  /** Their display name, or '' if they haven't set one. Their email is never shared. */
  name: string;
  sensorTypes: number[];
  includeFalls: boolean;
  sharedSince: string;
  lastSessionAt: string | null;
  sessionCount: number;
}

/** A row of list_my_access_grants(): someone the signed-in participant shares with. */
export interface MyGrant {
  grantId: string;
  name: string;
  email: string;
  role: string;
  sensorTypes: number[];
  includeFalls: boolean;
  createdAt: string;
  /** false while the viewer's account is suspended: the grant stands but shows them nothing */
  accessActive: boolean;
}

export type RedeemFailure = 'invalid_or_expired' | 'rate_limited';
export type RedeemResult =
  | { ok: true; grantId: string; participantName: string }
  | { ok: false; reason: RedeemFailure };

export type SessionStatus = 'complete' | 'interrupted' | 'discarded';

/** recorded_sessions, the columns the dashboard reads. */
export interface SessionRow {
  id: string;
  participantId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: SessionStatus | string;
  simulated: boolean;
  deviceName: string | null;
  firmwareVersion: string | null;
}

/** recorded_channels. Only the signals the participant granted are ever returned (RLS). */
export interface ChannelRow {
  id: string;
  sessionId: string;
  sensorType: number;
  unit: string;
  sampleRateHz: number;
  sampleCount: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  /** u64 device-clock microseconds, kept exact */
  firstTimestampUs: bigint | null;
  lastTimestampUs: bigint | null;
  storagePath: string;
}

export type FallStatus = 'emergency' | 'cancelled';

/** fall_events. Only returned when the grant includes falls (RLS). */
export interface FallRow {
  id: string;
  sessionId: string;
  /** session-elapsed time on the PHONE's clock when the fall confirmed */
  detectedAtMs: number;
  freefallMinG: number;
  impactPeakG: number;
  status: FallStatus | string;
  /** wall-clock time the phone recorded it */
  createdAt: string;
}

/** One entry of the alerts feed: a vital_alerts row (high/low) or a fall_events row. */
export interface AlertItem {
  id: string;
  kind: 'high' | 'low' | 'fall';
  participantId: string;
  sessionId: string | null;
  /** null for a fall */
  sensorType: number | null;
  /** most extreme value (canonical units); impact peak in g for a fall */
  value: number;
  /** when it started (vitals) or was recorded (falls) */
  at: string;
  /** vitals: null while still out of range; falls: always null */
  endedAt: string | null;
  /** falls only: 'emergency' or 'cancelled' */
  fallStatus: string | null;
  /** falls only: session-elapsed ms, to open the session at the fall */
  detectedAtMs: number | null;
}
