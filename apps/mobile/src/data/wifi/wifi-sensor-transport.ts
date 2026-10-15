import { decodePacket, DecodeError, MAX_PACKET_BYTES, type SensorPacket } from '@wearwise/sensor-protocol';
import type {
  SensorTransport, DeviceIdentity, SensorCapability, TransportConnectionState,
} from '@/domain/repositories/sensor-transport';
import { base64ToBytes } from '@/data/ble/base64';
import { PinnedWebSocket } from '../../../modules/pinned-websocket';

/* Wi-Fi transport — the same protocol over a WebSocket instead of BLE notifications.
 *
 * React Native ships a global WebSocket, so no native module is needed. The device
 * streams protocol-v1 packets as BINARY frames; the FIRST frame we send is the PoP
 * token (learned over BLE), which the firmware requires before it will stream.
 *
 * It implements the identical SensorTransport port the BLE and simulated transports
 * do, so the recording engine and the coordinator treat all three the same. The
 * capabilities/sessionId come from the BLE side of provisioning and are passed in —
 * the WebSocket carries data only.
 */

export interface WifiTarget {
  /** ws://<ip>:80/stream */
  url: string;
  /** hex PoP token read from the device's BLE Info characteristic */
  pop: string;
  /** SHA-256 (hex) of the sensor's TLS certificate, read over BLE. When present the
      connection is wss:// and trusts that certificate only. */
  pin?: string;
  identity: DeviceIdentity;
  capabilities: SensorCapability[];
}

const OPEN_TIMEOUT_MS = 6000;

/* The minimal WebSocket surface this transport uses; both the platform WebSocket and
   the pinned native socket satisfy it. */
type StreamSocket = {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(text: string): void;
  close(): void;
};

/* A sensor that published a certificate fingerprint is reached over wss:// and
   trusted by that pin alone. The unpinned path exists only for dev tooling/tests. */
function openSocket(target: WifiTarget): StreamSocket {
  if (target.pin) return new PinnedWebSocket(target.url, target.pin) as unknown as StreamSocket;
  return new WebSocket(target.url) as unknown as StreamSocket;
}
/* The patch streams a packet per sensor every ~200 ms, so 3 s of silence means the
   link is dead; the first packet gets longer while the stream spins up. */
const SILENCE_LIMIT_MS = 3000;
const FIRST_FRAME_LIMIT_MS = 6000;

export class WifiSensorTransport implements SensorTransport {
  readonly type = 'wifi' as const;

  private ws: StreamSocket | null = null;
  private target: WifiTarget;

  private stateListeners = new Set<(s: TransportConnectionState) => void>();
  private packetListeners = new Set<(p: SensorPacket) => void>();
  private decodeErrorListeners = new Set<(e: DecodeError) => void>();
  private connState: TransportConnectionState = 'disconnected';
  /* Liveness: the patch sends a packet every ~200 ms while streaming. If it loses power
     it cannot close the socket, so the phone's side stays "open" to a board that no
     longer exists and no error ever fires — the app showed "Connected · Wi-Fi" while
     minutes of data went missing. Silence is the only reliable signal. */
  private lastFrameAt = 0;
  private gotFrame = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  decodeErrors = 0;

  constructor(target: WifiTarget) { this.target = target; }

  async connect(): Promise<void> {
    /* Release builds only ever stream over a pinned, encrypted link. */
    if (!__DEV__ && !(this.target.pin && this.target.url.startsWith('wss://'))) throw new Error('Secure Wi-Fi firmware is required. Use Bluetooth.');
    this.setState('connecting_wifi');
    await new Promise<void>((resolve, reject) => {
      const ws = openSocket(this.target);
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { ws.close(); reject(new Error('Wi-Fi connect timed out')); }, OPEN_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        ws.send(this.target.pop);   // authenticate first; the device streams only after
        this.setState('connected_wifi');
        this.startWatchdog();
        resolve();
      };
      ws.onmessage = (ev) => this.onFrame(ev.data);
      ws.onerror = () => { /* surfaced via onclose */ };
      ws.onclose = () => {
        if (this.ws !== ws) return;          // the watchdog already declared this socket dead
        this.ws = null;
        this.stopWatchdog();
        if (this.connState !== 'disconnected') this.setState('reconnecting');
      };
    });
  }

  private startWatchdog() {
    this.stopWatchdog();
    this.lastFrameAt = Date.now();
    this.gotFrame = false;
    this.watchdog = setInterval(() => {
      const limit = this.gotFrame ? SILENCE_LIMIT_MS : FIRST_FRAME_LIMIT_MS;
      if (this.ws && Date.now() - this.lastFrameAt > limit) this.declareDead();
    }, 1000);
  }

  private stopWatchdog() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
  }

  /* Treat a silent link as gone: drop the socket (without waiting for a close that may
     never come) and report it, so the coordinator falls back to Bluetooth at once. */
  private declareDead() {
    const ws = this.ws;
    this.ws = null;
    this.stopWatchdog();
    try { ws?.close(); } catch { /* already gone */ }
    if (this.connState !== 'disconnected') this.setState('reconnecting');
  }

  private onFrame(data: unknown) {
    this.lastFrameAt = Date.now();
    this.gotFrame = true;
    let bytes: Uint8Array | null = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (typeof data === 'string') bytes = base64ToBytes(data); // some RN stacks deliver base64
    if (!bytes) return;
    try {
      if (bytes.byteLength > MAX_PACKET_BYTES) throw new DecodeError('too-long');
      const packet = decodePacket(bytes);
      /* The same filters as the Bluetooth stream: this patch, a signal it said it has, a
         believable rate. (The recording engine also checks the session.) */
      const { deviceId, address } = this.target.identity;
      const caps = this.target.capabilities;
      const knownId = deviceId !== 'unknown' && deviceId !== address; // not a placeholder
      if ((knownId && packet.deviceId !== deviceId)
        || (caps.length > 0 && !caps.some((c) => c.sensorType === packet.sensorType))
        || packet.sampleRateHz < 1 || packet.sampleRateHz > 1000) return;
      for (const l of this.packetListeners) l(packet);
    } catch (e) {
      if (e instanceof DecodeError) {
        this.decodeErrors++;
        for (const l of this.decodeErrorListeners) l(e);
      }
    }
  }

  async disconnect(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    this.stopWatchdog();
    this.setState('disconnected');
    try { ws?.close(); } catch { /* already closed */ }
  }

  async discoverCapabilities(): Promise<SensorCapability[]> {
    /* Capabilities were read over BLE during provisioning; the WebSocket is
       data-only. Returning the known set keeps the port uniform. */
    return this.target.capabilities;
  }

  /* The device streams whatever the BLE START selected; the WebSocket does not
     re-issue START. These satisfy the port and let the coordinator drive it. */
  async startStreaming(): Promise<void> { /* device already streaming from BLE START */ }
  async stopStreaming(): Promise<void> { await this.disconnect(); }

  onConnectionState(listener: (s: TransportConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.connState);
    return () => this.stateListeners.delete(listener);
  }
  onPacket(listener: (p: SensorPacket) => void): () => void {
    this.packetListeners.add(listener);
    return () => this.packetListeners.delete(listener);
  }
  onDecodeError(listener: (e: DecodeError) => void): () => void {
    this.decodeErrorListeners.add(listener);
    return () => this.decodeErrorListeners.delete(listener);
  }

  identity(): DeviceIdentity { return this.target.identity; }

  private setState(s: TransportConnectionState) {
    this.connState = s;
    for (const l of this.stateListeners) l(s);
  }
}
