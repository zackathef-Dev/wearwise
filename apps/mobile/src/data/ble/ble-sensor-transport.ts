import { Platform } from 'react-native';
import { BleManager, type Device, type Subscription, State as BleState } from 'react-native-ble-plx';
import { decodePacket, DecodeError, type SensorPacket, SensorType } from '@wearwise/sensor-protocol';
import type {
  SensorTransport, DeviceIdentity, SensorCapability, TransportConnectionState,
} from '@/domain/repositories/sensor-transport';
import {
  WW_SERVICE_UUID, WW_CHAR_INFO, WW_CHAR_CAPS, WW_CHAR_CONTROL, WW_CHAR_DATA, WW_CHAR_WIFI, WW_CHAR_TLS,
  CONTROL_START, CONTROL_STOP, CONTROL_PROVISION,
} from './ble-uuids';
import { base64ToBytes, bytesToBase64 } from './base64';
import { bytesToUuid } from '@wearwise/sensor-protocol';
import { validateInfo, parseCapabilities } from './validate-discovery';
import { refusedPairingHelp } from './pairing-help';

/* The real BLE transport. Same port the simulation implements, so the recording
 * engine cannot tell them apart — a decoded SensorPacket is a decoded
 * SensorPacket. What changes from Milestone 3 is only where the bytes come from:
 * NimBLE notifications instead of an in-process timer.
 *
 * Design notes:
 * - We DECODE every notification through the shared codec. A packet that fails
 *   CRC or framing is dropped and counted, never forwarded as data.
 * - deviceId is the protocol id read from the Info characteristic, NOT the BLE
 *   peripheral id (which differs per phone and rotates). The engine keys streams
 *   on the protocol id, so a reconnect under a new peripheral id is still the
 *   same device.
 */

/* How long to wait for the user to type the sensor's passkey into the OS dialog. */
const PAIRING_WAIT_MS = 60_000;
const SCAN_TIMEOUT_MS = 12_000;

export interface BleScanResult {
  /** ble-plx peripheral id — opaque, per-phone. */
  peripheralId: string;
  name: string | null;
  rssi: number | null;
}

export class BleSensorTransport implements SensorTransport {
  readonly type = 'bluetooth' as const;

  private manager: BleManager;
  private device: Device | null = null;
  private dataSub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;

  private stateListeners = new Set<(s: TransportConnectionState) => void>();
  private packetListeners = new Set<(p: SensorPacket) => void>();
  private decodeErrorListeners = new Set<(e: DecodeError) => void>();

  private connState: TransportConnectionState = 'disconnected';
  private identityCache: DeviceIdentity | null = null;
  private negotiatedMtu = 23;

  /* Remembered so a reconnect can resume the SAME stream: re-subscribe and
     re-send START with the same sessionId, and the firmware continues its
     sequence numbers — the outage becomes a counted gap, not a new session. */
  private streaming: { sessionId: string; sensors: SensorType[] } | null = null;
  private reconnecting = false;
  private disposed = false;

  /* Diagnostics the UI can surface without owning the radio. */
  decodeErrors = 0;
  reconnects = 0;

  /* Wi-Fi PoP token read from the Info characteristic during connect (hex). */
  private tlsPin: string | null = null;
  private popToken: string | null = null;

  constructor(manager?: BleManager) {
    this.manager = manager ?? new BleManager();
  }

  /* ---- discovery (not part of the port; the store calls this before connect) ---- */

  async waitUntilPoweredOn(timeoutMs = 6000): Promise<boolean> {
    const current = await this.manager.state();
    if (current === BleState.PoweredOn) return true;
    return new Promise((resolve) => {
      const sub = this.manager.onStateChange((s) => {
        if (s === BleState.PoweredOn) { sub.remove(); resolve(true); }
      }, true);
      setTimeout(() => { sub.remove(); resolve(false); }, timeoutMs);
    });
  }

  /* Scan for WearWise devices by service UUID; other BLE devices are filtered by
     the radio, so the caller only ever sees patches (hardware matrix 4.2). */
  scan(onFound: (d: BleScanResult) => void, timeoutMs = SCAN_TIMEOUT_MS): () => void {
    const seen = new Set<string>();
    this.setState('scanning');
    this.manager.startDeviceScan([WW_SERVICE_UUID], { allowDuplicates: false }, (error, dev) => {
      if (error || !dev) return;
      if (seen.has(dev.id)) return;
      seen.add(dev.id);
      onFound({ peripheralId: dev.id, name: dev.name ?? dev.localName ?? null, rssi: dev.rssi });
    });
    const stop = () => { this.manager.stopDeviceScan(); };
    const timer = setTimeout(stop, timeoutMs);
    return () => { clearTimeout(timer); stop(); };
  }

