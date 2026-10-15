import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { SensorType } from '@wearwise/sensor-protocol';
import { RecordingEngine, type EngineSnapshot, type FallSnapshot, type LiveSamples } from '@/domain/recording/recording-engine';
import { recoverUnfinishedSessions, type RecoveredSession } from '@/domain/recording/recover-sessions';
import type { SensorCapability, SensorTransport, DeviceIdentity } from '@/domain/repositories/sensor-transport';
import { deviceName, type DeviceRecord, type FallStatus, type AlertRecord, type HealthProfile, type NotificationRecord, type NotificationKind } from '@/domain/entities/session';
import { AlertMonitor } from '@/domain/vitals/alert-monitor';
import { alertTitle, alertValue } from '@/domain/vitals/alert-text';
import { SimulatedSensorTransport } from '@/data/simulation/simulated-transport';
import { BleSensorTransport, type BleScanResult } from '@/data/ble/ble-sensor-transport';
import { ensureBlePermissions } from '@/data/ble/ble-permissions';
import { TransportCoordinator, type ActiveTransport } from '@/data/transport/transport-coordinator';
import { openSessionStore, type OpenedStore } from '@/data/local/session-store-provider';
import { saveWifiCredentials, loadWifiCredentials, forgetWifiCredentials } from '@/platform/secure-storage/wifi-credentials';
import { askForPhoneNotificationsOnce, postPhoneNotification } from '@/features/notifications/phone-notifications';
import type { PhoneNotificationKind } from '@/features/notifications/notification-policy';
import type { FallState } from '@/features/live-view/live-view-core';

/* The patch's Wi-Fi link: not set up, joining, joined, or failed (with a reason). */
export type WifiStatus = 'none' | 'connecting' | 'connected' | 'failed';

export type TransportKind = 'simulation' | 'bluetooth';

/* Monitoring state: the one place that owns a transport and the recording engine.
 *
 * Screens read this and call its actions; they never touch the engine, the
 * transport or the store directly (build-instruction §8). Milestone 3 wires the
 * simulated transport. Milestone 4 replaces `makeTransport` with the coordinator
 * — nothing above this file changes.
 */

interface MonitoringState {
  ready: boolean;
  storage: OpenedStore | null;
  transport: SensorTransport | null;
  transportKind: TransportKind;
  pairedDevice: DeviceIdentity | null;
  scanning: boolean;
  found: BleScanResult[];
  capabilities: SensorCapability[];
  selected: SensorType[];
  engine: EngineSnapshot | null;
  recovered: RecoveredSession[];
  /* Persisted registry of devices the app has connected to — the Devices screen. */
  devices: DeviceRecord[];
  /* Fall alarm: false while the countdown to alert is still running, true once it
     expired and the emergency was raised. Meaningful only while engine.fall is set. */
  fallEmergencyRaised: boolean;
  error: string | null;
  /* Wi-Fi (Milestone 5) */
  activeTransport: ActiveTransport;
  wifiIp: string | null;
  provisioning: boolean;
  /* The patch's Wi-Fi link as the participant should see it — joined, failed (with
     why), or not set up. Separate from activeTransport, which says which link is
     carrying data right now (Wi-Fi takes over only once monitoring starts). */
  wifiStatus: WifiStatus;
  wifiError: string | null;
  /* Name of the network the sensor joined (or is joining) — what the participant
     recognises, unlike the IP address. */
  wifiSsid: string | null;
  /* True while the phone's own pairing dialog is waiting for the sensor's passkey. */
  pairingPrompt: boolean;
  /* Abnormal-reading alerts: the newest ones and how many are unread. */
  recentAlerts: AlertRecord[];
  alertsUnseen: number;
  /* The participant's basic health information (Profile), or null if never entered. */
  healthProfile: HealthProfile | null;
  /* App events behind the bell (sensor connected/lost, Wi-Fi, recordings, alerts, falls). */
  notifications: NotificationRecord[];
  notificationsUnseen: number;

  init(userId: string): Promise<void>;
  setTransportKind(kind: TransportKind): void;
  scanForDevices(): Promise<void>;
  stopScan(): void;
  pairDevice(result: BleScanResult): void;
  connect(): Promise<void>;
  select(sensors: SensorType[]): void;
  startRecording(userId: string): Promise<void>;
  stopRecording(): Promise<void>;
  provisionWifi(ssid: string, password: string): Promise<boolean>;
  keepRecovered(sessionId: string): Promise<void>;
  deleteRecovered(sessionId: string): Promise<void>;
  /* Devices screen: end the current link, reconnect a remembered device, or forget it. */
  disconnect(): Promise<void>;
  reconnectDevice(device: DeviceRecord): Promise<void>;
  forgetDevice(id: string): Promise<void>;
  /* Give a remembered device the participant's own name (null = back to its own). */
  renameDevice(id: string, name: string | null): Promise<void>;
  /* Fall alarm resolution (Live screen). cancelFall = "I'm OK" tapped in time;
     raiseFallEmergency = countdown expired; dismissFallAlarm = close the raised alarm. */
  cancelFall(): Promise<void>;
  raiseFallEmergency(): Promise<void>;
  dismissFallAlarm(): void;
  /* Alerts screen: reload the list / mark everything read. */
  refreshAlerts(): Promise<void>;
  markAlertsSeen(): Promise<void>;
  deleteAlert(id: string): Promise<void>;
  clearAlerts(): Promise<void>;
  /* Notifications screen. */
  refreshNotifications(): Promise<void>;
  markNotificationsSeen(): Promise<void>;
  deleteNotification(id: string): Promise<void>;
  clearNotifications(): Promise<void>;
  saveHealthProfile(fields: Omit<HealthProfile, 'userId' | 'updatedAt'>): Promise<void>;
  /* Devices: forget the sensor's Wi-Fi network on this phone and go back to Bluetooth. */
  forgetWifi(): Promise<void>;
  /* The network this phone has saved for the connected sensor (name only), if any. */
  savedWifiSsid(): Promise<string | null>;
  /* Home: once per launch, reconnect the most recently used Bluetooth sensor so its
     live readings appear without a trip to Devices. */
  autoConnect(): Promise<void>;
}

