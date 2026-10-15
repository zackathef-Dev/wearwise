import type { ExpoConfig } from 'expo/config';

/* WearWise participant app.
 *
 * TypeScript config rather than app.json so identifiers, permissions strings and
 * plugin options live in one reviewed file with comments. The BLE plugin arrives in
 * Milestone 4 — listing the plan here so permission copy is written once, not
 * discovered at integration time.
 */
const config: ExpoConfig = {
  name: 'WearWise',
  slug: 'wearwise',
  version: '0.1.0',
  scheme: 'wearwise',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',

  ios: {
    bundleIdentifier: 'io.wearwise.participant',
    supportsTablet: false,
    infoPlist: {
      // Written now, used from Milestone 4. Copy follows the brand voice: plain,
      // says what for, no jargon.
      NSBluetoothAlwaysUsageDescription:
        'WearWise connects to your wearable sensor over Bluetooth to show and record your readings.',
      /* iOS 14+ asks before an app talks to devices on the local network; the sensor's
         encrypted Wi-Fi stream is on the LAN, so this prompt is required for Wi-Fi. */
      NSLocalNetworkUsageDescription:
        'WearWise connects to your wearable sensor over your Wi-Fi network to stream your readings securely.',
    },
  },

  android: {
    package: 'io.wearwise.participant',
    versionCode: 1,
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#0F2747',
    },
  },

  /* SDK 57 moved splash config into the plugin — the top-level key is gone. */
  plugins: [
    /* No _sitemap screen in the app: it lists every route to anyone holding the phone. */
    ['expo-router', { sitemap: false }],
    'expo-font',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        /* Plain brand navy: a transparent image (Android's splash theme always
           draws one). The logo is revealed by AnimatedSplashScreen on the same
           navy, so native → animated is seamless. */
        image: './assets/images/splash-transparent.png',
        imageWidth: 200,
        resizeMode: 'contain',
        // Navy, matching the brand splash in the mockup (= wwNavy, used by the animated splash).
        backgroundColor: '#0F2747',
      },
    ],
    /* react-native-ble-plx ships its OWN Expo config plugin (verified in the
       tarball) — NOT the deprecated @config-plugins/react-native-ble-plx.
       isBackgroundEnabled stays false: this build streams only in foreground.
       neverForLocation lets Android 12+ scan without ACCESS_FINE_LOCATION. */
    [
      'react-native-ble-plx',
      {
        isBackgroundEnabled: false,
        neverForLocation: true,
        modes: ['central'],
      },
    ],
    /* Profile picture: photo library only — the system photo picker needs no
       permission, so the camera and microphone permissions the module would add are
       removed; iOS gets the library usage string. */
    [
      'expo-image-picker',
      {
        photosPermission: 'WearWise uses a photo you choose as your profile picture. It stays on this phone.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    /* Phone notifications (alerts, falls, a sensor lost mid-recording): local only, no
       push. Android icon + brand teal accent, and the fall alarm tone bundled for the
       falls channel / iOS notification; deliberately NOT the package's full plugin,
       which would add the iOS push entitlement (see the plugin file). */
    [
      './plugins/with-local-notifications',
      { icon: './assets/images/notification-icon.png', color: '#18B6A4', sounds: ['./assets/sounds/fall_alarm.wav'] },
    ],
    './plugins/with-release-security',
    './plugins/with-ios-scene-lifecycle',
  ],

  experiments: {
    typedRoutes: true,
  },
};

export default config;