  /* ---- SensorTransport ---- */

  /* Establish the link, retrying transient failures (Android's intermittent first-
     connect failure, status 133). Two rules keep this from fighting itself:
       - ONE attempt at a time: a second request while one is in flight (a manual
         Reconnect during the automatic reconnect loop) joins it instead of racing it;
       - a failed try never cancels the connection. An earlier version did, and two
         overlapping attempts then cancelled each other's good links in a loop.
     Only the link step retries — identity/validation errors are real and fail at once. */
  private linkInFlight: Promise<Device> | null = null;

  /* ---- pairing (firmware ≥ 0.9.0) ----
     Every characteristic needs an encrypted, passkey-authenticated link. The first
     read on an unpaired link is refused, which makes Android/iOS show its own
     pairing dialog; while the user types the sensor's 6-digit passkey, reads keep
     failing. So the first read is retried for a while, and the UI is told to say
     what is going on. A bonded phone encrypts silently and never sees this. */
  private pairingListeners = new Set<(waiting: boolean) => void>();
  onPairing(listener: (waiting: boolean) => void): () => void {
    this.pairingListeners.add(listener);
    return () => this.pairingListeners.delete(listener);
  }
  private emitPairing(waiting: boolean) { for (const l of this.pairingListeners) l(waiting); }

  private async readIdentitySecured(dev: Device, fallback: DeviceIdentity): Promise<DeviceIdentity> {
    const deadline = Date.now() + PAIRING_WAIT_MS;
    let waiting = false;
    try {
      for (;;) {
        try {
          return await this.readIdentity(dev, fallback);
        } catch (e) {
          if (!(await this.manager.isDeviceConnected(dev.id).catch(() => false))) {
            /* The sensor dropped us mid-pairing: it isn't accepting new devices (it
               knows two others and BOOT wasn't pressed, or it is locked). */
            throw new Error(refusedPairingHelp(Platform.OS, dev.name ?? fallback.displayName), { cause: e });
          }
          if (Date.now() > deadline) {
            throw new Error('Pairing was not completed. Connect again and enter the sensor’s 6-digit pairing code when your phone asks.', { cause: e });
          }
          if (!waiting) { waiting = true; this.emitPairing(true); }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    } finally {
      if (waiting) this.emitPairing(false);
    }
  }

  private connectLink(address: string): Promise<Device> {
    if (!this.linkInFlight) {
      this.linkInFlight = this.establishLink(address).finally(() => { this.linkInFlight = null; });
    }
    return this.linkInFlight;
  }

  private async establishLink(address: string): Promise<Device> {
    const backoffs = [0, 400, 900];
    let last: unknown;
    for (const wait of backoffs) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        /* A previous try may have connected before discovery failed: reuse that link. */
        const already = await this.manager.isDeviceConnected(address).catch(() => false);
        const dev = already
          ? ((await this.manager.devices([address]))[0] ?? await this.manager.connectToDevice(address, { requestMTU: 517 }))
          : await this.manager.connectToDevice(address, { requestMTU: 517 });
        return await dev.discoverAllServicesAndCharacteristics();
      } catch (e) {
        last = e;
      }
    }
    throw new Error(
      'Couldn’t connect to the sensor. Make sure it’s switched on and close to the phone, then try again.',
      { cause: last },
    );
  }

