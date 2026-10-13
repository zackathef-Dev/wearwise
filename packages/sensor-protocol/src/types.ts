/* WearWise sensor protocol v1 — the one envelope both transports carry.
 *
 * BLE notifications and Wi-Fi WebSocket frames deliver the SAME bytes; the
 * transport is just the pipe. That is what lets the recording pipeline be
 * transport-agnostic, and what lets the phone fall from Wi-Fi to BLE without
 * starting a second session.
 *
 * The envelope is fixed-width binary (see codec.ts for the byte layout). Adding a
 * sensor type is a new SensorType code and a scale entry — the envelope does not
 * change, per the build instruction's "support future sensor types without
 * changing the packet envelope".
 */

export const PROTOCOL_VERSION = 1;

/* Wire codes. Never renumber — firmware in the field depends on them. */
export enum SensorType {
  Ecg = 1,
  SpO2 = 2,
  Temperature = 3,
  HeartRate = 4,
  /* MMA8452Q accelerometer, streamed as the acceleration MAGNITUDE |a| = √(x²+y²+z²)
     in g. Powers fall detection: ~1 g at rest, ~0 g in free-fall, a high spike on
     impact. The firmware computes the magnitude so the scalar-sample envelope is
     unchanged. */
  Accelerometer = 5,
  /* MAX30102 photoplethysmogram — the AC-coupled IR optical waveform (the pulse the
     device derives heart rate + SpO₂ from). Additive code 6: firmware that has a
     MAX30102 can stream it; an app build without this entry simply ignores the packets. */
  Ppg = 6,
}

export const SENSOR_CODES = {
  [SensorType.Ecg]: 'ecg',
  [SensorType.SpO2]: 'spo2',
  [SensorType.Temperature]: 'temperature',
  [SensorType.HeartRate]: 'bpm',
  [SensorType.Accelerometer]: 'accel',
  [SensorType.Ppg]: 'ppg',
} as const;

export type SensorCode = (typeof SENSOR_CODES)[SensorType];

/* Sample encoding. v1 ships one: signed 16-bit little-endian integers, scaled per
   sensor so the wire carries integers and the app reconstructs the physical unit.
   Bit widths and scales are protocol constants, not per-packet fields — a packet
   that claims a different scale would be a different protocol version. */
export enum SampleEncoding {
  Int16LE = 1,
}

/* Physical value = raw * scale. Chosen so int16 covers the sensor's real range with
   useful resolution:
     ECG        1 µV resolution → ±32.7 mV      (clinical ECG is ±5 mV)
     SpO₂       0.01 % resolution → 0..327 %
     Temp       0.01 °C resolution → ±327 °C
     Heart rate 0.1 bpm resolution → 0..3276 bpm (a derived, low-rate beat count) */
export const SAMPLE_SCALE: Record<SensorType, { scale: number; unit: string }> = {
  [SensorType.Ecg]: { scale: 0.001, unit: 'mV' },
  [SensorType.SpO2]: { scale: 0.01, unit: '%' },
  [SensorType.Temperature]: { scale: 0.01, unit: '°C' },
  [SensorType.HeartRate]: { scale: 0.1, unit: 'bpm' },
  /* Accel 0.001 g resolution → 0..32.7 g (covers rest, free-fall and hard impacts). */
  [SensorType.Accelerometer]: { scale: 0.001, unit: 'g' },
  /* PPG AC-coupled counts, 1 LSB resolution → ±32767 (fits the mean-removed IR swing). */
  [SensorType.Ppg]: { scale: 1, unit: 'counts' },
};

/* Header flag bits. */
export const FLAG_SIMULATED = 0x01;   // values were generated, not measured — the app MUST label them
export const FLAG_LAST_IN_BURST = 0x02; // informational: firmware closed a burst here
export const FLAG_LEADS_OFF = 0x04;     // ECG: an electrode was detached — samples are not a signal (fw ≥ 0.7.1)

/* Hard limits, chosen so a packet fits a BLE ATT payload after the 3-byte ATT
   header at the 517-byte MTU both platforms can negotiate. Wi-Fi could carry
   more, but one limit keeps the two transports interchangeable. */
export const MAX_SAMPLES_PER_PACKET = 200;
export const HEADER_BYTES = 58;
export const CHECKSUM_BYTES = 4;
export const MAX_PACKET_BYTES = HEADER_BYTES + MAX_SAMPLES_PER_PACKET * 2 + CHECKSUM_BYTES; // 462

/* A decoded packet. `samples` are already scaled into physical units.
   `deviceTimestampUs` is microseconds since device BOOT, not wall-clock: the
   ESP32 has no reliable clock until provisioned, and boot-relative time plus
   bootId is enough to order samples and detect a restart. */
export interface SensorPacket {
  protocolVersion: number;
  deviceId: string;        // UUID, the device's persistent WearWise identity
  bootId: number;          // changes on every device restart
  sessionId: string;       // UUID, the recording this packet belongs to
  sensorType: SensorType;
  sequenceNumber: number;  // per (device, boot, sensorType), starts at 0, +1 per packet
  deviceTimestampUs: bigint;
  sampleRateHz: number;
  encoding: SampleEncoding;
  flags: number;
  samples: number[];       // physical units, length = sampleCount
}

/* Everything an encoder needs. Same shape minus the derived fields. */
export interface SensorPacketInput {
  deviceId: string;
  bootId: number;
  sessionId: string;
  sensorType: SensorType;
  sequenceNumber: number;
  deviceTimestampUs: bigint;
  sampleRateHz: number;
  samples: number[];       // physical units; encoder quantizes per SAMPLE_SCALE
  flags?: number;
}

export type DecodeErrorCode =
  | 'too-short'
  | 'too-long'
  | 'bad-magic'
  | 'unsupported-version'
  | 'unknown-sensor'
  | 'unknown-encoding'
  | 'sample-count-out-of-range'
  | 'length-mismatch'
  | 'bad-checksum';

export class DecodeError extends Error {
  constructor(readonly code: DecodeErrorCode, detail?: string) {
    super(`packet decode failed: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'DecodeError';
  }
}
