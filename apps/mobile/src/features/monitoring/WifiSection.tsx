import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Icon } from '@/shared/icons/Icon';
import { Badge } from '@/shared/components/kit';
import { Breathe, Halo } from '@/shared/components/motion';

/* Devices → Wi-Fi streaming: the connected sensor's Wi-Fi in one place — whether it
 * is joined, which link is carrying data right now, the network this phone has saved
 * for it, and the set-up / change / forget actions. Everything is written in words.
 */
export function WifiSection() {
  const router = useRouter();
  const { colors } = useTheme();
  const transportKind = useMonitoring((s) => s.transportKind);
  const connected = useMonitoring((s) => s.engine?.connection === 'connected_ble' || s.engine?.connection === 'connected_wifi');
  const wifiStatus = useMonitoring((s) => s.wifiStatus);
  const wifiSsid = useMonitoring((s) => s.wifiSsid);
  const wifiError = useMonitoring((s) => s.wifiError);
  const activeTransport = useMonitoring((s) => s.activeTransport);
  const deviceId = useMonitoring((s) => s.pairedDevice?.deviceId);
  const forgetWifi = useMonitoring((s) => s.forgetWifi);
  const savedWifiSsid = useMonitoring((s) => s.savedWifiSsid);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [confirmForget, setConfirmForget] = React.useState(false);

  /* Re-read the saved network whenever the sensor or its Wi-Fi state changes. */
  React.useEffect(() => {
    let alive = true;
    void savedWifiSsid().then((s) => { if (alive) setSaved(s); });
    return () => { alive = false; };
  }, [deviceId, wifiStatus, savedWifiSsid]);

  const isBle = transportKind === 'bluetooth';
  const ready = isBle && connected;
  const network = wifiSsid ?? saved;

  const tone = wifiStatus === 'connected' ? 'success' : wifiStatus === 'connecting' ? 'warning' : wifiStatus === 'failed' ? 'error' : 'neutral';
  const label = !isBle ? 'Not available' : !connected ? 'Sensor not connected'
    : wifiStatus === 'connected' ? 'Connected' : wifiStatus === 'connecting' ? 'Connecting…' : wifiStatus === 'failed' ? 'Not connected' : 'Not set up';

  return (
    <Card style={{ gap: 14, padding: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {/* Breathes while the sensor joins the network; one ring when it has joined. */}
        <Halo size={40} color={colors.stateConnected} beat={wifiStatus === 'connected' && connected} spread={1.5}>
          <Breathe active={connected && wifiStatus === 'connecting'}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="wifi" size={20} color={wifiStatus === 'connected' && connected ? colors.stateConnected : colors.textMuted} />
          </Breathe>
        </Halo>
        <View style={{ flex: 1, gap: 4 }}>
          <Typo variant="label" style={{ fontSize: 15 }}>{network ?? 'No network'}</Typo>
          <Badge tone={connected ? tone : 'neutral'} size="sm">{label}</Badge>
        </View>
      </View>

      {!isBle ? (
        <Typo variant="caption" color={colors.textMuted}>The simulation has no radio. Pair a WearWise sensor to stream over Wi-Fi.</Typo>
      ) : (
        <View style={{ gap: 6 }}>
          {connected && (
            <Row icon={activeTransport === 'wifi' ? 'wifi' : 'bluetooth'}
              text={activeTransport === 'wifi' ? 'Live data is coming over Wi-Fi (encrypted). Bluetooth stays connected as a backup.'
                : wifiStatus === 'connected' ? 'Live data is coming over Bluetooth; it switches to Wi-Fi as soon as the stream opens.'
                : 'Live data is coming over Bluetooth.'} />
          )}
          {wifiStatus === 'failed' && wifiError && connected && <Row icon="circle-alert" text={wifiError} tone="error" />}
          {saved
            ? <Row icon="shield-check" text={`“${saved}” is saved only on this phone, in its secure storage. The sensor is given it over encrypted Bluetooth each time it connects and forgets it when switched off.`} />
            : <Row icon="info" text="Set up Wi-Fi to stream over your network — useful when the phone is further away than Bluetooth reaches." />}
          {!connected && <Row icon="bluetooth-off" text="Connect the sensor to change its Wi-Fi." />}
        </View>
      )}

      {confirmForget ? (
        <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.borderDefault, paddingTop: 12 }}>
          <Typo variant="bodySm">Forget “{saved}” on this phone? Data switches back to Bluetooth. The sensor drops the network the next time it restarts.</Typo>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmForget(false)}>Cancel</Button>
            <Button size="md" style={{ flex: 1 }} onPress={() => { setConfirmForget(false); void forgetWifi().then(() => setSaved(null)); }}>Forget</Button>
          </View>
        </View>
      ) : isBle && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button size="md" style={{ flex: 1 }} disabled={!ready} onPress={() => router.push('/wifi')}>
            {saved || wifiStatus !== 'none' ? 'Change network' : 'Set up Wi-Fi'}
          </Button>
          {saved && <Button size="md" variant="ghost" onPress={() => setConfirmForget(true)}>Forget</Button>}
        </View>
      )}
    </Card>
  );
}

function Row({ icon, text, tone }: { icon: string; text: string; tone?: 'error' }) {
  const { colors } = useTheme();
  const fg = tone === 'error' ? colors.statusErrorText : colors.textSecondary;
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <Icon name={icon} size={14} color={fg} />
      <Typo variant="caption" color={fg} style={{ flex: 1 }}>{text}</Typo>
    </View>
  );
}
