import type { SensorType } from '@wearwise/sensor-protocol';

/* Recording domain: what a session IS, independent of how it is stored or
 * transported. No React Native, no SQL, no supabase in this file or its siblings.
 */

/* Build-instruction §22 recording states, verbatim. `preparing` is the window
   between the tap and the first persisted chunk; `stopping` is flush + close. */
export type RecordingState =
  | 'idle' | 'preparing' | 'recording' | 'stopping' | 'saved' | 'interrupted' | 'failed';

export type TransportType = 'bluetooth' | 'wifi' | 'simulation';

/* Persisted session status. Distinct from RecordingState, which is the live
   engine's phase: a row is `recording` from first chunk until a clean stop,
   `interrupted` if the app found it still `recording` at next launch. */
export type SessionStatus = 'recording' | 'complete' | 'interrupted' | 'discarded';

export interface Session {
  id: string;                 // UUID, also the sync idempotency key later
  userId: string;
  deviceId: string;
  startedAt: string;          // ISO UTC
  endedAt: string | null;
  durationMs: number | null;
  status: SessionStatus;
  simulated: boolean;
  initialTransport: TransportType;
  finalTransport: TransportType;
  transportSwitchCount: number;
  /* What was connected and configured at start — enough to reproduce the
     session's meaning later even if the device registry changes. */
  configurationSnapshot: SessionConfiguration;
  recoveryState: RecoveryState | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionConfiguration {
  deviceName: string;
  firmwareVersion: string | null;
  protocolVersion: number;
  channels: { sensorType: SensorType; sampleRateHz: number }[];
}

/* A device the app has connected to at least once — the persisted registry behind
   the Devices screen. Keyed by the device's own protocol id. Forgetting a device
   deletes only this row (and its capabilities); recorded sessions keep the deviceId
   string and their configurationSnapshot, so History is never affected. */
export interface DeviceRecord {
  userId?: string;
  id: string;                         // protocol deviceId
  displayName: string;                // the device's own advertised name (e.g. WearWise-6280)
  /* A name the participant chose ("Left wrist patch"). Shown instead of displayName;
     never overwritten by reconnecting, which refreshes displayName only. */
  customName?: string | null;
  model: string | null;
  firmwareVersion: string | null;
  preferredTransport: TransportType | null;
  /* Transport-specific reconnect handle (BLE peripheralId, sim address). */
  address: string | null;
  pairedAt: string;                   // ISO — first seen
  lastSeenAt: string | null;          // ISO — last connected
}

export interface RecoveryState {
  detectedAt: string;
  chunksVerified: number;
  chunksCorrupt: number;
  lastGoodSequence: Partial<Record<SensorType, number>>;
}

/* A fall the detector confirmed during a session. `status` records what the wearer
   did with the alarm: 'emergency' — the countdown ran out (or they raised it), so
   it needs a response; 'cancelled' — they tapped "I'm OK" in time. Both are kept so
   the history shows every detected fall, not only the ones that escalated. */
export type FallStatus = 'emergency' | 'cancelled';

export interface FallEventRecord {
  id: string;
  sessionId: string;
  /* Session-elapsed time (ms) at which the fall confirmed. */
  detectedAtMs: number;
  freefallMinG: number;
  impactPeakG: number;
  status: FallStatus;
  /* ISO wall-clock when the event was recorded. */
  createdAt: string;
}

export interface SessionChannel {
  id: string;
  sessionId: string;
  sensorType: SensorType;
  canonicalUnit: string;
  sampleRateHz: number;
  sampleCount: number;
  minimumValue: number | null;
  maximumValue: number | null;
  averageValue: number | null;
  firstTimestampUs: bigint | null;
  lastTimestampUs: bigint | null;
}

/* One persisted run of contiguous packets for one channel. Payload is the
   concatenated int16 LE samples exactly as they came off the wire — the app
   stores what it received, and the scale is a protocol constant. */
export interface SampleChunk {
  id: string;
  sessionId: string;
  channelId: string;
  chunkNumber: number;
  firstSequence: number;
  lastSequence: number;
  startedAtUs: bigint;
  endedAtUs: bigint;
  sampleCount: number;
  encoding: 'int16le-v1';
  payload: Uint8Array;
  checksum: number;           // CRC-32 of payload
  createdAt: string;
}

/* Rolling summary, updated per chunk so a crash never loses the aggregate. */
export interface ChannelSummary {
  sampleCount: number;
  min: number;
  max: number;
  sum: number;
  firstTimestampUs: bigint | null;
  lastTimestampUs: bigint | null;
  packetsAccepted: number;
  packetsDuplicate: number;
  sequenceGaps: number;       // total missing packets inferred from gaps
}

export const emptySummary = (): ChannelSummary => ({
  sampleCount: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, sum: 0,
  firstTimestampUs: null, lastTimestampUs: null, packetsAccepted: 0, packetsDuplicate: 0, sequenceGaps: 0,
});

/* Per-session cloud-sync state (Milestone 6). Lives in the local store; the cloud
   never writes it. `uploadedChannelIds` is what makes a retry resumable — a
   channel already uploaded is not re-packed or re-sent. */
export type SyncStatus = 'pending' | 'uploading' | 'synced' | 'failed';

export interface SyncState {
  sessionId: string;
  status: SyncStatus;
  uploadedChannelIds: string[];
  attempts: number;
  lastError: string | null;
  syncedAt: string | null;
  updatedAt: string;
}

/* An abnormal reading: a vital that stayed outside its normal range long enough to
   count (see domain/vitals/alert-monitor.ts), or a detected fall. Recorded whether
   or not a session was being saved — `sessionId` links it when one was. */
export type AlertKind = 'high' | 'low' | 'fall';
export interface AlertRecord {
  id: string;
  userId: string;
  sessionId: string | null;
  deviceId: string | null;
  /* The sensor the alert is about; null for a fall. */
  sensorType: SensorType | null;
  kind: AlertKind;
  /* Most extreme value while the alert was open (canonical units; g for a fall). */
  value: number;
  startedAt: string;
  /* Null while the reading is still out of range. */
  endedAt: string | null;
  seen: boolean;
}

/* Where an alert's cloud copy stands (phone-side bookkeeping, never uploaded).
   `revision` goes up on every local change (value, end); `syncedRevision` is the one
   last uploaded. `linkSettled`: the uploaded row already carries its session link, or
   never will — the link can only be sent once that session is itself in the cloud. */
export interface AlertCloudState {
  revision: number;
  syncedRevision: number;
  linkSettled: boolean;
}
export interface PendingCloudAlert {
  alert: AlertRecord;
  cloud: AlertCloudState;
}

/* An app event for the notifications list (the bell): sensor connected or lost,
   Wi-Fi switched, recording saved, a new alert, a fall. `route` is where tapping
   it goes. Kept on this phone only. */
export type NotificationKind = 'device' | 'wifi' | 'recording' | 'alert' | 'fall';
export interface NotificationRecord {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  route: string | null;
  createdAt: string;
  seen: boolean;
}

/* Basic health information the participant chose to enter (Profile). Every field is
   optional. Kept only in the encrypted on-device database. */
export type Sex = 'female' | 'male' | 'intersex' | 'unspecified';
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export interface HealthProfile {
  userId: string;
  sex: Sex | null;
  /* YYYY-MM-DD */
  dateOfBirth: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bloodGroup: BloodGroup | null;
  updatedAt: string;
}

/* The name to show for a device: the participant's own name for it, if they gave one. */
export const deviceName = (d: Pick<DeviceRecord, 'displayName' | 'customName'>): string =>
  d.customName?.trim() || d.displayName;
