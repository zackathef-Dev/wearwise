import React from 'react';
import { View, ScrollView, Pressable, Image } from 'react-native';
import { Redirect, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring, getSessionStore, deviceLabel } from '@/features/monitoring/monitoring-store';
import { LiveVitals } from '@/features/monitoring/LiveVitals';
import { RecordPanel } from '@/features/monitoring/RecordPanel';
import { LiveViewBanner } from '@/features/live-view/LiveView';
import { useAvatar } from '@/features/profile/avatar';
import { Avatar } from '@/shared/components/Avatar';
import { AlertRow } from '@/features/alerts/AlertRow';
import { useSync } from '@/features/sync/sync-store';
import type { SessionSummaryRow } from '@/domain/repositories/session-store';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Icon } from '@/shared/icons/Icon';
import { Micro, SectionLabel, StatStrip, Alert, IconButton } from '@/shared/components/kit';
import { Breathe, Halo, Spin } from '@/shared/components/motion';

/* HOME — what the sensor says right now. The moment a sensor connects its readings
 * stream here (live preview — nothing is saved): the ECG strip on top, the vitals as
 * tiles with a Normal / Below normal / High label, a tapped tile's graph under the
 * ECG. Below: recording itself (pick what to save, start, stop — no separate page),
 * the latest alerts, and the week. The bell opens the notifications list.
 */

const DAY = 864e5;