  async connect(device: DeviceIdentity): Promise<void> {
    this.setState('connecting');
    try {
      const dev = await this.connectLink(device.address);
      try { this.negotiatedMtu = dev.mtu ?? 23; } catch { this.negotiatedMtu = 23; }
      this.device = dev;

      this.attachDisconnectHandler(dev.id);

      this.identityCache = await this.readIdentitySecured(dev, device);
      /* A saved patch must still be that patch: a different board answering at its
         address is refused, not adopted. On first contact the id is provisional (the
         peripheral address) and is learned here. */
      if (device.deviceId !== device.address && this.identityCache.deviceId !== device.deviceId) {
        throw new Error('This isn’t the sensor saved on this phone. Remove it in Devices and add it again.');
      }
      await this.validateCharacteristics(dev);
      await this.discoverCapabilities();
      this.setState('connected_ble');
    } catch (e) {
      await this.disconnect();
      this.setState('failed');
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    /* An explicit disconnect ends the stream — do NOT auto-reconnect after it. */
    this.streaming = null;
    this.reconnecting = false;
    this.dataSub?.remove(); this.dataSub = null;
    this.disconnectSub?.remove(); this.disconnectSub = null;
    if (this.device) {
      try { await this.manager.cancelDeviceConnection(this.device.id); } catch { /* already gone */ }
    }
    this.device = null;
    this.identityCache = null;
    this.popToken = null;
    this.tlsPin = null;
    this.setState('disconnected');
  }

  /* Auto-reconnect after an UNEXPECTED drop (out of range, device reboot). Bounded
     retries with backoff; on success it re-establishes the session's stream. An
     explicit disconnect() clears `streaming` so this never fires for it. */
  private attachDisconnectHandler(peripheralId: string) {
    this.disconnectSub?.remove();
    this.disconnectSub = this.manager.onDeviceDisconnected(peripheralId, () => {
      this.dataSub?.remove(); this.dataSub = null;
      if (this.disposed || this.reconnecting) return;
      /* Only a link that was fully up is worth re-establishing. A drop during the first
         connect (pairing refused or cancelled, a wrong PIN) is that connect's failure:
         retrying it in the background showed pairing prompt after pairing prompt, and
         the patch counts each as a failed pairing, so it locked after three. */
      if (this.connState === 'connecting') return;
      this.setState('reconnecting');
      void this.reconnectLoop(peripheralId);
    });
  }

  private async reconnectLoop(peripheralId: string) {
    this.reconnecting = true;
    const backoffs = [500, 1000, 2000, 3000, 5000, 5000, 5000, 5000];
    for (const wait of backoffs) {
      if (this.reconnectCancelled()) break;
      await new Promise((r) => setTimeout(r, wait));
      if (this.reconnectCancelled()) break;
      try {
        if (!(await this.waitUntilPoweredOn(4000))) continue;
        /* Same single-flight link as connect(), so this loop and a manual Reconnect
           can never race each other. */
        const dev = await this.connectLink(peripheralId);
        if (this.reconnectCancelled()) {
          await this.manager.cancelDeviceConnection(dev.id);
          break;
        }
        const previous = this.identityCache;
        if (!previous) throw new Error('Device identity unavailable.');
        const identity = await this.readIdentitySecured(dev, previous);
        if (identity.deviceId !== previous.deviceId) throw new Error('WearWise device identity changed.');
        await this.validateCharacteristics(dev);
        try { this.negotiatedMtu = dev.mtu ?? 23; } catch { this.negotiatedMtu = 23; }
        this.device = dev;
        this.attachDisconnectHandler(dev.id);
        this.reconnects++;
        this.reconnecting = false;
        this.setState('connected_ble');
        /* Resume the same stream if we were recording. Same sessionId → the
           firmware continues its sequence numbers → the gap is counted once. */
        if (this.streaming) await this.startStreaming(this.streaming.sessionId, this.streaming.sensors);
        /* A rebooted patch forgot its Wi-Fi (RAM only) — hand it back so the
           coordinator's Wi-Fi retry can find it on the network again. */
        await this.restoreWifi().catch(() => { /* Wi-Fi is optional; Bluetooth carries on */ });
        return;
      } catch {
        /* keep trying until the backoffs run out */
      }
    }
    this.reconnecting = false;
    if (!this.disposed && this.connState !== 'disconnected') this.setState('failed');
  }

  async discoverCapabilities(): Promise<SensorCapability[]> {
    const dev = this.requireDevice();
    const ch = await dev.readCharacteristicForService(WW_SERVICE_UUID, WW_CHAR_CAPS);
    const bytes = ch.value ? base64ToBytes(ch.value) : new Uint8Array(0);
    return parseCapabilities(bytes);
  }

  async startStreaming(sessionId: string, sensors: SensorType[]): Promise<void> {
    const dev = this.requireDevice();
    this.streaming = { sessionId, sensors };

    /* Subscribe BEFORE writing START so no packet races ahead of the listener. */
    this.dataSub?.remove();
    this.dataSub = dev.monitorCharacteristicForService(WW_SERVICE_UUID, WW_CHAR_DATA, (error, ch) => {
      if (error || !ch?.value) return;
      try {
        if (ch.value.length > 616) throw new DecodeError('too-long');
        const bytes = base64ToBytes(ch.value);
        const packet = decodePacket(bytes);
        if (packet.deviceId !== this.identityCache?.deviceId || packet.sessionId !== sessionId ||
            !sensors.includes(packet.sensorType) || packet.sampleRateHz < 1 || packet.sampleRateHz > 1000) return;
        for (const l of this.packetListeners) l(packet);
      } catch (e) {
        if (e instanceof DecodeError) {
          this.decodeErrors++;
          for (const l of this.decodeErrorListeners) l(e);
        }
      }
    });

    const mask = sensors.reduce((m, s) => m | (1 << (s - 1)), 0);
    const payload = new Uint8Array(18);
    payload[0] = CONTROL_START;
    payload.set(uuidToBytesLocal(sessionId), 1);
    payload[17] = mask;
    await dev.writeCharacteristicWithResponseForService(WW_SERVICE_UUID, WW_CHAR_CONTROL, bytesToBase64(payload));
  }

  async stopStreaming(): Promise<void> {
    const dev = this.device;
    this.streaming = null;      // an intentional stop must not trigger auto-resume
    this.reconnecting = false;
    this.dataSub?.remove(); this.dataSub = null;
    if (!dev) return;
    try {
      await dev.writeCharacteristicWithResponseForService(
        WW_SERVICE_UUID, WW_CHAR_CONTROL, bytesToBase64(new Uint8Array([CONTROL_STOP])),
      );
    } catch { /* device may already be gone; our data is saved regardless */ }
  }

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

  identity(): DeviceIdentity | null { return this.identityCache; }
  mtu(): number { return this.negotiatedMtu; }

  destroy(): void {
    this.disposed = true;
    this.streaming = null;
    this.dataSub?.remove();
    this.disconnectSub?.remove();
    this.manager.destroy();
  }

  /* ---- internals ---- */

  private async readIdentity(dev: Device, fallback: DeviceIdentity): Promise<DeviceIdentity> {
    const ch = await dev.readCharacteristicForService(WW_SERVICE_UUID, WW_CHAR_INFO);
    const bytes = ch.value ? base64ToBytes(ch.value) : new Uint8Array(0);
    validateInfo(bytes);
    this.popToken = null;
    const deviceId = bytesToUuid(bytes, 0);

    /* Info layout: deviceId[16] bootId[4] protoVer[1] fwVersion(cstr) pop[4].
       Find the fwVersion NUL, the 4 bytes after it are the Wi-Fi PoP token. */
    let i = 21;
    while (i < bytes.length && bytes[i] !== 0) i++;
    const fw = String.fromCharCode(...bytes.slice(21, i));
    const firmwareVersion = /^[\w.+-]{1,32}$/.test(fw) ? fw : null;
    i++; // step over NUL
    if (i + 4 <= bytes.length) {
      this.popToken = Array.from(bytes.slice(i, i + 4), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    /* The Wi-Fi certificate fingerprint, re-read on every (re)connect like the PoP.
       Optional: firmware before 0.8.0 has no TLS and no such characteristic. */
    this.tlsPin = null;
    try {
      const t = await dev.readCharacteristicForService(WW_SERVICE_UUID, WW_CHAR_TLS);
      const fp = t.value ? base64ToBytes(t.value) : new Uint8Array(0);
      if (fp.length === 32) this.tlsPin = Array.from(fp, (x) => x.toString(16).padStart(2, '0')).join('');
    } catch { /* older firmware: Wi-Fi stays unavailable, Bluetooth works */ }

    return {
      deviceId,
      firmwareVersion,
      displayName: dev.name ?? fallback.displayName ?? 'WearWise patch',
      address: dev.id,
      transport: 'bluetooth',
    };
  }

  /* ---- Wi-Fi provisioning (Milestone 5) ---- */

  popTokenHex(): string | null { return this.popToken; }
  /* SHA-256 (hex) of the sensor's Wi-Fi TLS certificate, or null if it has none. */
  tlsFingerprintHex(): string | null { return this.tlsPin; }

  /* Write SSID/password to the device over the trusted BLE link. Credentials
     never leave this write — they are not logged and not held after the call. */
  async provisionWifi(ssid: string, password: string): Promise<void> {
    const dev = this.requireDevice();
    const ssidBytes = utf8(ssid), passBytes = utf8(password);
    if (ssidBytes.length < 1 || ssidBytes.length > 32) throw new Error('Wi-Fi name must be 1–32 characters');
    if (passBytes.length > 64) throw new Error('Wi-Fi password too long');
    if (passBytes.length > 0 && passBytes.length < 8) {
      throw new Error('Wi-Fi passwords are at least 8 characters. Leave it empty only for an open network.');
    }
    const payload = new Uint8Array(2 + ssidBytes.length + 1 + passBytes.length);
    payload[0] = CONTROL_PROVISION;
    payload[1] = ssidBytes.length;
    payload.set(ssidBytes, 2);
    payload[2 + ssidBytes.length] = passBytes.length;
    payload.set(passBytes, 3 + ssidBytes.length);
    try {
      await dev.writeCharacteristicWithResponseForService(WW_SERVICE_UUID, WW_CHAR_CONTROL, bytesToBase64(payload));
    } catch (e) {
      /* Firmware ≥ 0.9.3 refuses settings it can't use (ATT "Value Not Allowed") and
         stays on its current network; older firmware never refused. */
      throw new Error('The sensor couldn’t use these Wi-Fi settings. Check the network name and password, then try again.', { cause: e });
    }
  }

  /* ---- Wi-Fi credentials (firmware ≥ 0.9.1) ----
     The patch keeps its Wi-Fi password in RAM only, so after a reboot it is off
     Wi-Fi until the phone sends the credentials again. The app remembers them in
     secure storage; this hook lets the transport fetch them by device id. */
  private wifiCredentialSource: ((deviceId: string) => Promise<{ ssid: string; password: string } | null>) | null = null;
  setWifiCredentialSource(source: (deviceId: string) => Promise<{ ssid: string; password: string } | null>) {
    this.wifiCredentialSource = source;
  }

  /* If the patch has no Wi-Fi network (state 0 — fresh boot), send the saved one.
     A patch already joining, joined or retrying keeps what it has: re-sending would
     drop a working link. Returns whether credentials were sent. */
  async restoreWifi(): Promise<boolean> {
    const id = this.identityCache?.deviceId;
    if (!id || !this.wifiCredentialSource) return false;
    const status = await this.readWifiStatus();
    if (status.state !== 0) return false;
    const creds = await this.wifiCredentialSource(id);
    if (!creds) return false;
    await this.provisionWifi(creds.ssid, creds.password);
    return true;
  }

  /* Read the device's Wi-Fi state and IP. Returns null IP until connected. */
  async readWifiStatus(): Promise<{ state: number; ip: string | null }> {
    const dev = this.requireDevice();
    const ch = await dev.readCharacteristicForService(WW_SERVICE_UUID, WW_CHAR_WIFI);
    const b = ch.value ? base64ToBytes(ch.value) : new Uint8Array(0);
    if (b.length < 5) return { state: 0, ip: null };
    const ipNum = b[1]! | (b[2]! << 8) | (b[3]! << 16) | (b[4]! << 24);
    const ip = ipNum === 0 ? null : `${b[1]}.${b[2]}.${b[3]}.${b[4]}`;
    return { state: b[0]!, ip };
  }

  private requireDevice(): Device {
    if (!this.device) throw new Error('BLE transport not connected');
    return this.device;
  }

  private reconnectCancelled(): boolean {
    return this.disposed || this.connState === 'disconnected';
  }

  private async validateCharacteristics(dev: Device): Promise<void> {
    const chars = await dev.characteristicsForService(WW_SERVICE_UUID);
    for (const uuid of [WW_CHAR_INFO, WW_CHAR_CAPS, WW_CHAR_CONTROL, WW_CHAR_DATA]) {
      const ch = chars.find((c) => c.uuid.toLowerCase() === uuid.toLowerCase());
      if (!ch || (uuid === WW_CHAR_DATA ? !ch.isNotifiable :
        uuid === WW_CHAR_CONTROL ? !ch.isWritableWithResponse : !ch.isReadable)) {
        throw new Error('Unsupported WearWise service characteristics.');
      }
    }
  }

  private setState(s: TransportConnectionState) {
    this.connState = s;
    for (const l of this.stateListeners) l(s);
  }
}

/* Minimal UTF-8 encoder (RN has no TextEncoder guarantee on all engines). SSIDs
   and passwords are almost always ASCII; this handles the full BMP correctly. */
function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

/* The canonical unit per sensor type — SAMPLE_SCALE is the single source of truth, so a
   new sensor (e.g. the accelerometer's 'g') is never missing a unit here. */

/* Local UUID→bytes: the codec exports bytesToUuid but keeps uuidToBytes internal
   for encoding. START only needs the 16 raw bytes of the sessionId. */
function uuidToBytesLocal(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
