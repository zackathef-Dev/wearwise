import React from 'react';
import { Modal, View } from 'react-native';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { signalName } from '@/shared/signal-meta';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Icon } from '@/shared/icons/Icon';
import { useLiveView } from './live-view-store';

/* Someone watching in live view asked for a recording. Mounted at the app root, like
 * the fall alarm, so it shows over whatever screen is open. Nothing records unless the
 * participant taps Start; Not now (or no answer within a minute) tells the viewer no.
 * Afterwards, a one-off note if that viewer stopped the recording they asked for.
 */
export function RecordRequestHost() {
  const { colors } = useTheme();
  const request = useLiveView((s) => s.recordRequest);
  const notice = useLiveView((s) => s.recordNotice);
  const answer = useLiveView((s) => s.answerRecordRequest);
  const clearNotice = useLiveView((s) => s.clearRecordNotice);
  const signals = useMonitoring((s) => s.selected
    .filter((t) => s.capabilities.some((c) => c.sensorType === t && c.reporting))
    .map(signalName).join(' · '));
  const [busy, setBusy] = React.useState(false);

  if (request) {
    const reply = async (start: boolean) => { setBusy(true); try { await answer(start); } finally { setBusy(false); } };
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => void reply(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Card style={{ width: '100%', maxWidth: 420, gap: 14, padding: 22 }} accessibilityViewIsModal>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.wwError }} />
              <Typo variant="label" style={{ fontSize: 16, flex: 1 }}>Start a recording?</Typo>
            </View>
            <Typo variant="bodySm" color={colors.textBody}>
              {request.name} asks you to start a recording now.
            </Typo>
            <Typo variant="caption" color={colors.textSecondary}>
              {signals ? `It saves ${signals} on this phone` : 'It saves your chosen signals on this phone'} and backs it
              up, like any recording, so the people you share with can see it. {request.name} can stop it from their
              side; you can stop it any time on Home.
            </Typo>
            <View style={{ gap: 8, marginTop: 4 }}>
              <Button onPress={() => void reply(true)} disabled={busy}>{busy ? 'Starting…' : 'Start recording'}</Button>
              <Button variant="secondary" onPress={() => void reply(false)} disabled={busy}>Not now</Button>
            </View>
          </Card>
        </View>
      </Modal>
    );
  }

  if (notice) {
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={clearNotice}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Card style={{ width: '100%', maxWidth: 420, gap: 14, padding: 22 }} accessibilityViewIsModal>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="info" size={18} color={colors.textSecondary} />
              <Typo variant="label" style={{ fontSize: 16, flex: 1 }}>Recording</Typo>
            </View>
            <Typo variant="bodySm" color={colors.textBody}>{notice}</Typo>
            <Button variant="secondary" onPress={clearNotice}>OK</Button>
          </Card>
        </View>
      </Modal>
    );
  }
  return null;
}
