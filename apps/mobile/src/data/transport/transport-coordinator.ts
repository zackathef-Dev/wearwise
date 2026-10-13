import type { SensorTransport, TransportConnectionState } from '@/domain/repositories/sensor-transport';
import type { RecordingEngine } from '@/domain/recording/recording-engine';
import type { BleSensorTransport } from '@/data/ble/ble-sensor-transport';
import { WifiSensorTransport, type WifiTarget } from '@/data/wifi/wifi-sensor-transport';

/* TransportCoordinator — build-instruction §9's "do not restart or duplicate an
 * active session" made concrete for the Wi-Fi↔BLE handoff.
 *
 * The engine only ever holds ONE transport. The coordinator swaps which one via
 * engine.attachTransport(next); the session and its SequenceTracker survive the
 * swap, so:
 *   - no duplicate SESSION: the engine is never re-started, only re-pointed.
 *   - no duplicate PACKETS: the tracker dedups by (deviceId, bootId, sequence),
 *     so even if both transports briefly deliver the same packet during a handoff
 *     the second copy is dropped.
 *
 * Policy: BLE is the always-on baseline (it provisioned Wi-Fi and stays connected).
 * When Wi-Fi is available it is preferred (higher throughput, no BLE MTU cap). If
 * Wi-Fi drops, the coordinator falls back to the BLE transport already in hand.
 */

export type ActiveTransport = 'bluetooth' | 'wifi';

interface CoordinatorDeps {
  engine: RecordingEngine;
  ble: BleSensorTransport;
  onChange?: (active: ActiveTransport, wifiState: TransportConnectionState | null) => void;
}

export class TransportCoordinator {
  private engine: RecordingEngine;
  private ble: BleSensorTransport;
  private wifi: WifiSensorTransport | null = null;
  private active: ActiveTransport = 'bluetooth';
  private onChange?: CoordinatorDeps['onChange'];
  private unsubWifi: (() => void) | null = null;
  private disposed = false;
  /* The last Wi-Fi target that worked, and the pending automatic retry after a drop. */
  private target: WifiTarget | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: CoordinatorDeps) {
    this.engine = deps.engine;
    this.ble = deps.ble;
    this.onChange = deps.onChange;
  }

  activeTransport(): ActiveTransport { return this.active; }

  /* Try to bring Wi-Fi up and make it the active source. On any failure the BLE
     baseline is untouched — the stream never stops. Safe to call mid-recording. */
  async preferWifi(target: WifiTarget): Promise<boolean> {
    if (this.disposed) return false;
    this.target = target;
    const wifi = new WifiSensorTransport(target);
    try {
      await wifi.connect();
    } catch {
      wifi.disconnect().catch(() => {});
      return false;
    }
    this.wifi = wifi;
    this.unsubWifi?.();
    this.unsubWifi = wifi.onConnectionState((s) => this.onWifiState(s));

    /* Swap the engine onto Wi-Fi. The BLE transport stays connected as the
       fallback; the firmware keeps streaming to both, the tracker dedups. */
    this.engine.attachTransport(wifi);
    this.active = 'wifi';
    this.cancelRetry();
    this.onChange?.('wifi', 'connected_wifi');
    return true;
  }

  private onWifiState(s: TransportConnectionState) {
    if (this.disposed) return;
    if ((s === 'reconnecting' || s === 'disconnected' || s === 'failed') && this.active === 'wifi') {
      this.fallBackToBle();
    }
  }

  /* Wi-Fi lost → return to the BLE baseline without dropping the session. */
  private fallBackToBle() {
    this.engine.attachTransport(this.ble);
    this.active = 'bluetooth';
    this.onChange?.('bluetooth', this.wifi ? 'reconnecting' : null);
    const dead = this.wifi;
    this.wifi = null;
    this.unsubWifi?.(); this.unsubWifi = null;
    dead?.disconnect().catch(() => {});
    this.scheduleRetry(0);
  }

  /* Wi-Fi comes back on its own (router restarted, patch rejoined), so keep checking:
     ask the patch over Bluetooth whether it is on Wi-Fi again, and if so reopen the
     stream at its CURRENT address — DHCP may hand it a new one. Bluetooth carries the
     data meanwhile, so retrying never risks the session. */
  private scheduleRetry(attempt: number) {
    this.cancelRetry();
    if (this.disposed || !this.target) return;
    const wait = Math.min(15_000, 3_000 * (attempt + 1));
    this.retryTimer = setTimeout(() => { void this.retryWifi(attempt); }, wait);
  }

  private async retryWifi(attempt: number) {
    this.retryTimer = null;
    if (this.disposed || this.active === 'wifi' || !this.target) return;
    try {
      const s = await this.ble.readWifiStatus();
      if (s.state === 2 && s.ip) {
        this.onChange?.('bluetooth', 'connecting_wifi');
        /* Fresh PoP and certificate pin: a rebooted sensor has a new PoP (and the pin
           is re-read too, so a re-keyed sensor is never trusted by a stale pin). */
        const pin = this.ble.tlsFingerprintHex() ?? this.target.pin;
        const next: WifiTarget = { ...this.target, url: `wss://${s.ip}:443/stream`, pop: this.ble.popTokenHex() ?? this.target.pop, pin };
        if (await this.preferWifi(next)) return;
        this.onChange?.('bluetooth', 'reconnecting');
      }
    } catch { /* Bluetooth busy or the patch is rebooting — try again later */ }
    this.scheduleRetry(attempt + 1);
  }

  private cancelRetry() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  /* The session ended: stop retrying, close the Wi-Fi stream and point the engine
     back at Bluetooth, so the next session starts the normal way (START goes over
     BLE, then Wi-Fi is preferred again). The coordinator stays usable. */
  async release(): Promise<void> {
    this.cancelRetry();
    this.target = null;
    this.unsubWifi?.(); this.unsubWifi = null;
    const w = this.wifi; this.wifi = null;
    if (this.active === 'wifi') {
      this.engine.attachTransport(this.ble);
      this.active = 'bluetooth';
      this.onChange?.('bluetooth', null);
    }
    await w?.disconnect().catch(() => {});
  }

  /* Explicit teardown (stop recording / leave screen). */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancelRetry();
    this.unsubWifi?.(); this.unsubWifi = null;
    const w = this.wifi; this.wifi = null;
    await w?.disconnect().catch(() => {});
  }

  currentTransport(): SensorTransport {
    return this.active === 'wifi' && this.wifi ? this.wifi : this.ble;
  }
}
