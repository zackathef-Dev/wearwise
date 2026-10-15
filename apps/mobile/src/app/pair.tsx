import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Reveal } from '@/shared/components/Reveal';
import { Halo } from '@/shared/components/motion';
import { Icon } from '@/shared/icons/Icon';

/* Pair a sensor — scans for WearWise patches by service UUID and lets the person
 * choose one. Choosing it connects straight away and returns to Home, where its live
 * readings appear. Simulation stays one tap away so a build
 * with no hardware is never a dead end.
 */
export default function Pair() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status, participant } = useAuth();
  const { init, scanForDevices, stopScan, pairDevice, setTransportKind, connect, scanning, found, error } = useMonitoring();

  React.useEffect(() => { if (participant?.id) void init(participant.id); }, [participant?.id, init]);
  React.useEffect(() => {
    void scanForDevices();
    return () => stopScan();
  }, [scanForDevices, stopScan]);

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View style={{ gap: 4 }}>
          <Typo variant="h2" accessibilityRole="header">Connect a sensor</Typo>
          <Typo variant="caption">Make sure your WearWise patch is powered on and nearby.</Typo>
        </View>

        {/* Radar: rings ripple out of the Bluetooth glyph only while the scan runs, and
            fade away when it ends. Under Reduce Motion the glyph and the words say it. */}
        <View style={{ alignItems: 'center', gap: 6 }}>
          <View style={{ height: 124, alignItems: 'center', justifyContent: 'center' }}>
            <Halo size={64} color={colors.actionPrimary} searching={scanning} spread={1.8}>
              <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
                backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: scanning ? colors.actionPrimary : colors.borderDefault }}>
                <Icon name={scanning ? 'bluetooth-searching' : 'bluetooth'} size={28} color={scanning ? colors.actionPrimary : colors.textMuted} />
              </View>
            </Halo>
          </View>
          <Typo variant="micro" accessibilityLiveRegion="polite">{scanning ? 'Scanning…' : found.length ? 'Scan complete' : 'No sensors found'}</Typo>
        </View>

        {error && (
          <Card style={{ backgroundColor: colors.statusWarningBg, borderColor: colors.borderWarning }}>
            <Typo variant="bodySm" color={colors.statusWarningText}>{error}</Typo>
          </Card>
        )}

        <View style={{ gap: 10 }}>
          {/* Each sensor rises in as the scan finds it (discovery is the stagger). */}
          {found.map((d) => (
            <Reveal key={d.peripheralId}>
              <Pressable
                accessibilityRole="button"
                onPress={() => { pairDevice(d); void connect(); router.navigate('/home'); }}
              >
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.stateConnected }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Typo variant="label" style={{ fontSize: 15 }}>{d.name ?? 'WearWise patch'}</Typo>
                    <Typo variant="caption">{d.peripheralId}{d.rssi != null ? ` · ${d.rssi} dBm` : ''}</Typo>
                  </View>
                  <Typo variant="micro" color={colors.actionPrimary}>Connect</Typo>
                </Card>
              </Pressable>
            </Reveal>
          ))}
          {!scanning && found.length === 0 && (
            <Card><Typo variant="bodySm" color={colors.textSecondary}>
              No WearWise patch answered. Check it is on and in range, then scan again.
            </Typo></Card>
          )}
        </View>

        {!scanning && <Button size="lg" onPress={() => void scanForDevices()}>Scan again</Button>}

        <Button
          variant="ghost"
          onPress={() => { setTransportKind('simulation'); void connect(); router.navigate('/home'); }}
        >
          Use simulated data instead
        </Button>
        <Button variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}>Cancel</Button>
      </ScrollView>
    </SafeAreaView>
  );
}
