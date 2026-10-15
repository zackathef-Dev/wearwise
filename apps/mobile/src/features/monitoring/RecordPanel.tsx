import React from 'react';
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SensorType } from '@wearwise/sensor-protocol';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { signalName } from '@/shared/signal-meta';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Icon } from '@/shared/icons/Icon';
import { Micro } from '@/shared/components/kit';
import { Reveal } from '@/shared/components/Reveal';

/* Recording, right on Home: pick the signals to save, start, watch the clock, stop.
 * The live readings above keep showing everything the sensor streams; only the
 * signals picked here are saved. No separate page.
 */

const fmtClock = (s: number) =>
  `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export function RecordPanel({ connected }: { connected: boolean }) {
  const router = useRouter();
  const { colors } = useTheme();
  const participantId = useAuth((s) => s.participant?.id);
  const capabilities = useMonitoring((s) => s.capabilities);
  const selected = useMonitoring((s) => s.selected);
  const select = useMonitoring((s) => s.select);
  const startRecording = useMonitoring((s) => s.startRecording);
  const stopRecording = useMonitoring((s) => s.stopRecording);
  const state = useMonitoring((s) => s.engine?.state);
  const sessionId = useMonitoring((s) => s.engine?.sessionId ?? null);
  const elapsedS = useMonitoring((s) => (s.engine?.state === 'recording' ? Math.floor(s.engine.elapsedMs / 1000) : 0));
  /* Primitive selectors: re-render on the numbers, not on every snapshot object. */
  const samples = useMonitoring((s) => (s.engine?.state === 'recording'
    ? s.selected.reduce((n, t) => n + (s.engine?.channels[t]?.summary.sampleCount ?? 0), 0) : 0));
  const gaps = useMonitoring((s) => (s.engine?.state === 'recording'
    ? s.selected.reduce((n, t) => n + (s.engine?.channels[t]?.summary.sequenceGaps ?? 0), 0) : 0));
  const failure = useMonitoring((s) => s.engine?.failure ?? null);
  const [busy, setBusy] = React.useState(false);
  const [confirmStop, setConfirmStop] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ id: string; mins: number } | null>(null);

  const recording = state === 'recording' || state === 'preparing';
  const toggle = (t: SensorType) => select(selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);

  const start = async () => {
    if (!participantId) return;
    setBusy(true); setError(null); setSaved(null);
    select(chosen);   // never ask the sensor for a signal it is not reporting
    try { await startRecording(participantId); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start recording.'); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    setConfirmStop(false); setBusy(true);
    const id = sessionId;
    try {
      await stopRecording();
      if (id) setSaved({ id, mins: Math.max(1, Math.round(elapsedS / 60)) });
    } finally { setBusy(false); }
  };

  if (recording) {
    return (
      <Card style={{ gap: 12, borderColor: colors.borderError }} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.wwError }} />
          <Typo variant="label" style={{ flex: 1, fontSize: 15 }}>{state === 'preparing' ? 'Starting…' : 'Recording'}</Typo>
          <Typo variant="dataSm" style={{ fontSize: 20 }}>{fmtClock(elapsedS)}</Typo>
        </View>
        <Typo variant="caption" color={colors.textSecondary}>
          Saving {selected.map(signalName).join(' · ')}
        </Typo>
        <Typo variant="caption" color={colors.textMuted}>{samples.toLocaleString()} samples · {gaps} gap{gaps === 1 ? '' : 's'}</Typo>
        {confirmStop ? (
          <View style={{ gap: 8 }}>
            <Typo variant="bodySm">Stop and save this recording?</Typo>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmStop(false)}>Keep recording</Button>
              <Button style={{ flex: 1 }} disabled={busy} onPress={() => void stop()}>Stop</Button>
            </View>
          </View>
        ) : (
          <Button size="lg" variant="secondary" disabled={busy || state !== 'recording'} onPress={() => setConfirmStop(true)}>Stop recording</Button>
        )}
      </Card>
    );
  }

  const choices = capabilities.length
    ? capabilities
    : [SensorType.Ecg, SensorType.HeartRate, SensorType.SpO2, SensorType.Temperature, SensorType.Accelerometer]
      .map((t) => ({ sensorType: t, reporting: false, sampleRateHz: 0 }));
  const chosen = selected.filter((t) => capabilities.some((c) => c.sensorType === t && c.reporting));

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="circle-dot" size={16} color={colors.wwError} />
        <Typo variant="label" style={{ flex: 1, fontSize: 15 }}>Record</Typo>
        <Micro>{connected ? 'Pick what to save' : 'Sensor not connected'}</Micro>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {choices.map((c) => {
          const on = selected.includes(c.sensorType);
          const enabled = connected && c.reporting;
          return (
            <Pressable key={c.sensorType} disabled={!enabled} onPress={() => toggle(c.sensorType)}
              accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !enabled }}
              accessibilityLabel={`${signalName(c.sensorType)}${c.sampleRateHz ? `, ${c.sampleRateHz} Hz` : ''}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18,
                opacity: enabled ? 1 : 0.45,
                borderWidth: on ? 1.5 : 1, borderColor: on ? colors.actionPrimary : colors.borderDefault,
                backgroundColor: on ? colors.surfaceSelected : colors.surfaceCard }}>
              {on && <Icon name="check" size={13} color={colors.actionPrimary} />}
              <Typo variant="label" color={on ? colors.actionPrimary : colors.textBody} style={{ fontSize: 13 }}>
                {signalName(c.sensorType)}
              </Typo>
            </Pressable>
          );
        })}
      </View>
      {(error || failure) && <Typo variant="bodySm" color={colors.statusErrorText}>{error ?? failure}</Typo>}
      {/* The confirmation rises in once, so "it was saved" is noticed, not just present. */}
      {saved && (
        <Reveal>
          <Pressable onPress={() => router.push({ pathname: '/session/[id]', params: { id: saved.id } })} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="circle-check" size={15} color={colors.stateConnected} />
            <Typo variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>Saved · {saved.mins} min. Tap to open it.</Typo>
            <Icon name="chevron-right" size={14} color={colors.textMuted} />
          </Pressable>
        </Reveal>
      )}
      <Button size="lg" onPress={() => void start()} disabled={!connected || !chosen.length || busy}>
        {busy ? 'Starting…' : `Start recording${chosen.length ? ` · ${chosen.length} signal${chosen.length === 1 ? '' : 's'}` : ''}`}
      </Button>
      <Typo variant="caption" color={colors.textMuted}>
        {connected ? 'Live readings above are not saved until you record.' : 'Connect your sensor to record.'}
      </Typo>
    </Card>
  );
}
