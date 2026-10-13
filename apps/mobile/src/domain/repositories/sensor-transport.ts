import type { SensorPacket, SensorType } from '@wearwise/sensor-protocol';
import type { TransportType } from '@/domain/entities/session';

/* The transport port — build-instruction §9, made concrete.
 *
 * Every way packets can arrive (BLE, Wi-Fi, simulation) implements this, and the
 * recording engine only ever sees this interface. That is the guarantee behind
 * "transport changes must not create a second recording session": the engine is
 * subscribed to a TransportCoordinator that swaps implementations underneath it.
 */

export interface DeviceIdentity {
  /* The device's own persistent WearWise id (protocol deviceId) — NOT the Android
     MAC or iOS peripheral UUID, which differ per phone and rotate. */
  deviceId: string;
  displayName: string;
  /* Transport-specific address the adapter needs to reconnect. Opaque here. */
  address: string;
  transport: TransportType;
  /* The patch's firmware version, from its device info (Bluetooth), when known. */
  firmwareVersion?: string | null;
}

export interface SensorCapability {
  sensorType: SensorType;
  sampleRateHz: number;
  unit: string;
  /* Firmware may expose a channel it cannot currently read (sensor unplugged). */
  reporting: boolean;
}

/* Build-instruction §22 connection states, verbatim. */
export type TransportConnectionState =
  | 'disconnected' | 'scanning' | 'connecting' | 'connected_ble'
  | 'provisioning_wifi' | 'connecting_wifi' | 'connected_wifi'
  | 'switching_transport' | 'reconnecting' | 'failed';

export interface SensorTransport {
  readonly type: TransportType;

  connect(device: DeviceIdentity): Promise<void>;
  disconnect(): Promise<void>;
  discoverCapabilities(): Promise<SensorCapability[]>;

  /* Ask the device to stream these sensors into the given session. The sessionId
     travels in every packet so a stale stream from a previous session is
     rejectable by id, not just by timing. */
  startStreaming(sessionId: string, sensors: SensorType[]): Promise<void>;
  stopStreaming(): Promise<void>;

  onConnectionState(listener: (state: TransportConnectionState) => void): () => void;
  onPacket(listener: (packet: SensorPacket) => void): () => void;
}
