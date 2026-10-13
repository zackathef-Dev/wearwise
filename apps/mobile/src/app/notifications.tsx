import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Redirect, useRouter, useFocusEffect, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NotificationKind, NotificationRecord } from '@/domain/entities/session';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Icon } from '@/shared/icons/Icon';
import { IconButton, Micro } from '@/shared/components/kit';

/* NOTIFICATIONS (the bell) — what happened in the app, newest first: the sensor
 * connecting or dropping, Wi-Fi taking over or falling back, a recording saved, a new
 * alert, a fall. Tapping one goes where it points; each can be deleted. Leaving the
 * screen marks them read.
 */

const ICONS: Record<NotificationKind, string> = {
  device: 'bluetooth', wifi: 'wifi', recording: 'save', alert: 'triangle-alert', fall: 'person-standing',
};

const when = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? t : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${t}`;
};

export default function Notifications() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status } = useAuth();
  const items = useMonitoring((s) => s.notifications);
  const refresh = useMonitoring((s) => s.refreshNotifications);
  const markSeen = useMonitoring((s) => s.markNotificationsSeen);
  const remove = useMonitoring((s) => s.deleteNotification);
  const clearAll = useMonitoring((s) => s.clearNotifications);
  const [confirmClear, setConfirmClear] = React.useState(false);

  useFocusEffect(React.useCallback(() => {
    void refresh();
    return () => { void markSeen(); };
  }, [refresh, markSeen]));

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  const open = (n: NotificationRecord) => { if (n.route) router.push(n.route as Href); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
        <IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />
        <Typo variant="h2" accessibilityRole="header" style={{ flex: 1 }}>Notifications</Typo>
        {items.length > 0 && !confirmClear && <Button variant="ghost" size="md" onPress={() => setConfirmClear(true)}>Clear all</Button>}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 32 }}>
        {confirmClear && (
          <Card style={{ gap: 10 }}>
            <Typo variant="label">Delete all notifications?</Typo>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmClear(false)}>Cancel</Button>
              <Button style={{ flex: 1 }} onPress={() => { setConfirmClear(false); void clearAll(); }}>Delete all</Button>
            </View>
          </Card>
        )}
        {items.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
            <Icon name="bell" size={26} color={colors.textMuted} />
            <Typo variant="label">No notifications</Typo>
            <Typo variant="caption" style={{ textAlign: 'center' }}>
              Sensor connections, Wi-Fi changes, saved recordings, alerts and falls show up here.
            </Typo>
          </Card>
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {items.map((n, i) => {
              const urgent = n.kind === 'fall' || n.kind === 'alert';
              return (
                <Pressable key={n.id} onPress={() => open(n)} disabled={!n.route} accessibilityRole={n.route ? 'button' : undefined}
                  accessibilityLabel={`${n.title}. ${n.body} ${when(n.createdAt)}${n.seen ? '' : ', new'}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 6,
                    borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: colors.borderDefault }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: urgent ? colors.statusErrorBg : colors.surfaceSubtle }}>
                    <Icon name={ICONS[n.kind] ?? 'info'} size={16} color={urgent ? colors.statusErrorText : colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Typo variant="label" style={{ fontSize: 14, flexShrink: 1 }}>{n.title}</Typo>
                      {!n.seen && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.wwError }} />}
                    </View>
                    <Typo variant="caption" color={colors.textSecondary}>{n.body}</Typo>
                    <Micro>{when(n.createdAt)}</Micro>
                  </View>
                  <IconButton icon="trash-2" label={`Delete notification: ${n.title}`} size="sm" onPress={() => void remove(n.id)} />
                </Pressable>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
