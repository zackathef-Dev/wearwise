const { withAndroidManifest, withAppBuildGradle, withMainActivity } = require('expo/config-plugins');

module.exports = function withReleaseSecurity(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    /* POST_NOTIFICATIONS stays: phone notifications for alerts and falls need it on
       Android 13+. RECEIVE_BOOT_COMPLETED (added by expo-notifications to re-arm
       scheduled notifications after a reboot) goes: this app only posts immediately. */
    const remove = ['ACCESS_COARSE_LOCATION', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE',
      'SYSTEM_ALERT_WINDOW', 'RECORD_AUDIO', 'CAMERA', 'RECEIVE_BOOT_COMPLETED'];
    /* Once blocked here, now needed: drop a removal left in an existing manifest by an
       earlier prebuild, so the library's own declaration merges in. */
    const unblock = ['POST_NOTIFICATIONS'];
    for (const tag of ['uses-permission', 'uses-permission-sdk-23']) {
      manifest[tag] = (manifest[tag] || []).filter((p) => !remove.some((name) => p.$['android:name'] === `android.permission.${name}`)
        && !(p.$['tools:node'] === 'remove' && unblock.some((name) => p.$['android:name'] === `android.permission.${name}`)));
      for (const p of manifest[tag]) {
        if (['BLUETOOTH', 'BLUETOOTH_ADMIN', 'ACCESS_FINE_LOCATION'].some((name) => p.$['android:name'] === `android.permission.${name}`)) p.$['android:maxSdkVersion'] = '30';
      }
    }
    for (const name of remove) manifest['uses-permission'].push({ $: { 'android:name': `android.permission.${name}`, 'tools:node': 'remove' } });
    const app = manifest.application[0].$;
    app['android:allowBackup'] = 'false';
    app['android:fullBackupContent'] = 'false';
    app['android:usesCleartextTraffic'] = 'false';
    app['tools:replace'] = 'android:allowBackup,android:fullBackupContent';
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    const line = 'apply from: rootProject.file("../release-signing.gradle")';
    if (!mod.modResults.contents.includes(line)) mod.modResults.contents += `\n${line}\n`;
    return mod;
  });
  return withMainActivity(config, (mod) => {
    const line = 'window.setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE)';
    if (!mod.modResults.contents.includes(line)) mod.modResults.contents = mod.modResults.contents.replace('super.onCreate(null)', `super.onCreate(null)\n    if (!BuildConfig.DEBUG) ${line}`);
    if (!mod.modResults.contents.includes('isSafeWearWiseLink')) {
      mod.modResults.contents = mod.modResults.contents.replace('super.onCreate(null)', 'if (!isSafeWearWiseLink(intent)) intent.data = null\n    super.onCreate(null)');
      mod.modResults.contents = mod.modResults.contents.replace('class MainActivity : ReactActivity() {', `class MainActivity : ReactActivity() {
  // Reject hostile URL-decoder input before Expo Router sees an external intent.
  private fun isSafeWearWiseLink(incoming: android.content.Intent): Boolean {
    val uri = incoming.data ?: return true
    val value = uri.toString()
    return uri.scheme == "wearwise" && value.length <= 2048 && !value.contains("%")
  }

  override fun onNewIntent(incoming: android.content.Intent) {
    if (!isSafeWearWiseLink(incoming)) return
    super.onNewIntent(incoming)
  }
`);
    }
    return mod;
  });
};
