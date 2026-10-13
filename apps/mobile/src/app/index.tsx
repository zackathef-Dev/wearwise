import React from 'react';
import { View, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { homeRoute, useAuth } from '@/features/authentication/auth-store';

/* Start route — restores the persisted session, then routes on the answer. The
 * animated splash (features/splash) covers this screen until it has routed away,
 * so no minimum hold is needed here any more; this logo only shows if restoring
 * outlasts the splash's safety cap.
 */
const MIN_HOLD_MS = 0;

export default function Splash() {
  const router = useRouter();
  const { dark } = useTheme();
  const { restore } = useAuth();

  React.useEffect(() => {
    let cancelled = false;
    const started = Date.now();

    void (async () => {
      await restore();
      const remaining = Math.max(0, MIN_HOLD_MS - (Date.now() - started));
      setTimeout(() => {
        if (cancelled) return;
        /* Read status AFTER restore resolved — the store is now settled. */
        const { status, participant } = useAuth.getState();
        router.replace(status === 'signed-in' ? homeRoute(participant) : '/sign-in');
      }, remaining);
    })();

    return () => { cancelled = true; };
  }, [restore, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={
          dark
            ? require('@/assets/brand/wearwise-logo-white.png')
            : require('@/assets/brand/wearwise-logo.png')
        }
        style={{ width: 220, height: 74, resizeMode: 'contain' }}
        accessibilityLabel="WearWise — Your Data, Your Decisions."
      />
    </View>
  );
}
