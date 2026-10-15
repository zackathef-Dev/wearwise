import React from 'react';
import { Platform, View, ScrollView, Switch as RNSwitch } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deviceName, type DeviceRecord } from '@/domain/entities/session';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { prefs } from '@/platform/kv/kv';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { FormField } from '@/shared/components/FormField';
import { Icon } from '@/shared/icons/Icon';
import { Micro, SectionLabel, Badge, Alert, IconButton } from '@/shared/components/kit';
import { Breathe, Halo } from '@/shared/components/motion';
import { WifiSection } from '@/features/monitoring/WifiSection';

/* DEVICES — the registry of devices this phone has connected to. Each row can be
 * reconnected, disconnected (if it is the live one) or forgotten. Forgetting only
 * removes the registry entry; the sessions it recorded stay in History. */

const fmtSeen = (iso: string | null): string => {
  if (!iso) return 'not yet connected';
  return `last connected ${new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
};

export default function Devices() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status } = useAuth();
  /* Narrow selectors — this tab stays mounted, so it must not subscribe to the whole
     store (which churns at ~15 fps during a recording). `connected` is derived in the
     selector so we don't hold the engine snapshot. */
  const transportKind = useMonitoring((s) => s.transportKind);
  const pairedDevice = useMonitoring((s) => s.pairedDevice);
  const devices = useMonitoring((s) => s.devices);
  const error = useMonitoring((s) => s.error);
  const connected = useMonitoring((s) => s.engine?.connection === 'connected_ble' || s.engine?.connection === 'connected_wifi');
  const disconnect = useMonitoring((s) => s.disconnect);
  const setTransportKind = useMonitoring((s) => s.setTransportKind);
  const connect = useMonitoring((s) => s.connect);
  const reconnectDevice = useMonitoring((s) => s.reconnectDevice);
  const linkState = useMonitoring((s) => s.engine?.connection);
  const pairingPrompt = useMonitoring((s) => s.pairingPrompt);
  /* The device the participant just asked to reconnect — shown as "Reconnecting…"
     from the tap until the link is up (or the attempt fails). */
  const [reconnectingId, setReconnectingId] = React.useState<string | null>(null);
  const onReconnect = async (d: DeviceRecord) => {
    setReconnectingId(d.id);
    try { await reconnectDevice(d); } finally { setReconnectingId(null); }
  };
  const forgetDevice = useMonitoring((s) => s.forgetDevice);
  const renameDevice = useMonitoring((s) => s.renameDevice);
  const [autoSync, setAutoSync] = React.useState(() => prefs.getString('pref.autoSync') !== '0');
  const [confirmForget, setConfirmForget] = React.useState<string | null>(null);
  /* Inline rename: which device is being renamed, and the draft name. */
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [nameDraft, setNameDraft] = React.useState('');
  const startRename = (d: DeviceRecord) => { setConfirmForget(null); setNameDraft(deviceName(d)); setRenaming(d.id); };
  const saveRename = async (d: DeviceRecord, name: string | null) => {
    /* Saving the advertised name unchanged is the same as having no custom name. */
    await renameDevice(d.id, name && name.trim() !== d.displayName ? name : null);
    setRenaming(null);
  };

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  /* Which listed device is the one currently streaming. */
  const isLive = (d: DeviceRecord) => connected && (
    (transportKind === 'bluetooth' && d.id === pairedDevice?.deviceId) ||
    (transportKind === 'simulation' && d.preferredTransport === 'simulation')
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }} edges={['top']}>
      {/* "handled": Save / Use original name work on the first tap while the rename
          keyboard is open, instead of the first tap only dismissing the keyboard. */}
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
          <Typo variant="h2" accessibilityRole="header" style={{ flex: 1 }}>Devices</Typo>
          <IconButton icon="plus" label="Add device" onPress={() => router.push('/pair')} />
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 16 }}>
          {error ? <Alert kind="warning">{error}</Alert> : null}

          <SectionLabel>{devices.length ? `Your devices · ${devices.length}` : 'Your devices'}</SectionLabel>

          {devices.length === 0 ? (
            <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 26 }}>
              <Icon name="watch" size={26} color={colors.textMuted} />
              <Typo variant="label">No devices yet</Typo>
              <Typo variant="caption" style={{ textAlign: 'center' }}>
                Start a session with the simulation, or pair a WearWise patch — it will appear here.
              </Typo>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button size="md" variant="secondary" onPress={() => { setTransportKind('simulation'); void connect(); router.navigate('/home'); }}>Use Simulation</Button>
                <Button size="md" onPress={() => router.push('/pair')}>Pair a Device</Button>
              </View>
            </Card>
          ) : devices.map((d) => {
            const live = isLive(d);
            /* Reconnecting: a tap on Reconnect, or the app's own automatic reconnect
               after a drop / sensor reboot. */
            const busy = !live && (reconnectingId === d.id || (d.id === pairedDevice?.deviceId
              && (linkState === 'connecting' || linkState === 'reconnecting' || linkState === 'scanning')));
            const isBle = d.preferredTransport === 'bluetooth';
            return (
              <Card key={d.id} style={{ gap: 14, padding: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  {/* Breathes while reconnecting; on connecting, one teal ring and it settles. */}
                  <Halo size={52} color={colors.wwTeal} beat={live} spread={1.45}>
                    <Breathe active={busy} dim={0.45} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 3,
                      borderColor: live ? colors.wwTeal : colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={isBle ? 'bluetooth' : 'cpu'} size={22} color={live ? colors.wwTeal : colors.textMuted} />
                    </Breathe>
                  </Halo>
                  <View style={{ flex: 1, gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Typo variant="label" style={{ fontSize: 15.5 }} numberOfLines={1}>{deviceName(d) || (isBle ? 'Wearable sensor' : 'Simulated Patch')}</Typo>
                      {live && <Badge tone="success" size="sm">Connected</Badge>}
                      {busy && (
                        <Badge tone="warning" size="sm">{pairingPrompt ? 'Waiting for pairing code' : 'Reconnecting…'}</Badge>
                      )}
                    </View>
                    {/* With a custom name, keep the device's own name visible so it can
                        always be told apart from another patch. */}
                    <Micro>{d.customName ? `${d.displayName} · ` : ''}{d.model ?? (isBle ? 'Wearable sensor' : 'Simulation')}</Micro>
                    <Typo variant="caption" color={colors.textMuted}>{fmtSeen(d.lastSeenAt)}</Typo>
                    {busy && pairingPrompt && (
                      <Typo variant="caption" color={colors.statusWarningText} accessibilityLiveRegion="polite">
                        Type the 6-digit PIN from the patch&apos;s label in your phone&apos;s pairing request.
                        {Platform.OS === 'android' ? ' Android suggests 0000 or 1234: ignore that. The digits are on the top row of the keyboard.' : ''}
                      </Typo>
                    )}
                  </View>
                </View>

                {renaming === d.id ? (
                  <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.borderDefault, paddingTop: 12 }}>
                    <FormField label="Device name" value={nameDraft} onChangeText={setNameDraft}
                      placeholder={d.displayName} maxLength={40} autoFocus autoCapitalize="sentences"
                      returnKeyType="done" onSubmitEditing={() => void saveRename(d, nameDraft)} />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button size="md" variant="secondary" style={{ flex: 1 }} onPress={() => setRenaming(null)}>Cancel</Button>
                      <Button size="md" style={{ flex: 1 }} disabled={!nameDraft.trim()} onPress={() => void saveRename(d, nameDraft)}>Save</Button>
                    </View>
                    {d.customName ? (
                      <Button size="md" variant="ghost" onPress={() => void saveRename(d, null)}>{`Use original name (${d.displayName})`}</Button>
                    ) : null}
                  </View>
                ) : confirmForget === d.id ? (
                  <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.borderDefault, paddingTop: 12 }}>
                    <Typo variant="bodySm">Forget this device? Its past recordings stay in History.</Typo>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button size="md" variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmForget(null)}>Cancel</Button>
                      <Button size="md" style={{ flex: 1 }} onPress={() => { setConfirmForget(null); void forgetDevice(d.id); }}>Forget</Button>
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {live ? (
                      <Button size="md" variant="secondary" style={{ flex: 1 }} onPress={() => void disconnect()}>Disconnect</Button>
                    ) : (
                      <Button size="md" style={{ flex: 1 }} disabled={busy} onPress={() => void onReconnect(d)}>
                        {busy ? 'Reconnecting…' : 'Reconnect'}
                      </Button>
                    )}
                    {/* Mid-reconnect, renaming or forgetting makes no sense — and dropping
                        them gives "Reconnecting…" the room to fit on one line. The ghost
                        buttons have no outline, so tighter padding leaves the main action
                        enough width for "Disconnect" at full size. */}
                    {!busy && <Button size="md" variant="ghost" style={{ paddingHorizontal: 12 }} onPress={() => startRename(d)}>Rename</Button>}
                    {!busy && <Button size="md" variant="ghost" style={{ paddingHorizontal: 12 }} onPress={() => { setRenaming(null); setConfirmForget(d.id); }}>Forget</Button>}
                  </View>
                )}
              </Card>
            );
          })}

          {/* The empty state already offers "Pair a Device"; this is the "add another"
              action, so it only appears once there is a device in the list. */}
          {devices.length > 0 && (
            <Button variant="secondary" onPress={() => router.push('/pair')}>Pair a New Device</Button>
          )}

          <SectionLabel>Wi-Fi streaming</SectionLabel>
          <WifiSection />

          <SectionLabel>Connection</SectionLabel>
          <Card style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Typo variant="label">Automatic sync</Typo>
                <Typo variant="caption" color={colors.textMuted}>Upload sessions when you’re online.</Typo>
              </View>
              <RNSwitch value={autoSync} onValueChange={(v) => { setAutoSync(v); prefs.set('pref.autoSync', v ? '1' : '0'); }}
                trackColor={{ true: colors.actionPrimary, false: colors.surfaceTrack }} thumbColor={colors.controlKnob} />
            </View>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
