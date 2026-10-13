import React from 'react';
import { View, ScrollView } from 'react-native';
import { Redirect, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { AlertRow } from '@/features/alerts/AlertRow';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Collapsible } from '@/shared/components/Collapsible';
import { Icon } from '@/shared/icons/Icon';
import { Micro } from '@/shared/components/kit';
import { Reveal } from '@/shared/components/Reveal';

/* ALERTS (tab) — every abnormal reading and fall, newest first, grouped by day. Each
 * can be deleted, or all at once. One that happened during a recording opens it.
 * Leaving the tab marks them read (the dots stay while they are being looked at).
 */
export default function Alerts() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status } = useAuth();
  const alerts = useMonitoring((s) => s.recentAlerts);
  const refreshAlerts = useMonitoring((s) => s.refreshAlerts);
  const markAlertsSeen = useMonitoring((s) => s.markAlertsSeen);
  const deleteAlert = useMonitoring((s) => s.deleteAlert);
  const clearAlerts = useMonitoring((s) => s.clearAlerts);
  const [confirmClear, setConfirmClear] = React.useState(false);

  useFocusEffect(React.useCallback(() => {
    void refreshAlerts();
    return () => { void markAlertsSeen(); setConfirmClear(false); };
  }, [refreshAlerts, markAlertsSeen]));

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  /* `start`: the list position of a group's first alert, so the entrance stagger runs
     down the whole list rather than restarting at each day. */
  const groups: { day: string; start: number; items: typeof alerts }[] = [];
  alerts.forEach((a, n) => {
    const day = new Date(a.startedAt).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(a); else groups.push({ day, start: n, items: [a] });
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
        <Typo variant="h2" accessibilityRole="header" style={{ flex: 1 }}>Alerts</Typo>
        {alerts.length > 0 && !confirmClear && (
          <Button variant="ghost" size="md" onPress={() => setConfirmClear(true)}>Clear all</Button>
        )}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 16, paddingBottom: 32 }}>
        {confirmClear && (
          <Card style={{ gap: 10 }}>
            <Typo variant="label">Delete all {alerts.length} alert{alerts.length === 1 ? '' : 's'}?</Typo>
            <Typo variant="caption">They are removed from this phone. Recordings are not affected.</Typo>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmClear(false)}>Cancel</Button>
              <Button style={{ flex: 1 }} onPress={() => { setConfirmClear(false); void clearAlerts(); }}>Delete all</Button>
            </View>
          </Card>
        )}

        <Collapsible title="How alerts work">
          <Typo variant="bodySm" color={colors.textSecondary}>
            A reading becomes an alert when it stays out of its normal range: heart rate below 60 or above 100 BPM, or
            SpO₂ below 95 %, for 15 seconds; skin temperature above 37.5 °C for a minute. A fall raises an alarm on
            screen straight away and is listed here.
          </Typo>
          <Typo variant="bodySm" color={colors.textSecondary}>
            These are typical adult resting ranges — exercise, sleep and fitness move them. WearWise reports
            measurements and does not diagnose; if you feel unwell, contact a medical professional.
          </Typo>
        </Collapsible>

        {alerts.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
            <Icon name="circle-check" size={26} color={colors.stateConnected} />
            <Typo variant="label">No abnormal readings</Typo>
            <Typo variant="caption" style={{ textAlign: 'center' }}>
              When a reading stays outside its normal range — or a fall is detected — it is listed here.
            </Typo>
          </Card>
        ) : groups.map((g) => (
          /* The first eight rows rise in when the list first shows; a refresh keeps their
             keys so it never replays, and an alert that arrives later rises in alone. */
          <View key={g.day} style={{ gap: 8 }}>
            <Reveal index={g.start}><Micro>{g.day}</Micro></Reveal>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {g.items.map((a, i) => (
                <Reveal key={a.id} index={g.start + i}>
                  <AlertRow alert={a} last={i === g.items.length - 1}
                    onDelete={() => void deleteAlert(a.id)}
                    onPress={a.sessionId ? () => router.push({ pathname: '/session/[id]', params: { id: a.sessionId! } }) : undefined} />
                </Reveal>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
