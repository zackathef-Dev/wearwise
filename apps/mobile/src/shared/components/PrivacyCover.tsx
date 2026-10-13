import React from 'react';
import { AppState, Image, Platform, StyleSheet, View } from 'react-native';

const LOGO = require('@/assets/brand/wearwise-logo-white.png');
const NAVY = '#0F2747'; // the splash colour

/* iOS takes a screenshot of the app for the app switcher as it leaves the screen, and
 * that picture can show readings to anyone who picks the phone up. Cover the app while
 * it isn't active so the snapshot is just the logo. Android already blocks screenshots
 * and switcher previews in release builds (FLAG_SECURE in with-release-security.js).
 */
export function PrivacyCover() {
  const [covered, setCovered] = React.useState(false);
  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = AppState.addEventListener('change', (state) => setCovered(state !== 'active'));
    return () => sub.remove();
  }, []);
  if (!covered) return null;
  return (
    <View style={styles.cover} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={LOGO} resizeMode="contain" style={styles.logo} accessibilityIgnoresInvertColors />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  logo: { width: 160, height: 160 },
});