let engine: RecordingEngine | null = null;
let unsubEngine: (() => void) | null = null;
let ble: BleSensorTransport | null = null;
let coordinator: TransportCoordinator | null = null;
let stopScanFn: (() => void) | null = null;
/* Live-reading alerts (see domain/vitals). Fed from every engine snapshot. */
let alertMonitor: AlertMonitor | null = null;
let alertTick: ReturnType<typeof setInterval> | null = null;
const lastFed = new Map<SensorType, number>();
const ALERT_SENSORS = [SensorType.HeartRate, SensorType.SpO2, SensorType.Temperature];
let autoConnectTried = false;
/* True during the launch-time reconnect, which is not a moment to ask for anything. */
let autoConnecting = false;
/* Live-view taps on the engine's sample stream and the fall alarm (see onLiveSamples). */
const sampleListeners = new Set<(s: LiveSamples) => void>();
const fallListeners = new Set<(f: FallSnapshot, state: FallState) => void>();
const fallStep = (f: FallSnapshot, state: FallState) => {
  for (const l of fallListeners) { try { l(f, state); } catch { /* never disturb the alarm */ } }
};
/* Whose data the store is currently holding. When a DIFFERENT user signs in on the
   same device (no app restart), init() tears everything down and rebuilds for them
   — otherwise the previous user's recovered session, paired device and engine would
   leak into the new account (a delete could even hit the other user's data). */
let currentUserId: string | null = null;
/* Saved Wi-Fi for a patch, as the signed-in account saved it (none for anyone else). */
const myWifi = (deviceId: string) => (currentUserId ? loadWifiCredentials(deviceId, currentUserId) : Promise.resolve(null));

const INITIAL_MONITORING = {
  ready: false, storage: null, transport: null, transportKind: 'simulation' as TransportKind,
  pairedDevice: null, scanning: false, found: [],
  capabilities: [], selected: [SensorType.Ecg, SensorType.HeartRate, SensorType.SpO2, SensorType.Temperature, SensorType.Accelerometer],
  engine: null, recovered: [], devices: [] as DeviceRecord[], fallEmergencyRaised: false, error: null,
  activeTransport: 'bluetooth' as ActiveTransport, wifiIp: null, provisioning: false, wifiStatus: 'none' as WifiStatus, wifiError: null, wifiSsid: null, pairingPrompt: false,
  recentAlerts: [] as AlertRecord[], alertsUnseen: 0, healthProfile: null as HealthProfile | null,
  notifications: [] as NotificationRecord[], notificationsUnseen: 0,
};

/* Drop every live handle and reset state — used when the signed-in user changes. */
function teardownMonitoring() {
  engine?.dispose(); engine = null;
  unsubEngine?.(); unsubEngine = null;
  void coordinator?.dispose(); coordinator = null;
  stopScanFn?.(); stopScanFn = null;
  ble?.destroy(); ble = null;
  pendingWifi = null;
  alertMonitor?.closeAll(); alertMonitor = null;
  if (alertTick) { clearInterval(alertTick); alertTick = null; }
  lastFed.clear();
  autoConnectTried = false;
  if (lostTimer) { clearTimeout(lostTimer); lostTimer = null; }
  wasConnected = false;
  lastFallIso = null;
  lastNotified.clear();
}

/* Feed new HR/SpO₂/temperature readings to the alert monitor (each reading once). */
function feedAlerts(snap: EngineSnapshot): void {
  if (!alertMonitor) return;
  for (const s of ALERT_SENSORS) {
    const ch = snap.channels[s];
    if (!ch || ch.latest == null || !ch.lastAtMs || (lastFed.get(s) ?? 0) >= ch.lastAtMs) continue;
    lastFed.set(s, ch.lastAtMs);
    alertMonitor.push(s, ch.latest, ch.lastAtMs);
  }
}

/* Alerts are written straight to the encrypted store, linked to the recording when
   one is running. Best-effort: an alert write must never disturb the stream. */
function startAlerts(userId: string): void {
  alertMonitor?.closeAll();
  const refresh = () => useMonitoring.getState().refreshAlerts();
  alertMonitor = new AlertMonitor({
    open: (a) => {
      const store = getSessionStore();
      const snap = engine?.snapshot();
      if (!store) return;
      void store.insertAlert({
        id: a.id, userId, sessionId: snap?.state === 'recording' ? snap.sessionId : null,
        deviceId: useMonitoring.getState().pairedDevice?.deviceId ?? null,
        sensorType: a.sensorType, kind: a.kind, value: a.value,
        startedAt: new Date(a.startedAtMs).toISOString(), endedAt: null, seen: false,
      }).then(refresh).catch(() => {});
      notify('alert', alertTitle(a), `${alertValue(a)} — out of the normal range.`, '/alerts', { kind: 'alert' });
    },
    update: (id, p) => {
      const store = getSessionStore();
      if (!store) return;
      void store.updateAlert(id, {
        value: p.value, endedAt: p.endedAtMs !== undefined ? new Date(p.endedAtMs).toISOString() : undefined,
      }).then(refresh).catch(() => {});
    },
  }, () => Crypto.randomUUID());
  if (alertTick) clearInterval(alertTick);
  alertTick = setInterval(() => alertMonitor?.tick(Date.now()), 2000);
}

/* ---- notifications (the bell) ----
   App events written in words. Best-effort, like alerts: never in the way of the
   stream. Repeats of the same event within REPEAT_MS are dropped so a flapping link
   does not flood the list. `phone`: also show it as a phone notification (alerts,
   falls, a sensor lost mid-recording), with its own wording if given. */
const REPEAT_MS = 30_000;
const lastNotified = new Map<string, number>();
/* Opening the app reconnects the sensor (and Wi-Fi) by itself — that is not news, and
   announcing it on every launch filled the list. Good-news link events are muted for a
   moment after start-up; losses are always announced. */
const STARTUP_QUIET_MS = 20_000;
let quietUntil = 0;
const routine = (kind: NotificationKind, title: string) =>
  (kind === 'device' && title.endsWith(' connected')) || (kind === 'wifi' && title.startsWith('Streaming over Wi-Fi'));
