import React from 'react';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, useTheme } from '@/shared/theme/ThemeProvider';
import { useAuth, homeRoute } from '@/features/authentication/auth-store';
import { clearMonitoringForSignOut } from '@/features/monitoring/monitoring-store';
import { FallAlarmHost } from '@/features/fall/FallAlarm';
import { RecordRequestHost } from '@/features/live-view/RecordRequest';
import { AnimatedSplashScreen, hasPlayed } from '@/features/splash/AnimatedSplashScreen';
import { useAutoSync } from '@/features/sync/auto-sync';
import { useNotificationRouting } from '@/features/notifications/use-notification-routing';
import { PrivacyCover } from '@/shared/components/PrivacyCover';
import { dismissAllNotifications } from '@/platform/notifications/notifications';

useAuth.subscribe((state, previous) => {
  if (previous.participant && state.participant?.id !== previous.participant.id) {
    clearMonitoringForSignOut();
    void dismissAllNotifications();
  }
});

/* Root layout: providers and the navigation stack.
 *
 * The @expo-google-fonts package bundles the TTFs into the binary — nothing is
 * fetched at runtime, which is the same no-network rule the web mockup ships with.
 */

SplashScreen.preventAutoHideAsync().catch(() => {
  /* Already hidden (fast refresh) — nothing to do. */
});

function Root() {
  const { colors, dark } = useTheme();
  const signedIn = useAuth((s) => s.status === 'signed-in');
  /* Before using the app an account must be 18+ and have accepted the current terms;
     otherwise only "Before you continue" (confirm-account) is reachable. */
  const ready = useAuth((s) => homeRoute(s.participant) === '/home');
  useAutoSync(); // uploads on foreground / after a recording, retries until done
  useNotificationRouting(); // a tapped phone notification opens its screen
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.surfacePage },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="register" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="auth/[action]" />
        <Stack.Screen name="legal/index" />
        <Stack.Screen name="legal/[doc]" />
        <Stack.Protected guard={signedIn && !ready}>
          <Stack.Screen name="confirm-account" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && ready}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="pair" />
          <Stack.Screen name="wifi" />
          <Stack.Screen name="session/[id]" />
          <Stack.Screen name="health" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="privacy" />
        </Stack.Protected>
      </Stack>
      {/* Over every screen: a recording request from someone watching in live view, and
          a fall, which can be detected wherever the participant is (last, so on top). */}
      {signedIn && ready && <RecordRequestHost />}
      {signedIn && ready && <FallAlarmHost />}
    </>
  );
}

export default function Layout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  /* The animated splash covers startup once per launch and hides the native splash
     itself. It leaves when fonts are in and the start route ("/", which restores
     the session) has handed over to the first real screen — or a deep link opened
     some other route directly. */
  const [showSplash, setShowSplash] = React.useState(() => !hasPlayed());
  const pathname = usePathname();
  const appReady = fontsLoaded && pathname !== '/';
  const finishSplash = React.useCallback(() => setShowSplash(false), []);

  React.useEffect(() => {
    if (fontsLoaded && !showSplash) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, showSplash]);

  /* Always render the navigator. Returning null here until fonts load makes
     expo-router's ContextNavigator mount twice and warn ("state update on a
     component that hasn't mounted yet") on React 19. The splash (native, then
     animated) covers everything until fonts are in, so nothing renders in the
     fallback font where a person could see it. */
  return (
    <ThemeProvider>
      <Root />
      {showSplash && <AnimatedSplashScreen appReady={appReady} onFinished={finishSplash} />}
      <PrivacyCover />
    </ThemeProvider>
  );
}
