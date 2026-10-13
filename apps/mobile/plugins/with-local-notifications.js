const { createRunOncePlugin, withXcodeProject } = require('expo/config-plugins');
const { withNotificationsAndroid } = require('expo-notifications/plugin/build/withNotificationsAndroid');
const { setNotificationSounds } = require('expo-notifications/plugin/build/withNotificationsIOS');
const pkg = require('expo-notifications/package.json');

/* expo-notifications, local notifications only:
   - Android: the small icon (a white silhouette — Android draws just its alpha), the
     accent colour, and `sounds` copied into res/raw for the notification channels;
   - iOS: just the `sounds` added to the app bundle, so a notification can name them.

   Its own plugin also adds the iOS push entitlement (aps-environment). This app sends
   LOCAL notifications only, which need no entitlement, and that one would make every
   iOS build need a push-enabled provisioning profile. Registered under the package's
   own name so prebuild's automatic copy of that plugin sees it has already run. */
const withLocalNotifications = (config, props = {}) => {
  config = withNotificationsAndroid(config, props);
  return withXcodeProject(config, (c) => {
    setNotificationSounds(c.modRequest.projectRoot, {
      sounds: props.sounds ?? [], project: c.modResults, projectName: c.modRequest.projectName,
    });
    return c;
  });
};

module.exports = createRunOncePlugin(withLocalNotifications, pkg.name, pkg.version);