function notify(kind: NotificationKind, title: string, body: string, route: string | null = null,
  phone?: { kind: PhoneNotificationKind; body?: string }): void {
  const store = getSessionStore();
  if (!store || !currentUserId) return;
  const key = `${kind}|${title}`;
  const now = Date.now();
  if (now < quietUntil && routine(kind, title)) return;
  if (now - (lastNotified.get(key) ?? 0) < REPEAT_MS) return;
  lastNotified.set(key, now);
  if (phone) postPhoneNotification(phone.kind, title, phone.body ?? body, route);
  void store.insertNotification({
    id: Crypto.randomUUID(), userId: currentUserId, kind, title, body, route,
    createdAt: new Date(now).toISOString(), seen: false,
  }).then(() => useMonitoring.getState().refreshNotifications()).catch(() => {});
}

const sensorName = () => {
  const { pairedDevice, devices, transportKind } = useMonitoring.getState();
  if (transportKind === 'simulation') return 'Simulated Patch';
  return pairedDevice ? deviceLabel(devices, pairedDevice.deviceId, pairedDevice.displayName) : 'Your sensor';
};

/* Sensor link events from engine snapshots. A loss is only announced if the link is
   still down after LOST_GRACE_MS — a Wi-Fi → Bluetooth handover blips through
   "reconnecting" for a moment and is not news. */
const LOST_GRACE_MS = 6000;
let wasConnected = false;
let lostTimer: ReturnType<typeof setTimeout> | null = null;
let lastFallIso: string | null = null;
function trackEvents(snap: EngineSnapshot): void {
  const connected = snap.connection === 'connected_ble' || snap.connection === 'connected_wifi';
  if (connected && !wasConnected) {
    if (lostTimer) { clearTimeout(lostTimer); lostTimer = null; }
    else notify('device', `${sensorName()} connected`, 'Live readings are on Home.', '/home');
  } else if (!connected && wasConnected && !lostTimer) {
    const explicit = snap.connection === 'disconnected';
    lostTimer = setTimeout(() => {
      lostTimer = null;
      const latest = useMonitoring.getState().engine;
      if (latest?.connection === 'connected_ble' || latest?.connection === 'connected_wifi') return;
      const title = explicit ? `${sensorName()} disconnected` : `${sensorName()} connection lost`;
      /* Mid-recording it matters most: say so on the phone too, and open Home, where
         the recording and Reconnect are. */
      if (engineBusy(latest?.state)) {
        notify('device', title, 'Your recording is still running. It picks up again when the sensor reconnects — check it is on and in range.',
          '/home', { kind: 'recording' });
        return;
      }
      notify('device', title,
        explicit ? 'Reconnect it from Home or Devices.' : 'The app keeps trying to reconnect. Check the sensor is on and in range.', '/devices');
    }, explicit ? 0 : LOST_GRACE_MS);
  }
  wasConnected = connected;
  if (snap.fall && snap.fall.atIso !== lastFallIso) {
    lastFallIso = snap.fall.atIso;
    fallStep(snap.fall, 'detected');
    notify('fall', 'Fall detected', `Impact ${snap.fall.impactPeakG.toFixed(1)} g. The alarm is on screen.`, '/alerts',
      { kind: 'fall', body: `Impact ${snap.fall.impactPeakG.toFixed(1)} g. Open WearWise to answer the alarm.` });
  }
}
/* A provisioned Wi-Fi network, applied once recording is live. The device only
   streams after a BLE START, so recording must begin on BLE (firmware then streams
   to BLE AND Wi-Fi); the coordinator swaps the read path to Wi-Fi right after. */
/* The one BLE transport, created on first use and wired to surface the pairing
   prompt (firmware ≥ 0.9.0 requires passkey pairing before anything else). */
function bleTransport(): BleSensorTransport {
  if (!ble) {
    ble = new BleSensorTransport();
    ble.onPairing((waiting) => useMonitoring.setState({ pairingPrompt: waiting }));
    /* Firmware ≥ 0.9.1 forgets Wi-Fi at power-off; the phone re-sends it on reconnect. */
    ble.setWifiCredentialSource(myWifi);
  }
  return ble;
}

let pendingWifi: import('@/data/wifi/wifi-sensor-transport').WifiTarget | null = null;

/* The sensor has been given a network: wait for it to get an IP, then make its
   encrypted stream the Wi-Fi target (handing over at once if a recording is live).
   Shared by first-time setup and by the automatic restore on every connect. */
async function attachWifi(ssid: string): Promise<boolean> {
  const set = useMonitoring.setState;
  const fail = (why: string) => { set({ provisioning: false, wifiStatus: 'failed', wifiError: why }); return false; };
  const link = ble;
  if (!link) return fail('Connect over Bluetooth first, then set up Wi-Fi.');
  try {
    /* Poll the device's Wi-Fi status until it has an IP (or give up). */
    let ip: string | null = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = await link.readWifiStatus();
      if (s.state === 3) return fail('The sensor could not join that network. Check the name and password, and that it is a 2.4 GHz network.');
      if (s.state === 2 && s.ip) { ip = s.ip; break; }
    }
    /* Previously this path failed silently — no message at all. */
    if (!ip) return fail('The sensor did not get onto Wi-Fi within 20 seconds. Make sure the network is 2.4 GHz and in range, then try again.');

    const pop = link.popTokenHex();
    if (!pop) return fail('This sensor does not support Wi-Fi streaming.');
    /* Encrypted only: the stream is wss:// and trusts the certificate whose
       fingerprint the sensor gave us over Bluetooth — never a plain ws:// link. */
    const pin = link.tlsFingerprintHex();
    if (!pin) return fail('This sensor’s firmware does not support encrypted Wi-Fi. Update the sensor firmware to use Wi-Fi.');

    const { pairedDevice, capabilities } = useMonitoring.getState();
    const target = {
      url: `wss://${ip}:443/stream`,
      pop,
      pin,
      identity: pairedDevice ?? link.identity() ?? { deviceId: 'unknown', displayName: 'WearWise patch', address: ip, transport: 'wifi' as const },
      capabilities,
    };
    pendingWifi = target;

    /* If a recording is already live, hand off now; the firmware is already
       streaming (BLE START was sent at start). Otherwise the handoff happens in
       startRecording, right after the BLE START. */
    const live = engine?.snapshot();
    if ((live?.state === 'recording' || live?.previewing) && coordinator && useMonitoring.getState().activeTransport !== 'wifi') {
      const ok = await coordinator.preferWifi(target);
      set(ok
        ? { provisioning: false, wifiIp: ip, activeTransport: 'wifi', wifiStatus: 'connected', wifiError: null, wifiSsid: ssid }
        : { provisioning: false, wifiIp: ip, activeTransport: 'bluetooth', wifiStatus: 'failed', wifiError: 'The sensor joined Wi-Fi, but the phone could not open its data stream. Streaming stays on Bluetooth. Check the phone is on the same network.' });
      return ok;
    }
    set({ provisioning: false, wifiIp: ip, wifiStatus: 'connected', wifiError: null, wifiSsid: ssid });
    return true;
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Wi-Fi setup failed.');
  }
}

