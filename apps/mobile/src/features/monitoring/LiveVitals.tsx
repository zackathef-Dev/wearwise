import React from 'react';
import { View, Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { SensorType } from '@wearwise/sensor-protocol';
import { motion } from '@wearwise/design-tokens';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { classify, STATUS_LABEL, activityLevel, ACTIVITY_LABEL, type VitalStatus } from '@/domain/vitals/ranges';
import { metaFor } from '@/shared/signal-meta';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Card } from '@/shared/components/Card';
import { EcgGraph } from '@/shared/charts/EcgGraph';
import { SignalTrace } from '@/shared/charts/SignalTrace';
import { Icon } from '@/shared/icons/Icon';
import { Badge, LiveDot, Micro, IconButton } from '@/shared/components/kit';
import { Collapsible } from '@/shared/components/Collapsible';
import { Disclosure, popIn, useExpandAnimation } from '@/shared/components/motion';
import { WindowPicker } from '@/shared/components/WindowPicker';
import { LIVE_WINDOWS, liveWindowFor, saveLiveWindow } from '@/shared/graph-window';

/* Home's live section: the ECG strip (always), the vitals tiles, and — when a tile is
 * tapped — that reading's graph under the ECG. Never more than two graphs on screen.
 *
 * Its own component with narrow subscriptions: the engine snapshot changes ~15×/s, and
 * only this part of Home needs it.
 */

const TILES = [SensorType.HeartRate, SensorType.SpO2, SensorType.Temperature, SensorType.Accelerometer] as const;
/* No sample for this long = contact lost (finger lifted, patch off). The device
   republishes HR/SpO₂ at 1 Hz while it has a reading, so 2.5 s is a couple of misses. */
const STALE_MS = 2500;
const TILE_NAME: Partial<Record<SensorType, string>> = { [SensorType.Temperature]: 'Skin temp', [SensorType.SpO2]: 'SpO₂' };

/* Motion here is one-shot and tied to a change — never per sample: the ECG hint fades
   as the signal arrives, a reading pops in when it first appears, a status badge when
   its verdict changes, and the tapped tile's graph opens with the native layout
   animation. The traces themselves stay on their UI-thread Skia path, untouched. */
const HINT_IN = FadeIn.duration(motion.durBase);
const HINT_OUT = FadeOut.duration(motion.durBase);
const VALUE_IN = popIn(0.92);
const BADGE_IN = popIn(0.85);

