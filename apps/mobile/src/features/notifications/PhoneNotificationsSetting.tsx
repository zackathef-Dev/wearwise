import React from 'react';
import { View, AppState, Platform, Switch as RNSwitch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { openNotificationSettings } from '@/platform/notifications/notifications';
import { usePhoneNotifications } from './phone-notifications';

/* Profile: phone notifications on or off, and alert sound and vibration. Turning
 * notifications on asks the system if it still can; once the system has been told no,
 * only Settings can change it, so the card says so and offers the way there. Sound and
 * vibration cover both the fall alarm in the app and phone notifications.
 */
export function PhoneNotificationsSetting() {
  const { colors } = useTheme();
  const enabled = usePhoneNotifications((s) => s.enabled);
  const permission = usePhoneNotifications((s) => s.permission);
  const canAskAgain = usePhoneNotifications((s) => s.canAskAgain);
  const refresh = usePhoneNotifications((s) => s.refresh);
  const setEnabled = usePhoneNotifications((s) => s.setEnabled);
  const sound = usePhoneNotifications((s) => s.sound);
  const vibration = usePhoneNotifications((s) => s.vibration);
  const setFeedback = usePhoneNotifications((s) => s.setFeedback);

  /* The answer can change in Settings while the app is away. */
  useFocusEffect(React.useCallback(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => sub.remove();
  }, [refresh]));

  const unavailable = permission === 'unavailable';
  const blocked = enabled && permission === 'denied' && !canAskAgain;
  const caption = unavailable ? 'This build of the app can’t show phone notifications. Alerts still appear in the app.'
    : blocked ? 'Notifications for WearWise are turned off in your phone’s Settings.'
    : enabled ? 'Alerts, possible falls, and your sensor dropping out during a recording also show as phone notifications while WearWise is running.'
    : 'Off. Alerts and falls still appear in the app.';

  return (
    <Card style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Typo variant="label">Phone notifications</Typo>
          <Typo variant="caption" color={blocked ? colors.statusWarningText : colors.textMuted}>{caption}</Typo>
        </View>
        <RNSwitch value={enabled && !unavailable} disabled={unavailable} accessibilityLabel="Phone notifications"
          onValueChange={(on) => { void setEnabled(on); }}
          trackColor={{ true: colors.actionPrimary, false: colors.surfaceTrack }} thumbColor={colors.controlKnob} />
      </View>
      {blocked && (
        <Button size="md" variant="secondary" onPress={openNotificationSettings}>Open Settings</Button>
      )}
      <FeedbackSwitch
        label="Sound" value={sound} onChange={(on) => setFeedback({ sound: on })}
        caption={sound
          ? 'A possible fall sounds an alarm, even on silent, until you answer it. Other alerts use the notification sound.'
          : 'Off: alerts and the fall alarm make no sound. You may not notice a possible fall straight away.'}
      />
      <FeedbackSwitch
        label="Vibration" value={vibration} onChange={(on) => setFeedback({ vibration: on })}
        caption={vibration
          ? 'A possible fall vibrates in long pulses; other alerts vibrate briefly.'
          : Platform.OS === 'ios'
            ? 'Off for the fall alarm. Notification vibration follows Sounds & Haptics in your iPhone’s Settings.'
            : 'Off: alerts and the fall alarm don’t vibrate.'}
      />
    </Card>
  );
}

/* One alert-feedback switch (sound, vibration), laid out like the notifications row. */
function FeedbackSwitch({ label, caption, value, onChange }: {
  label: string; caption: string; value: boolean; onChange: (on: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderDefault }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Typo variant="label">{label}</Typo>
        <Typo variant="caption" color={colors.textMuted}>{caption}</Typo>
      </View>
      <RNSwitch value={value} accessibilityLabel={`Alert ${label.toLowerCase()}`} onValueChange={onChange}
        trackColor={{ true: colors.actionPrimary, false: colors.surfaceTrack }} thumbColor={colors.controlKnob} />
    </View>
  );
}
