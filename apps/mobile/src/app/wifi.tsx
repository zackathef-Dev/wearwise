import React from 'react';
import { View, ScrollView } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring, deviceLabel } from '@/features/monitoring/monitoring-store';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { FormField } from '@/shared/components/FormField';
import { Icon } from '@/shared/icons/Icon';
import { Spin } from '@/shared/components/motion';

/* Wi-Fi setup — provision the connected patch onto a network so it can stream over
 * a WebSocket (faster, no BLE MTU cap). Credentials go to the device over the
 * already-trusted BLE link and are never logged. Bluetooth stays connected as the
 * fallback, so this never risks the live stream.
 *
 * The screen stays put after an attempt and says how it went — connected (with the
 * address) or failed (with why) — rather than navigating away before it can be read.
 */
export default function WifiSetup() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status } = useAuth();
  const { transportKind, pairedDevice, activeTransport, provisioning, provisionWifi, error, devices, wifiStatus, wifiError, wifiSsid } = useMonitoring();
  const [ssid, setSsid] = React.useState('');
  const [password, setPassword] = React.useState('');
  /* Already on Wi-Fi: the form stays hidden until they ask to use another network. */
  const [changing, setChanging] = React.useState(false);

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  const notBle = transportKind !== 'bluetooth' || !pairedDevice;
  const name = pairedDevice ? deviceLabel(devices, pairedDevice.deviceId, pairedDevice.displayName) : 'Your sensor';
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const submit = async () => {
    const network = ssid.trim();
    if (await provisionWifi(network, password)) { setPassword(''); setChanging(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 4 }}>
          <Typo variant="h2" accessibilityRole="header">Set up Wi-Fi</Typo>
          <Typo variant="caption">
            {name} will join this network and stream over Wi-Fi. Bluetooth stays connected as a backup.
          </Typo>
        </View>

        {notBle && (
          <Card style={{ backgroundColor: colors.statusWarningBg, borderColor: colors.borderWarning }}>
            <Typo variant="bodySm" color={colors.statusWarningText}>
              Connect to your sensor over Bluetooth first, then come back to set up Wi-Fi.
            </Typo>
          </Card>
        )}

        {/* ---- result of the last attempt: always in words, with an icon ---- */}
        {wifiStatus === 'connecting' && (
          <Card style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }} accessibilityLiveRegion="polite">
            {/* Mounted only while joining, so the loader turns exactly as long as the work. */}
            <Spin><Icon name="loader-circle" size={18} color={colors.textSecondary} /></Spin>
            <Typo variant="bodySm" style={{ flex: 1 }}>Connecting {name} to {wifiSsid ?? 'Wi-Fi'}… this can take up to 20 seconds.</Typo>
          </Card>
        )}
        {wifiStatus === 'connected' && (
          <Card style={{ gap: 6, backgroundColor: colors.statusSuccessBg, borderColor: colors.stateConnected }} accessibilityLiveRegion="polite">
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Icon name="wifi" size={18} color={colors.statusSuccessText} />
              <Typo variant="label" color={colors.statusSuccessText}>Wi-Fi connected</Typo>
            </View>
            <Typo variant="bodySm" color={colors.statusSuccessText}>
              {name} is connected to {wifiSsid ?? 'the network'}.{' '}
              {activeTransport === 'wifi'
                ? 'Data is streaming over Wi-Fi now.'
                : 'Data switches to Wi-Fi when you start monitoring.'}
            </Typo>
          </Card>
        )}
        {wifiStatus === 'failed' && (
          <Card style={{ gap: 6, backgroundColor: colors.statusErrorBg, borderColor: colors.borderError }} accessibilityLiveRegion="assertive">
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Icon name="circle-alert" size={18} color={colors.statusErrorText} />
              <Typo variant="label" color={colors.statusErrorText}>Wi-Fi not connected</Typo>
            </View>
            <Typo variant="bodySm" color={colors.statusErrorText}>{wifiError ?? 'Wi-Fi setup failed.'}</Typo>
            <Typo variant="caption" color={colors.statusErrorText}>Bluetooth is still connected, so you can keep using the sensor.</Typo>
          </Card>
        )}

        {wifiStatus === 'connected' && !changing ? (
          <>
            <Button size="lg" onPress={leave}>Done</Button>
            <Button variant="ghost" onPress={() => setChanging(true)}>Use a different network</Button>
          </>
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <FormField label="Network name (SSID)" value={ssid} onChangeText={setSsid}
                autoCapitalize="none" autoCorrect={false} placeholder="MyWiFi" editable={!provisioning} />
              <Typo variant="micro" color={colors.textMuted}>The sensor supports 2.4 GHz networks only.</Typo>
            </View>
            <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry
              autoCapitalize="none" placeholder="Wi-Fi password" editable={!provisioning}
              returnKeyType="go" onSubmitEditing={() => void submit()} />

            {error && <Typo variant="bodySm" color={colors.statusErrorText}>{error}</Typo>}

            <Button size="lg" onPress={() => void submit()} disabled={notBle || provisioning || ssid.trim().length === 0}>
              {provisioning ? 'Connecting the sensor to Wi-Fi…' : wifiStatus === 'failed' ? 'Try again' : 'Connect over Wi-Fi'}
            </Button>
            <Button variant="ghost" onPress={changing ? () => setChanging(false) : leave}>Cancel</Button>
          </>
        )}

        <Typo variant="caption" style={{ textAlign: 'center' }}>
          Your Wi-Fi password is saved only in this phone’s secure storage and sent to the sensor over encrypted Bluetooth. The sensor never stores it, and it never reaches our servers.
        </Typo>
      </ScrollView>
    </SafeAreaView>
  );
}