/* On connect: if this phone remembers the sensor's Wi-Fi, hand it over (the sensor
   forgets it at power-off) and line up the encrypted stream — no trip to the Wi-Fi
   screen needed. Runs in the background; Bluetooth works meanwhile. */
async function restoreSavedWifi(deviceId: string): Promise<void> {
  const link = ble;
  const saved = await myWifi(deviceId);
  if (!saved || !link || ble !== link) return;
  useMonitoring.setState({ wifiStatus: 'connecting', wifiError: null, wifiSsid: saved.ssid });
  try {
    await link.restoreWifi();
  } catch {
    useMonitoring.setState({ wifiStatus: 'failed', wifiError: 'Could not send the saved Wi-Fi network to the sensor. Bluetooth still works; try Wi-Fi setup again.' });
    return;
  }
  await attachWifi(saved.ssid);
}

/* A session is mid-flight through any of these — tearing down the transport now
   (disconnect/reconnect/forget) would fail the in-progress start or stop. */
const engineBusy = (state: EngineSnapshot['state'] | undefined): boolean =>
  state === 'preparing' || state === 'recording' || state === 'stopping';

const makeSimulation = (): SensorTransport => new SimulatedSensorTransport({ seed: 20260826, packetIntervalMs: 200 });

/* Build the transport for the current kind and re-seat the engine on it without
   starting a new session (engine.attachTransport is the §9 mechanism). */
function transportFor(kind: TransportKind): SensorTransport {
  if (kind === 'bluetooth') {
    ble = bleTransport();
    return ble;
  }
  return makeSimulation();
}