export default function Home() {
  const router = useRouter();
  const { colors, dark } = useTheme();
  const { status, participant } = useAuth();
  /* Narrow selectors only: Home stays mounted under every other route, and the engine
     snapshot changes ~15×/s. The live readings subscribe inside <LiveVitals>. */
  const init = useMonitoring((s) => s.init);
  const autoConnect = useMonitoring((s) => s.autoConnect);
  const reconnectDevice = useMonitoring((s) => s.reconnectDevice);
  const devices = useMonitoring((s) => s.devices);
  const ready = useMonitoring((s) => s.ready);
  const storage = useMonitoring((s) => s.storage);
  const recovered = useMonitoring((s) => s.recovered);
  const transportKind = useMonitoring((s) => s.transportKind);
  const pairedDevice = useMonitoring((s) => s.pairedDevice);
  const connection = useMonitoring((s) => s.engine?.connection);
  const engineState = useMonitoring((s) => s.engine?.state);
  const linkError = useMonitoring((s) => s.error);
  const connect = useMonitoring((s) => s.connect);
  const activeTransport = useMonitoring((s) => s.activeTransport);
  const wifiSsid = useMonitoring((s) => s.wifiSsid);
  const pairingPrompt = useMonitoring((s) => s.pairingPrompt);
  const alerts = useMonitoring((s) => s.recentAlerts);
  const unseen = useMonitoring((s) => s.alertsUnseen);
  const unseenNotes = useMonitoring((s) => s.notificationsUnseen);
  const { phase: syncPhase, pending: syncPending, refreshPending, syncNow, restoredAt } = useSync();
  const [rows, setRows] = React.useState<SessionSummaryRow[]>([]);
  const [connecting, setConnecting] = React.useState(false);
  /* Why the last connect failed: one line on the card, the rest on "More". Collapsed
     again whenever the reason changes. */
  const [whyFor, setWhyFor] = React.useState<string | null>(null);
  const participantId = participant?.id;
  const avatarUri = useAvatar((s) => s.uri);
  const loadAvatar = useAvatar((s) => s.load);
  React.useEffect(() => { if (participantId) loadAvatar(participantId); }, [participantId, loadAvatar]);

  React.useEffect(() => { if (participantId) void init(participantId); }, [participantId, init]);
  /* Once the store is ready, bring the last sensor back so its readings appear here. */
  React.useEffect(() => { if (ready) void autoConnect(); }, [ready, autoConnect]);
  useFocusEffect(React.useCallback(() => {
    const store = getSessionStore();
    if (!store || !participantId || !ready) return;
    let alive = true;
    void store.listSessions(participantId, 100).then((r) => { if (alive) setRows(r); });
    const t = setTimeout(() => { void refreshPending(participantId).then(() => syncNow(participantId)); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [participantId, ready, refreshPending, syncNow]));
  React.useEffect(() => {
    const store = getSessionStore();
    if (!restoredAt || !store || !participantId || !ready) return;
    void store.listSessions(participantId, 100).then(setRows);
  }, [restoredAt, participantId, ready]);
  /* A recording is usually stopped here, on Home, so focus never changes: reload the
     list (and "This week") when one is saved. */
  React.useEffect(() => {
    const store = getSessionStore();
    if (engineState !== 'saved' || !store || !participantId || !ready) return;
    void store.listSessions(participantId, 100).then(setRows);
  }, [engineState, participantId, ready]);

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  const firstName = participant?.displayName.split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const connected = connection === 'connected_ble' || connection === 'connected_wifi';
  const linking = connecting || connection === 'connecting' || connection === 'reconnecting' || connection === 'scanning';
  const isBle = transportKind === 'bluetooth';
  const lastBle = [...devices].filter((d) => d.preferredTransport === 'bluetooth')
    .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))[0];
  /* The simulation only takes the card while it is actually running. Otherwise the
     card is about the participant's real sensor: the last one connected, offered
     for Reconnect, or a Pair prompt if there has never been one. (`connecting` is
     our own Reconnect in flight — a real sensor, even while the transport still
     says simulation.) */
  const simRunning = !isBle && (connected || (linking && !connecting));
  const deviceName = simRunning ? 'Simulated Patch'
    : isBle && pairedDevice ? deviceLabel(devices, pairedDevice.deviceId, pairedDevice.displayName)
    : lastBle ? deviceLabel(devices, lastBle.id, lastBle.displayName)
    : 'No sensor yet';
  const linkText = !ready ? 'Preparing…'
    : pairingPrompt ? 'Type the patch’s 6-digit PIN when your phone asks'
    : linking ? (connection === 'reconnecting' || connecting ? 'Reconnecting…' : 'Connecting…')
    : connected ? (isBle ? (activeTransport === 'wifi' ? `Live · Wi-Fi${wifiSsid ? ` (${wifiSsid})` : ''}` : 'Live · Bluetooth') : 'Live · simulation')
    : 'Not connected';
  const problem = !ready || connected || linking || pairingPrompt ? null : linkError;
  const showWhy = !!problem && whyFor === problem;

  /* A sensor picked in Pair that hasn't paired yet isn't in the device list: Reconnect
     retries THAT one (the card names it), not the last sensor that did pair. */
  const unpaired = isBle && pairedDevice && !devices.some((d) => d.id === pairedDevice.deviceId) ? pairedDevice : null;
  const onConnect = async () => {
    if (!lastBle && !unpaired) { router.push('/pair'); return; }
    setConnecting(true);
    try { await (unpaired ? connect() : reconnectDevice(lastBle!)); } finally { setConnecting(false); }
  };

  /* ---- this week ---- */
  // eslint-disable-next-line react-hooks/purity
  const weekAgo = Date.now() - 7 * DAY;
  const week = rows.filter((r) => r.session.status !== 'discarded' && Date.parse(r.session.startedAt) >= weekAgo);
  const weekMinutes = week.reduce((a, r) => a + (r.session.durationMs ?? 0), 0) / 60000;
  const total = rows.length;
  const uploaded = Math.max(0, total - syncPending);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        {/* header: the WearWise wordmark on top, then the greeting */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Image
              source={dark ? require('@/assets/brand/wearwise-wordmark-white.png') : require('@/assets/brand/wearwise-wordmark.png')}
              style={{ width: 132, height: 22, resizeMode: 'contain' }}
              accessibilityLabel="WearWise"
            />
          </View>
          <View>
            <IconButton icon="bell" label={unseenNotes ? `Notifications, ${unseenNotes} new` : 'Notifications'} onPress={() => router.push('/notifications')} />
            {unseenNotes > 0 && (
              <View pointerEvents="none" style={{ position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
                backgroundColor: colors.wwError, alignItems: 'center', justifyContent: 'center' }}>
                <Typo variant="caption" color={colors.wwWhite} style={{ fontSize: 10.5 }}>{unseenNotes > 9 ? '9+' : unseenNotes}</Typo>
              </View>
            )}
          </View>
          <Pressable onPress={() => router.navigate('/profile')} accessibilityRole="button" accessibilityLabel="Profile">
            <Avatar uri={avatarUri} name={participant?.displayName ?? ''} size={36} />
          </Pressable>
        </View>
        <View style={{ gap: 5, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 }}>
          <Micro>{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</Micro>
          <Typo variant="h2" accessibilityRole="header" style={{ fontSize: 22 }}>{greeting}, {firstName}</Typo>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 18 }}>
          {/* device strip */}
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            {/* The dot and the link icon breathe while linking and stop when it ends; the
                moment the link comes up, the dot pings once — then everything is still. */}
            <Halo size={10} color={colors.stateConnected} beat={connected} spread={3.2} ringWidth={0}>
              <Breathe active={linking} shrink={0.75} style={{ width: 10, height: 10, borderRadius: 5,
                backgroundColor: connected ? colors.stateConnected : linking ? colors.statePending : colors.stateOffline }} />
            </Halo>
            <Pressable style={{ flex: 1, gap: 3 }} onPress={() => router.navigate('/devices')} accessibilityRole="button">
              <Typo variant="label" style={{ fontSize: 14 }} numberOfLines={1}>{deviceName}</Typo>
              {problem ? (
                <Pressable onPress={() => setWhyFor(showWhy ? null : problem)} accessibilityRole="button"
                  accessibilityLabel={showWhy ? problem : `Couldn't connect. ${problem}`} accessibilityHint={showWhy ? 'Shows less' : 'Shows the whole message'}
                  hitSlop={6} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                  <Typo variant="caption" color={colors.statusWarningText} numberOfLines={showWhy ? undefined : 1} style={{ flex: 1 }}>{problem}</Typo>
                  <Typo variant="caption" color={colors.textLink}>{showWhy ? 'Less' : 'More'}</Typo>
                </Pressable>
              ) : (
                <Typo variant="caption" color={connected ? colors.textSecondary : colors.textMuted} numberOfLines={1}>{linkText}</Typo>
              )}
            </Pressable>
            {connected || linking || !ready
              ? (
                <Breathe active={linking}>
                  <Icon name={activeTransport === 'wifi' && connected ? 'wifi' : simRunning ? 'cpu' : 'bluetooth'} size={18} color={connected ? colors.stateConnected : colors.textMuted} />
                </Breathe>
              )
              : <Button size="md" variant={lastBle || unpaired ? 'primary' : 'secondary'} onPress={() => void onConnect()}>{unpaired ? 'Try again' : lastBle ? 'Reconnect' : 'Pair a device'}</Button>}
          </Card>

          {/* live view for setup: who can watch, time left, Stop */}
          <LiveViewBanner />

          {recovered.length > 0 && (
            <Pressable onPress={() => router.push('/history')} accessibilityRole="button">
              <Alert kind="warning" title="A recording was interrupted">Open History to keep or delete it.</Alert>
            </Pressable>
          )}
          {storage?.mode === 'memory-only' && <Alert kind="warning" title="Recordings won’t be kept">{storage.reason}</Alert>}

          {/* live readings */}
          <LiveVitals connected={connected} />

          {/* recording — right here, no separate page */}
          <RecordPanel connected={connected} />

          {/* alerts */}
          <View style={{ gap: 10 }}>
            <SectionLabel action={<Button variant="ghost" size="md" onPress={() => router.navigate('/alerts')}>See all</Button>}>
              {unseen ? `Alerts · ${unseen} new` : 'Alerts'}
            </SectionLabel>
            {alerts.length === 0 ? (
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="circle-check" size={18} color={colors.stateConnected} />
                <Typo variant="bodySm" color={colors.textSecondary} style={{ flex: 1 }}>No abnormal readings.</Typo>
              </Card>
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {alerts.slice(0, 3).map((a, i, arr) => (
                  <AlertRow key={a.id} alert={a} withDate last={i === arr.length - 1} onPress={() => router.navigate('/alerts')} />
                ))}
              </Card>
            )}
          </View>

          {/* this week */}
          <View style={{ gap: 12 }}>
            <SectionLabel>This week</SectionLabel>
            <Card style={{ paddingVertical: 16 }}>
              <StatStrip size="sm" items={[
                { value: `${Math.round(weekMinutes)}`, unit: 'min', label: 'Recorded' },
                { value: `${week.length}`, label: week.length === 1 ? 'Session' : 'Sessions' },
                { value: total ? `${uploaded}/${total}` : '—', label: 'Backed up' },
              ]} />
            </Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2 }}>
              {/* The refresh glyph turns only while a backup is actually running. */}
              {syncPhase === 'syncing'
                ? <Spin><Icon name="refresh-cw" size={17} color={colors.textMuted} /></Spin>
                : <Icon name="cloud" size={17} color={colors.textMuted} />}
              <Typo variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                {syncPhase === 'syncing' ? 'Backing up…' : syncPending > 0 ? `${syncPending} session${syncPending === 1 ? '' : 's'} to back up` : `All backed up · ${total} stored`}
              </Typo>
              <Button variant="ghost" size="md" onPress={() => participant && void syncNow(participant.id)}>Sync</Button>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
