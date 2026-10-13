import React from 'react';
import { View, Modal } from 'react-native';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { startAlarm, stopAlarm } from '@/platform/alarm/alarm';
import { usePhoneNotifications } from '@/features/notifications/phone-notifications';

/* The fall alarm, mounted once at the app root so it appears over WHATEVER screen is
 * open — Home, Devices, a settings page — whenever the sensor detects a fall, during a
 * recording or just in live preview. (It used to live on the recording page only, so
 * a fall on any other screen went unseen.)
 */
export function FallAlarmHost() {
  /* Narrow subscriptions: these change at most a few times per fall, never per packet. */
  const fall = useMonitoring((s) => s.engine?.fall ?? null);
  const simulated = useMonitoring((s) => !!s.engine?.simulated);
  const raised = useMonitoring((s) => s.fallEmergencyRaised);
  const cancelFall = useMonitoring((s) => s.cancelFall);
  const raiseFallEmergency = useMonitoring((s) => s.raiseFallEmergency);
  const dismissFallAlarm = useMonitoring((s) => s.dismissFallAlarm);
  if (!fall) return null;
  return (
    /* Keyed on the fall so its countdown resets for a new one. */
    <FallAlarm key={fall.atIso} impactPeakG={fall.impactPeakG} raised={raised} simulated={simulated}
      inRecording={!!fall.sessionId}
      onOk={() => void cancelFall()} onExpire={() => void raiseFallEmergency()} onDismiss={dismissFallAlarm} />
  );
}

/* Countdown phase: a 30 s timer the wearer cancels with "I'm OK"; if it runs out,
   onExpire raises the emergency and the alarm switches to its raised phase (contacting
   someone is the next step, not built yet). */
const FALL_COUNTDOWN_S = 30;
/* After the countdown runs out, keep sounding this long to draw someone's attention. */
const RAISED_ALARM_MS = 2 * 60_000;
function FallAlarm({ impactPeakG, raised, simulated, inRecording, onOk, onExpire, onDismiss }: {
  impactPeakG: number; raised: boolean; simulated: boolean; inRecording: boolean;
  onOk: () => void; onExpire: () => void; onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const [left, setLeft] = React.useState(FALL_COUNTDOWN_S);
  const fired = React.useRef(false);
  const sound = usePhoneNotifications((s) => s.sound);
  const vibration = usePhoneNotifications((s) => s.vibration);

  /* Sound and vibration while the alarm is up (platform/alarm; each can be switched
     off in Profile), stopped the moment it is answered (this unmounts). A real fall
     sounds until then, or for two minutes after the emergency is raised; a simulated
     one sounds once, so demos and testing with the simulated patch don't keep ringing. */
  React.useEffect(() => {
    startAlarm({ loop: !simulated, sound, vibration });
    return stopAlarm;
  }, [simulated, sound, vibration]);
  React.useEffect(() => {
    if (!raised) return;
    const id = setTimeout(stopAlarm, RAISED_ALARM_MS);
    return () => clearTimeout(id);
  }, [raised]);

  React.useEffect(() => {
    if (raised || left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left, raised]);

  /* Reaching zero raises the emergency exactly once (the ref resets per fall). */
  React.useEffect(() => {
    if (!raised && left <= 0 && !fired.current) { fired.current = true; onExpire(); }
  }, [left, raised, onExpire]);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={raised ? onDismiss : onOk}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Card style={{ width: '100%', maxWidth: 420, gap: 18, alignItems: 'center', paddingVertical: 28,
          backgroundColor: colors.statusErrorBg, borderColor: colors.borderError, borderWidth: 2 }}>
          <Typo variant="label" color={colors.statusErrorText} style={{ letterSpacing: 1, textTransform: 'uppercase' }}>
            {raised ? 'Possible fall recorded' : 'Possible fall detected'}
          </Typo>
          {raised ? (
            <>
              <Typo variant="dataHero" color={colors.wwError}>!</Typo>
              <Typo variant="bodySm" color={colors.statusErrorText} style={{ textAlign: 'center' }}>
                This possible fall is saved in Alerts{inRecording ? ' and in this recording' : ''}. This research
                prototype does not contact emergency services or emergency contacts.
              </Typo>
              <Button size="lg" onPress={onDismiss} style={{ alignSelf: 'stretch' }}>Dismiss</Button>
            </>
          ) : (
            <>
              <Typo variant="dataHero" color={colors.wwError}>{left}</Typo>
              <Typo variant="bodySm" color={colors.statusErrorText} style={{ textAlign: 'center' }}>
                Are you OK? This possible fall will be marked unanswered in {left} second{left === 1 ? '' : 's'}.
                No emergency alert is sent.
              </Typo>
              <Button size="lg" onPress={onOk} style={{ alignSelf: 'stretch' }}>I&apos;m OK</Button>
              <Typo variant="micro" color={colors.textSecondary}>
                Impact {impactPeakG.toFixed(1)} g{simulated ? ' · simulated' : ''}
              </Typo>
            </>
          )}
        </Card>
      </View>
    </Modal>
  );
}