export const useMonitoring = create<MonitoringState>((set, get) => ({
  ready: false, storage: null, transport: null, transportKind: 'simulation',
  pairedDevice: null, scanning: false, found: [],
  capabilities: [], selected: [SensorType.Ecg, SensorType.HeartRate, SensorType.SpO2, SensorType.Temperature, SensorType.Accelerometer],
  engine: null, recovered: [], devices: [], fallEmergencyRaised: false, error: null,
  activeTransport: 'bluetooth', wifiIp: null, provisioning: false, wifiStatus: 'none', wifiError: null, wifiSsid: null, pairingPrompt: false,
  recentAlerts: [], alertsUnseen: 0, healthProfile: null,
  notifications: [], notificationsUnseen: 0,

  async init(userId) {
    if (get().ready && currentUserId === userId) return;
    /* A different user (or first run): clear the prior user's live state so nothing
       leaks across accounts. Recovery/listing below are already user-scoped. */
    if (currentUserId !== null && currentUserId !== userId) {
      teardownMonitoring();
      set(INITIAL_MONITORING);
    }
    currentUserId = userId;
    const storage = await openSessionStore();
    const recovered = await recoverUnfinishedSessions(storage.store, userId);
    if (currentUserId !== userId) return;
    const transport = transportFor(get().transportKind);
    engine?.dispose();
    engine = new RecordingEngine(transport, storage.store);
    unsubEngine?.();
    unsubEngine = engine.onChange((snap) => { set({ engine: snap }); feedAlerts(snap); trackEvents(snap); });
    engine.onSamples((e) => { for (const l of sampleListeners) l(e); });
    const devices = await storage.store.listDevices(currentUserId ?? '').catch(() => []);
    const healthProfile = await storage.store.getHealthProfile(userId).catch(() => null);
    if (currentUserId !== userId) return;
    set({ ready: true, storage, transport, recovered, devices, healthProfile });
    quietUntil = Date.now() + STARTUP_QUIET_MS;
    startAlerts(userId);
    void get().refreshAlerts();
    void get().refreshNotifications();
  },

  setTransportKind(kind) {
    if (get().transportKind === kind) return;
    const transport = transportFor(kind);
    /* The preview belongs to the old transport's device. */
    if (engine) { void engine.stopPreview(); engine.attachTransport(transport); }
    set({ transportKind: kind, transport, capabilities: [], pairedDevice: null, found: [], error: null });
  },

  async scanForDevices() {
    ble = bleTransport();
    if (get().transportKind !== 'bluetooth') get().setTransportKind('bluetooth');

    const perm = await ensureBlePermissions();
    if (!perm.granted) {
      set({ error: perm.reason === 'blocked'
        ? 'Bluetooth permission is turned off. Enable it for WearWise in Settings to find your sensor.'
        : 'WearWise needs Bluetooth permission to find your sensor.' });
      return;
    }
    const on = await ble.waitUntilPoweredOn();
    if (!on) { set({ error: 'Turn on Bluetooth to find your sensor.' }); return; }

    set({ scanning: true, found: [], error: null });
    stopScanFn?.();
    stopScanFn = ble.scan(
      (d) => set({ found: dedupeById([...get().found, d]) }),
      12_000,
    );
    /* Reflect the scan window ending in the UI. */
    setTimeout(() => { if (get().scanning) set({ scanning: false }); }, 12_500);
  },

  stopScan() {
    stopScanFn?.(); stopScanFn = null;
    set({ scanning: false });
  },

  pairDevice(result) {
    get().stopScan();
    if (engineBusy(get().engine?.state)) {
      set({ error: 'Stop the current recording before connecting another sensor.' });
      return;
    }
    const identity: DeviceIdentity = {
      deviceId: result.peripheralId, // provisional; the real protocol id is read on connect
      displayName: result.name ?? 'WearWise patch',
      address: result.peripheralId,
      transport: 'bluetooth',
    };
    set({ pairedDevice: identity, error: null });
  },

  async connect() {
    const { transport, transportKind, pairedDevice } = get();
    if (!transport) return;
    try {
      const identity = transportKind === 'bluetooth'
        ? (pairedDevice ?? undefined)
        : identityOf(transport);
      if (transportKind === 'bluetooth' && !identity) {
        set({ error: 'Choose your sensor first.' });
        return;
      }
      /* Skip the physical connect if this transport is already connected — the sensor
         screen calls connect() on mount, so arriving here already linked (e.g. after a
         Reconnect from Devices) would otherwise re-connect an open BLE device, which
         ble-plx rejects with "Operation was cancelled". discoverCapabilities below still
         refreshes the caps and clears any stale error. */
      const conn = get().engine?.connection;
      const linked = conn === 'connected_ble' || conn === 'connected_wifi';
      /* Linked to a DIFFERENT patch (the person picked another one, here or in
         Devices): end that link first. Skipping the connect made the old patch stay
         connected and be adopted below as the "new" one, so choosing another sensor
         silently did nothing. */
      const current = transport === ble ? ble.identity() : null;
      const sameDevice = !current || !identity
        || current.address === identity.address || current.deviceId === identity.deviceId;
      if (linked && !sameDevice) {
        if (engineBusy(get().engine?.state)) {
          set({ error: 'Stop the current recording before connecting another sensor.' });
          return;
        }
        await coordinator?.release().catch(() => {});
        await transport.disconnect().catch(() => {});
      }
      const freshLink = !linked || !sameDevice;
      if (freshLink) await transport.connect(identity as DeviceIdentity);
      /* BLE learns the device's real protocol id during connect — adopt it. */
      if (ble && transport === ble) {
        const real = ble.identity();
        if (real) set({ pairedDevice: real });
      }
      const capabilities = await transport.discoverCapabilities();
      if (!capabilities.length) {
        await transport.disconnect().catch(() => {});
        /* Home shows the first words on one line under the sensor's name. */
        set({ error: 'No sensor connected. The patch paired, but it didn’t find any sensor attached. Check its sensor connections, restart it, then try again.' });
        return;
      }
      /* With a real BLE device connected, stand up the coordinator so Wi-Fi can
         later be preferred and fall back to this same BLE link. */
      if (engine && ble && transport === ble) {
        await coordinator?.dispose(); // let the old Wi-Fi socket tear down before re-seating
        coordinator = new TransportCoordinator({
          engine, ble,
          onChange: (active, wifiState) => {
            if (active === 'wifi') notify('wifi', `Streaming over Wi-Fi${get().wifiSsid ? ` (${get().wifiSsid})` : ''}`, 'Encrypted. Bluetooth stays connected as a backup.', '/devices');
            else if (wifiState === 'reconnecting') notify('wifi', 'Wi-Fi lost', 'Streaming continues over Bluetooth and switches back when Wi-Fi returns.', '/devices');
            set(
            /* Wi-Fi back (first time or after a drop) — the coordinator reconnects by itself. */
            active === 'wifi' ? { activeTransport: 'wifi', wifiStatus: 'connected', wifiError: null }
            /* Dropped mid-stream: Bluetooth already carries the data. Say so, and that
               it is retrying, instead of switching silently and giving up. */
            : wifiState === 'reconnecting' ? { activeTransport: 'bluetooth', wifiStatus: 'failed', wifiError: 'Wi-Fi connection lost. Streaming continues over Bluetooth and will switch back automatically when Wi-Fi returns.' }
            : wifiState === 'connecting_wifi' ? { activeTransport: 'bluetooth', wifiStatus: 'connecting', wifiError: null }
            : { activeTransport: active });
          },
        });
      }
      /* Keep the chosen signals to what the device actually reports, so we never
         record phantom 0-sample channels for a sensor it doesn't stream. If the
         intersection is empty, default to everything the device offers. */
      const capTypes = new Set(capabilities.map((c) => c.sensorType));
      const chosen = get().selected.filter((s) => capTypes.has(s));
      const selected = chosen.length ? chosen : capabilities.map((c) => c.sensorType);
      set({ capabilities, selected, error: null, activeTransport: 'bluetooth' });

      /* Live preview: show every reading the moment the sensor connects, before (and
         without) recording. PPG is the raw optical waveform behind heart rate — the
         heaviest stream and not a reading in itself — so it is streamed only when a
         recording asks for it. A fresh link (or a re-link after a failure) restarts the
         preview; an already-running one is left alone. */
      if (engine) {
        engine.setControlTransport(ble && transport === ble ? ble : null);
        const previewSensors = capabilities.map((c) => c.sensorType).filter((t) => t !== SensorType.Ppg);
        const snap = engine.snapshot();
        if (!engineBusy(snap.state) && (freshLink || !snap.previewing)) {
          await engine.startPreview(Crypto.randomUUID(), previewSensors).catch((e) => {
            if (__DEV__) console.warn('[wearwise] live preview did not start:', e instanceof Error ? e.message : e);
          });
        }
      }

      /* Remember this device in the registry (Devices screen). */
      const idn = (ble && transport === ble) ? get().pairedDevice : identityOf(transport);
      const store = get().storage?.store;
      if (idn && store) {
        const nowIso = new Date().toISOString();
        await store.upsertDevice({
          id: idn.deviceId, displayName: idn.displayName, userId: currentUserId ?? undefined,
          /* Generic on purpose: the app cannot know where or how a sensor is worn. */
          model: transport.type === 'simulation' ? 'In-app simulation' : 'Wearable sensor · Bluetooth',
          firmwareVersion: null, preferredTransport: transport.type, address: idn.address,
          pairedAt: nowIso, lastSeenAt: nowIso,
        }).catch((e) => { if (__DEV__) console.warn('[wearwise] device registry write failed:', e instanceof Error ? e.message : e); });
        set({ devices: await store.listDevices(currentUserId ?? '').catch(() => get().devices) });
      }
      if (ble && transport === ble && idn) void restoreSavedWifi(idn.deviceId);
      /* A sensor the participant connected themselves (not the launch-time reconnect). */
      if (!autoConnecting) void askForPhoneNotificationsOnce();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not connect to the sensor.' });
    }
  },

  select(sensors) { set({ selected: sensors }); },

  async startRecording(userId) {
    const { transport, selected, capabilities, pairedDevice } = get();
    if (!engine || !transport) throw new Error('monitoring not initialised');
    if (!selected.length) throw new Error('select at least one signal');
    /* Recording is when alerts start to matter: the one time the app asks, if it hasn't. */
    void askForPhoneNotificationsOnce();
    const deviceId = transport.type === 'bluetooth'
      ? (pairedDevice?.deviceId ?? 'unknown-device')
      : transportDeviceId(transport);
    await engine.start({
      userId, sensors: selected, deviceId,
      newId: () => Crypto.randomUUID(),
      configuration: {
        deviceName: transport.type === 'simulation' ? 'Simulated Patch' : deviceLabel(get().devices, deviceId, pairedDevice?.displayName ?? 'Wearable'),
        firmwareVersion: null, protocolVersion: 1,
        channels: capabilities.filter((c) => selected.includes(c.sensorType)).map((c) => ({ sensorType: c.sensorType, sampleRateHz: c.sampleRateHz })),
      },
    });

    /* Recording is live and the firmware is streaming (BLE START sent). If Wi-Fi
       was provisioned, hand the read path over to it now. BLE stays the fallback. */
    if (pendingWifi && coordinator && transport === ble && get().activeTransport !== 'wifi') {
      const ok = await coordinator.preferWifi(pendingWifi);
      set(ok ? { activeTransport: 'wifi', wifiStatus: 'connected', wifiError: null }
        : { activeTransport: 'bluetooth', wifiStatus: 'failed', wifiError: 'Could not open the Wi-Fi data stream, so this session is streaming over Bluetooth.' });
    }
  },

  async stopRecording() {
    const snapBefore = engine?.snapshot();
    await engine?.stop();
    const after = engine?.snapshot();
    if (after?.state === 'saved' && snapBefore?.sessionId) {
      const mins = Math.max(1, Math.round(after.elapsedMs / 60000));
      const n = get().selected.length;
      notify('recording', 'Recording saved', `${mins} min · ${n} signal${n === 1 ? '' : 's'}. Open it in History.`, `/session/${snapBefore.sessionId}`);
    }
    /* The engine stops its CURRENT transport — for a Wi-Fi session that is only the
       WebSocket, which cannot carry commands. STOP must go over Bluetooth, or the
       sensor keeps streaming after the session ends (and every BLE reconnect would
       resume it). Then stand Wi-Fi down so the next session starts cleanly. */
    /* With the live preview on, the engine has already switched the sensor back to
       the preview stream, and Wi-Fi keeps carrying it — nothing to stop. */
    if (engine?.snapshot().previewing) return;
    if (ble) await ble.stopStreaming().catch(() => { /* link already gone */ });
    await coordinator?.release();
  },

  /* Provision the device's Wi-Fi over BLE, wait for it to get an IP, then prefer
     the WebSocket. BLE stays connected as the fallback. Returns true if Wi-Fi
     became the active transport. */
  async provisionWifi(ssid, password) {
    const { transport } = get();
    if (!ble || transport !== ble || !coordinator) {
      set({ error: 'Connect over Bluetooth first, then set up Wi-Fi.' });
      return false;
    }
    /* A typing mistake is the form's problem, not the link's: say so before anything
       is sent, and leave the current Wi-Fi status (and network) as it is. */
    if (password.length > 0 && password.length < 8) {
      set({ error: 'Wi-Fi passwords are at least 8 characters. Leave it empty only for an open network.' });
      return false;
    }
    set({ provisioning: true, error: null, wifiStatus: 'connecting', wifiError: null, wifiSsid: ssid });
    try {
      await ble.provisionWifi(ssid, password);
    } catch (e) {
      set({ provisioning: false, wifiStatus: 'failed', wifiError: e instanceof Error ? e.message : 'Wi-Fi setup failed.' });
      return false;
    }
    const ok = await attachWifi(ssid);
    /* Remember the network only once the sensor proved it works. The sensor itself
       keeps it in RAM only, so this secure copy is what lets it rejoin after a reboot. */
    const deviceId = get().pairedDevice?.deviceId ?? ble?.identity()?.deviceId;
    if (ok && deviceId && currentUserId) {
      await saveWifiCredentials(deviceId, { ssid, password }, currentUserId).catch((e) => {
        if (__DEV__) console.warn('[wearwise] could not save Wi-Fi credentials:', e instanceof Error ? e.message : e);
      });
    }
    return ok;
  },

  async keepRecovered(sessionId) {
    /* Interrupted stays interrupted — that is the truth of the session. Keeping
       just removes it from the prompt. */
    set({ recovered: get().recovered.filter((r) => r.session.id !== sessionId) });
  },

  async deleteRecovered(sessionId) {
    await get().storage?.store.deleteSession(sessionId);
    set({ recovered: get().recovered.filter((r) => r.session.id !== sessionId) });
  },

  /* ---- Devices screen actions ---- */

  async disconnect() {
    if (engineBusy(get().engine?.state)) {
      set({ error: 'Stop the recording before disconnecting.' });
      return;
    }
    const { transport } = get();
    await engine?.stopPreview().catch(() => {});
    await coordinator?.release().catch(() => {});
    try { await transport?.disconnect(); } catch { /* already gone */ }
    /* engine.connection updates via onConnectionState; drop discovered capabilities. */
    set({ capabilities: [], error: null });
  },

  /* Re-establish a remembered device: seat the right transport, restore its identity,
     then connect (which re-registers it and refreshes last-seen). */
  async reconnectDevice(device) {
    if (engineBusy(get().engine?.state)) {
      set({ error: 'Stop the current recording first.' });
      return;
    }
    const kind: TransportKind = device.preferredTransport === 'bluetooth' ? 'bluetooth' : 'simulation';
    if (get().transportKind !== kind) get().setTransportKind(kind);
    if (kind === 'bluetooth') {
      set({ pairedDevice: { deviceId: device.id, displayName: device.displayName, address: device.address ?? device.id, transport: 'bluetooth' } });
    }
    await get().connect();
  },

  /* Forget a device: remove it from the registry. Its recorded sessions are kept
     (History still shows the name from each session's snapshot). */
  async renameDevice(id, name) {
    const store = get().storage?.store;
    if (!store || !currentUserId) return;
    const trimmed = name?.trim() ?? '';
    if (trimmed.length > 40) { set({ error: 'Device names can be up to 40 characters.' }); return; }
    await store.renameDevice(id, currentUserId, trimmed || null);
    set({ devices: await store.listDevices(currentUserId).catch(() => get().devices), error: null });
  },

  async forgetDevice(id) {
    if (engineBusy(get().engine?.state)) {
      set({ error: 'Stop the recording before forgetting a device.' });
      return;
    }
    const store = get().storage?.store;
    if (!store) return;
    /* If we're forgetting the device that's connected right now, drop the live link
       too — otherwise it stays connected-but-unlisted, and the next recording would
       be saved under 'unknown-device'. */
    const isPaired = get().pairedDevice?.deviceId === id;
    if (isPaired) {
      await engine?.stopPreview().catch(() => {});
      await coordinator?.release().catch(() => {});
      try { await get().transport?.disconnect(); } catch { /* already gone */ }
    }
    await store.deleteDevice(id, currentUserId ?? '').catch(() => {});
    await forgetWifiCredentials(id);
    const patch: Partial<MonitoringState> = { devices: await store.listDevices(currentUserId ?? '').catch(() => get().devices) };
    if (isPaired) { patch.pairedDevice = null; patch.capabilities = []; }
    set(patch);
  },

  /* ---- fall alarm ---- */

  /* Both resolutions capture the fall and flip the engine/flag state SYNCHRONOUSLY
     before the (async) write, so a re-entrant call — the Live alarm re-renders at
     packet cadence, and its expiry effect can fire onExpire several times before the
     flag settles — records the fall exactly once, never a duplicate. */
  async cancelFall() {
    /* Once the emergency is raised, "I'm OK" no longer applies — the raised alarm shows
       "Dismiss" instead. But React swaps that button on a later commit, so the native
       "I'm OK" stays tappable for one frame after the countdown expires; without this
       guard a tap there would record a second, contradictory 'cancelled' event for the
       same fall and tear the raised alarm down. */
    if (get().fallEmergencyRaised) return;
    const fall = engine?.snapshot().fall;
    if (!fall) return;                         // nothing pending, or a prior tap already cleared it
    engine?.clearFall();                       // clear first → a re-entrant call sees no fall
    set({ fallEmergencyRaised: false });
    fallStep(fall, 'ok');
    await recordFallEvent(get, fall, 'cancelled');
  },

  async raiseFallEmergency() {
    if (get().fallEmergencyRaised) return;     // already raised — record the emergency once
    const fall = engine?.snapshot().fall;
    if (!fall) return;
    set({ fallEmergencyRaised: true });        // flip BEFORE the await so re-entrant calls no-op
    fallStep(fall, 'raised');
    await recordFallEvent(get, fall, 'emergency');
    /* Next step (not yet wired): notify an emergency contact via SMS / push. The fall
       is recorded, and the alarm stays on screen in its "raised" state until dismissed. */
  },

  dismissFallAlarm() {
    const fall = engine?.snapshot().fall;
    engine?.clearFall();
    set({ fallEmergencyRaised: false });
    if (fall) fallStep(fall, 'dismissed');
  },

  /* ---- alerts ---- */

  async refreshAlerts() {
    const store = get().storage?.store;
    if (!store || !currentUserId) return;
    try {
      const [recentAlerts, alertsUnseen] = await Promise.all([store.listAlerts(currentUserId, 100), store.countUnseenAlerts(currentUserId)]);
      set({ recentAlerts, alertsUnseen });
    } catch { /* keep what we have */ }
  },

  async markAlertsSeen() {
    const store = get().storage?.store;
    if (!store || !currentUserId || get().alertsUnseen === 0) return;
    await store.markAlertsSeen(currentUserId).catch(() => {});
    await get().refreshAlerts();
  },

  async deleteAlert(id) {
    const store = get().storage?.store;
    if (!store || !currentUserId) return;
    await store.deleteAlert(id, currentUserId).catch(() => {});
    await get().refreshAlerts();
  },

  async clearAlerts() {
    const store = get().storage?.store;
    if (!store || !currentUserId) return;
    await store.deleteAllAlerts(currentUserId).catch(() => {});
    await get().refreshAlerts();
  },

  /* ---- notifications ---- */

  async refreshNotifications() {
    const store = get().storage?.store;
    if (!store || !currentUserId) return;
    try {
      const [notifications, notificationsUnseen] = await Promise.all([
        store.listNotifications(currentUserId, 100), store.countUnseenNotifications(currentUserId)]);
      set({ notifications, notificationsUnseen });
    } catch { /* keep what we have */ }
  },

  async markNotificationsSeen() {
    const store = get().storage?.store;
    if (!store || !currentUserId || get().notificationsUnseen === 0) return;
    await store.markNotificationsSeen(currentUserId).catch(() => {});
    await get().refreshNotifications();
  },

  async deleteNotification(id) {
    const store = get().storage?.store;
    if (!store || !currentUserId) return;
    await store.deleteNotification(id, currentUserId).catch(() => {});
    await get().refreshNotifications();
  },

  async clearNotifications() {
    const store = get().storage?.store;
    if (!store || !currentUserId) return;
    await store.deleteAllNotifications(currentUserId).catch(() => {});
    await get().refreshNotifications();
  },

  /* ---- health profile ---- */

  async saveHealthProfile(fields) {
    const store = get().storage?.store;
    if (!store || !currentUserId) throw new Error('Not signed in.');
    const profile: HealthProfile = { ...fields, userId: currentUserId, updatedAt: new Date().toISOString() };
    await store.saveHealthProfile(profile);
    set({ healthProfile: profile });
  },

  async forgetWifi() {
    const id = get().pairedDevice?.deviceId;
    if (id) await forgetWifiCredentials(id);
    pendingWifi = null;
    await coordinator?.release().catch(() => {});
    set({ wifiStatus: 'none', wifiError: null, wifiSsid: null, wifiIp: null, activeTransport: 'bluetooth' });
  },

  async savedWifiSsid() {
    const id = get().pairedDevice?.deviceId;
    return id ? (await myWifi(id))?.ssid ?? null : null;
  },

  async autoConnect() {
    if (autoConnectTried || !get().ready) return;
    autoConnectTried = true;
    const snap = get().engine;
    const c = snap?.connection;
    if (c === 'connected_ble' || c === 'connected_wifi' || c === 'connecting' || c === 'reconnecting' || engineBusy(snap?.state)) return;
    const last = get().devices
      .filter((d) => d.preferredTransport === 'bluetooth')
      .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))[0];
    if (!last) return;
    const perm = await ensureBlePermissions();
    if (!perm.granted) return;
    autoConnecting = true;
    try { await get().reconnectDevice(last); } finally { autoConnecting = false; }
    /* Out of range is normal at launch: Home shows "Not connected" with a Reconnect
       button, so an automatic attempt that failed should not leave an error banner. */
    const now = get().engine?.connection;
    if (now !== 'connected_ble' && now !== 'connected_wifi') set({ error: null });
  },
}));