export function LiveVitals({ connected }: { connected: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const channels = useMonitoring((s) => s.engine?.channels);
  const capabilities = useMonitoring((s) => s.capabilities);
  const [focus, setFocus] = React.useState<SensorType | null>(null);
  /* Opening the graph pushes everything below it down; glide rather than jump. */
  const expand = useExpandAnimation();
  const showGraph = React.useCallback((next: SensorType | null) => { expand(); setFocus(next); }, [expand]);
  /* Slow clock: re-checks "quiet" when packets stop and moves timed traces along. */
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const has = (t: SensorType) => capabilities.some((c) => c.sensorType === t);
  const live = (t: SensorType) => {
    const ch = channels?.[t];
    return connected && !!ch?.lastAtMs && nowMs - ch.lastAtMs <= STALE_MS ? ch : null;
  };

  const ecg = live(SensorType.Ecg);
  const ecgLeadsOff = !!ecg?.leadsOff;
  const tiles = connected && capabilities.length ? TILES.filter(has) : [...TILES];
  const focused = focus != null && tiles.includes(focus as (typeof TILES)[number]) ? focus : null;

  return (
    <View style={{ gap: 12 }}>
      {/* ---- ECG: always on screen ---- */}
      <Card style={{ gap: 10, padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="activity" size={16} color={colors.wwDataEcg} />
          <Typo variant="label" style={{ fontSize: 14, flex: 1 }}>ECG</Typo>
          {ecg && !ecgLeadsOff ? <LiveDot /> : null}
          <Micro>3 s</Micro>
        </View>
        <View>
          <EcgGraph data={ecg && !ecgLeadsOff ? ecg.recent : []} rateHz={ecg?.rateHz ?? 250} />
          {/* The hint fades out as the signal arrives (and back in if it is lost), so
              the trace taking its place reads as the signal arriving, not a swap. */}
          {(!ecg || ecgLeadsOff) && (
            <Animated.View entering={reduced ? undefined : HINT_IN} exiting={reduced ? undefined : HINT_OUT}
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
              <Typo variant="bodySm" color={colors.textSecondary} style={{ textAlign: 'center' }}>
                {!connected ? 'Connect your sensor to see your ECG.'
                  : !has(SensorType.Ecg) ? 'This sensor has no ECG.'
                  : ecgLeadsOff ? 'Electrodes not attached — place all three pads on the skin.'
                  : 'Waiting for the ECG signal…'}
              </Typo>
            </Animated.View>
          )}
        </View>
      </Card>

      {/* ---- the tapped reading's graph (second, optional) ---- */}
      {focused != null && <FocusGraph key={focused} sensor={focused} nowMs={nowMs} connected={connected} onClose={() => showGraph(null)} />}

      {/* ---- tiles ---- */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {tiles.map((t) => {
          const ch = live(t);
          let value = '—';
          let sub: string | null = null;
          let status: VitalStatus | null = null;
          if (ch && ch.latest != null) {
            if (t === SensorType.Accelerometer) {
              const lvl = activityLevel(ch.recent.slice(-150));
              value = lvl ? ACTIVITY_LABEL[lvl] : '—';
              sub = `${ch.latest.toFixed(2)} g`;
            } else {
              value = ch.latest.toFixed(t === SensorType.Temperature ? 1 : 0);
              status = classify(t, ch.latest);
            }
          }
          const hint = !connected ? 'Not connected'
            : !ch ? (t === SensorType.HeartRate || t === SensorType.SpO2 ? 'Finger on the sensor' : 'No reading')
            : null;
          return <VitalTile key={t} sensor={t} value={value} sub={sub} status={status} hint={hint} on={focused === t} onToggle={showGraph} />;
        })}
      </View>
      <Collapsible title="What “Normal” means">
        <Typo variant="bodySm" color={colors.textSecondary}>
          Normal is the typical adult resting range: heart rate 60–100 BPM · SpO₂ 95 % or more · skin temperature
          31–37.5 °C. Exercise, sleep and fitness move these, so treat the label as a guide, not a diagnosis.
        </Typo>
        <Typo variant="bodySm" color={colors.textSecondary}>Tap a reading to see its graph under the ECG.</Typo>
      </Collapsible>
    </View>
  );
}

/* One vitals tile. Memoised on the primitives it shows, so a 15 Hz engine snapshot
   only re-renders the tiles whose text actually changed (HR/SpO₂/temperature move at
   ~1 Hz) — the animations below never ride on a re-render. */
const VitalTile = React.memo(function VitalTile({ sensor: t, value, sub, status, hint, on, onToggle }: {
  sensor: SensorType; value: string; sub: string | null; status: VitalStatus | null; hint: string | null;
  on: boolean; onToggle: (next: SensorType | null) => void;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const meta = metaFor(t);
  const hasValue = value !== '—';
  return (
    <Pressable onPress={() => onToggle(on ? null : t)} style={{ width: '47%', flexGrow: 1 }}
      accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={`${meta.label}: ${!hasValue ? 'no reading' : `${value} ${t === SensorType.Accelerometer ? '' : meta.unit}`}${status ? `, ${STATUS_LABEL[status]}` : ''}. ${on ? 'Hide' : 'Show'} graph.`}>
      {/* flex: 1 fills the row's stretched height, so a tile with a smaller value
          (Movement) matches its neighbour; space-between lines the hints up. */}
      <Card style={{ flex: 1, justifyContent: 'space-between', gap: 8, padding: 14, minHeight: 116,
        borderColor: on ? colors[meta.token] : colors.borderDefault, borderWidth: on ? 1.5 : 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name={meta.icon} size={14} color={colors[meta.token]} />
          <Micro style={{ flex: 1 }}>{TILE_NAME[t] ?? meta.label}</Micro>
          <Disclosure open={on} size={14} color={colors.textMuted} />
        </View>
        {/* Keyed on having a reading: "—" → a value remounts it and it pops in once;
            later values only update the text. flex-start so it scales about itself. */}
        <Animated.View key={hasValue ? 'value' : 'none'} entering={hasValue && !reduced ? VALUE_IN : undefined}
          style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, alignSelf: 'flex-start' }}>
          <Typo variant="dataLg" style={{ fontSize: t === SensorType.Accelerometer && hasValue ? 24 : 30 }}>{value}</Typo>
          {t !== SensorType.Accelerometer && hasValue && <Typo variant="unit">{meta.unit}</Typo>}
        </Animated.View>
        {status ? (
          /* Keyed on the verdict: Normal ↔ High remounts the badge, so the change draws
             the eye once instead of swapping silently. */
          <Animated.View key={status} entering={reduced ? undefined : BADGE_IN} style={{ alignSelf: 'flex-start' }}>
            <Badge tone={status === 'normal' ? 'success' : 'warning'} size="sm">{STATUS_LABEL[status]}</Badge>
          </Animated.View>
        ) : sub ? (
          <Typo variant="caption" color={colors.textMuted}>{sub}</Typo>
        ) : (
          <Typo variant="caption" color={colors.textMuted}>{hint ?? ' '}</Typo>
        )}
      </Card>
    </Pressable>
  );
});

function FocusGraph({ sensor, nowMs, connected, onClose }: { sensor: SensorType; nowMs: number; connected: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const ch = useMonitoring((s) => s.engine?.channels[sensor]);
  const meta = metaFor(sensor);
  const quiet = !connected || !ch?.lastAtMs || nowMs - ch.lastAtMs > STALE_MS;
  /* HR, SpO₂ and skin temperature arrive at ≤5 Hz with a timestamp per sample, so they
     are drawn on a real time axis: stretches with no reading show as a dotted line along
     zero, exactly where they happened. Movement (50 Hz) has no per-sample times; it
     shows the dotted zero line whenever it has no signal. */
  const timeAxis = sensor !== SensorType.Accelerometer;
  const paired = !!ch && ch.recentAt.length === ch.recent.length;
  /* The participant picks how much time the graph shows; remembered per signal.
     (Keyed by sensor at the call site, so switching graphs re-reads the choice.) */
  const windows = LIVE_WINDOWS[sensor];
  const [windowSec, setWindowSec] = React.useState(() => liveWindowFor(sensor, meta.windowSec));
  const chooseWindow = (sec: number) => { setWindowSec(sec); saveLiveWindow(sensor, sec); };
  /* Movement has no per-sample times: show the newest windowSec of samples. */
  const accelSamples = ch && ch.rateHz > 0 ? ch.recent.slice(-Math.ceil(windowSec * ch.rateHz)) : (ch?.recent ?? []);
  return (
    <Card style={{ gap: 10, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={meta.icon} size={16} color={colors[meta.token]} />
        <Typo variant="label" style={{ fontSize: 14, flex: 1 }}>{sensor === SensorType.Temperature ? 'Skin temperature' : meta.label}</Typo>
        {!windows && <Micro>{meta.window}</Micro>}
        <IconButton icon="x" label={`Hide ${meta.label} graph`} size="sm" onPress={onClose} />
      </View>
      {windows && <WindowPicker options={windows} value={windowSec} onChange={chooseWindow} label={`${meta.label} graph`} />}
      {timeAxis ? (
        <SignalTrace
          data={connected && paired ? ch!.recent : []}
          timestamps={connected && paired ? ch!.recentAt : []}
          nowMs={nowMs} windowMs={windowSec * 1000} gapMs={STALE_MS}
          color={colors[meta.token]} height={130}
          min={meta.range[0]} max={meta.range[1]} ticks={meta.ticks}
        />
      ) : (
        <SignalTrace
          data={quiet ? [] : accelSamples} noSignal={quiet}
          color={colors[meta.token]} height={130}
          min={meta.range[0]} max={meta.range[1]} ticks={meta.ticks}
        />
      )}
      {quiet && (
        <Typo variant="caption" color={colors.textMuted}>
          {!connected ? 'No signal — connect your sensor to see this graph.' : 'No signal right now — shown as a dotted line at zero.'}
        </Typo>
      )}
    </Card>
  );
}
