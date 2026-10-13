import React from 'react';
import { View, Pressable } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Icon } from '@/shared/icons/Icon';
import { Typo } from '@/shared/components/Typography';
import { useMonitoring } from '@/features/monitoring/monitoring-store';

/* Bottom-tab chrome: Home · Alerts · Devices · History · Profile. Recording happens
 * on Home itself, so there is no separate record tab; Alerts carries a count of the
 * unread ones. The nav lives outside the animated screen so it stays put on every
 * navigation.
 */

const ITEMS = [
  { key: 'home', label: 'Home', icon: 'house', route: '/home' },
  { key: 'alerts', label: 'Alerts', icon: 'triangle-alert', route: '/alerts' },
  { key: 'devices', label: 'Devices', icon: 'watch', route: '/devices' },
  { key: 'history', label: 'History', icon: 'clock', route: '/history' },
  { key: 'profile', label: 'Profile', icon: 'user', route: '/profile' },
] as const;

function TabBar({ current }: { current: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  /* Highlight the tapped tab immediately instead of waiting for the navigation state
     to settle — otherwise the icon/label colour only flips once the target screen has
     mounted, which reads as a laggy tap. `current` (the real active route) clears the
     optimistic value once it catches up. */
  const [pending, setPending] = React.useState<string | null>(null);
  const unseenAlerts = useMonitoring((s) => s.alertsUnseen);
  /* Clear the optimistic value once the real route catches up (or changes any other
     way) — the render-time reset pattern, so no effect is needed. */
  const [seenRoute, setSeenRoute] = React.useState(current);
  if (seenRoute !== current) { setSeenRoute(current); setPending(null); }
  const active = pending ?? current;
  return (
    <View style={{
      flexDirection: 'row', backgroundColor: colors.surfaceCard,
      borderTopWidth: 1, borderTopColor: colors.borderDefault,
      paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: 6,
    }}>
      {ITEMS.map((it) => {
        const on = active === it.key;
        const tint = on ? colors.actionPrimary : colors.textSecondary;
        return (
          <Pressable
            key={it.key}
            /* Real tabs switch in place (navigate keeps tab state); the Live item is
               a shortcut into the full-screen record flow, so it PUSHES — that keeps
               a back stack, so Cancel/Back on /sensor returns here (not to splash). */
            onPress={() => {
              setPending(it.key);
              router.navigate(it.route);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.key === 'alerts' && unseenAlerts ? `Alerts, ${unseenAlerts} new` : it.label}
            style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4 }}
          >
            <View>
              <Icon name={it.icon} size={22} color={tint} />
              {it.key === 'alerts' && unseenAlerts > 0 && (
                <View pointerEvents="none" style={{ position: 'absolute', top: -5, right: -10, minWidth: 17, height: 17, borderRadius: 9,
                  paddingHorizontal: 4, backgroundColor: colors.wwError, alignItems: 'center', justifyContent: 'center' }}>
                  <Typo variant="caption" color={colors.wwWhite} style={{ fontSize: 10 }}>{unseenAlerts > 9 ? '9+' : unseenAlerts}</Typo>
                </View>
              )}
            </View>
            <Typo variant="micro" color={tint} style={{ fontSize: 11, letterSpacing: 0.2, textTransform: 'none', fontFamily: on ? 'Poppins_600SemiBold' : 'Poppins_400Regular' }}>
              {it.label}
            </Typo>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, animation: 'shift' }}
      tabBar={({ state }) => <TabBar current={state.routes[state.index]?.name ?? 'home'} />}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="devices" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