/* Persist one fall with the given outcome. The caller captures the fall before any
   state change, so this never re-reads a snapshot that may have been cleared.
   Best-effort: a failed write must never crash the alarm flow. */
async function recordFallEvent(get: () => MonitoringState, fall: FallSnapshot, status: FallStatus): Promise<void> {
  const store = get().storage?.store;
  if (!store) return;
  const createdAt = fall.atIso;
  /* Inside a recording the fall is also part of that session's record (and syncs
     with it); during live preview there is no session, so it is kept as an alert. */
  if (fall.sessionId) {
    await store.insertFallEvent({
      id: Crypto.randomUUID(), sessionId: fall.sessionId,
      detectedAtMs: fall.atMs, freefallMinG: fall.freefallMinG, impactPeakG: fall.impactPeakG,
      status, createdAt,
    }).catch(() => {});
  }
  /* Falls are alerts too — the Alerts list shows them next to abnormal readings. */
  if (currentUserId) {
    await store.insertAlert({
      id: Crypto.randomUUID(), userId: currentUserId, sessionId: fall.sessionId,
      deviceId: get().pairedDevice?.deviceId ?? null, sensorType: null, kind: 'fall',
      value: fall.impactPeakG, startedAt: createdAt, endedAt: createdAt, seen: false,
    }).catch(() => {});
    void get().refreshAlerts();
  }
}

/* Milestone 3: the simulation is its own device. Milestone 4 replaces this with
   the paired-device registry (devices table). */
const identityOf = (t: SensorTransport) =>
  t instanceof SimulatedSensorTransport
    ? t.identity()
    : { deviceId: 'unknown-device', displayName: 'Wearable', address: '', transport: t.type };
const transportDeviceId = (t: SensorTransport): string => identityOf(t).deviceId;

function dedupeById(list: BleScanResult[]): BleScanResult[] {
  const seen = new Set<string>();
  const out: BleScanResult[] = [];
  for (const d of list) if (!seen.has(d.peripheralId)) { seen.add(d.peripheralId); out.push(d); }
  return out;
}

/* Read access to the store for screens that list history. */
export const getSessionStore = () => useMonitoring.getState().storage?.store ?? null;

/* Best-effort cloud sync must not run on the JS thread while a recording is live —
   it competes with packet ingest and the trace. Callers use this to skip/abort. */
export const isRecording = () => useMonitoring.getState().engine?.state === 'recording';

/* Every streamed sample, full rate, canonical units — for live view. Survives the
   engine being rebuilt (another user signing in). */
export function onLiveSamples(listener: (s: LiveSamples) => void): () => void {
  sampleListeners.add(listener);
  return () => { sampleListeners.delete(listener); };
}

/* Each step of the fall alarm (detected → "I'm OK" | raised → dismissed), for live view. */
export function onLiveFall(listener: (f: FallSnapshot, state: FallState) => void): () => void {
  fallListeners.add(listener);
  return () => { fallListeners.delete(listener); };
}

/* The fall whose alarm is on screen now, if any, and where it is. */
export function currentFall(): { fall: FallSnapshot; state: FallState } | null {
  const { engine: snap, fallEmergencyRaised } = useMonitoring.getState();
  return snap?.fall ? { fall: snap.fall, state: fallEmergencyRaised ? 'raised' : 'detected' } : null;
}

/* What live view says about the source: the sensor's own advertised name (what a
   researcher setting it up recognises, not the participant's nickname for it), whether
   readings are simulated, and which signals have reported in the last 10 s. */
export function liveSource(): {
  connected: boolean; connection: EngineSnapshot['connection'] | undefined; device: string; simulated: boolean; streamed: SensorType[];
  link: 'bluetooth' | 'wifi' | 'simulation'; firmware: string | null; sensors: SensorType[];
} {
  const { engine: snap, transportKind, pairedDevice, activeTransport, capabilities } = useMonitoring.getState();
  const connected = snap?.connection === 'connected_ble' || snap?.connection === 'connected_wifi';
  const simulation = transportKind === 'simulation';
  const now = Date.now();
  const streamed = (Object.entries(snap?.channels ?? {}) as [string, { lastAtMs: number } | undefined][])
    .filter(([, ch]) => ch && ch.lastAtMs > 0 && now - ch.lastAtMs <= 10_000)
    .map(([t]) => Number(t) as SensorType);
  return {
    connected, connection: snap?.connection,
    device: simulation ? 'Simulated Patch' : pairedDevice?.displayName ?? 'WearWise patch',
    simulated: simulation || !!snap?.simulated,
    streamed,
    /* How the phone gets the patch's data right now, and its firmware (never the Wi-Fi
       network's name: that can say where someone lives). */
    link: simulation ? 'simulation' : activeTransport === 'wifi' ? 'wifi' : 'bluetooth',
    firmware: simulation ? null : pairedDevice?.firmwareVersion ?? null,
    /* What the patch has, streaming or not (heart rate needs a finger first). */
    sensors: connected ? capabilities.map((c) => c.sensorType) : [],
  };
}

export function clearMonitoringForSignOut(): void {
  const oldEngine = engine;
  const oldTransport = useMonitoring.getState().transport;
  // Stop ingestion immediately; finish buffered writes into the encrypted store.
  oldEngine?.dispose();
  void oldEngine?.stop().catch(() => {});
  void oldTransport?.disconnect().catch(() => {});
  teardownMonitoring();
  currentUserId = null;
  useMonitoring.setState(INITIAL_MONITORING);
}

/* The name to show for a device id: the participant's own name for it when they gave
   one, otherwise `fallback` (the advertised name, or the name saved with a recording). */
export const deviceLabel = (devices: DeviceRecord[], deviceId: string | null | undefined, fallback: string): string => {
  const d = deviceId ? devices.find((x) => x.id === deviceId) : undefined;
  return d ? deviceName(d) : fallback;
};
