import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Redirect, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SENSOR_CODES, SAMPLE_SCALE, type SensorType } from '@wearwise/sensor-protocol';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring, getSessionStore, deviceLabel } from '@/features/monitoring/monitoring-store';
import type { SessionSummaryRow } from '@/domain/repositories/session-store';
import type { SessionChannel, FallEventRecord, SyncState } from '@/domain/entities/session';
import { deleteSessionEverywhere } from '@/features/sync/delete-sessions';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Badge, IconButton } from '@/shared/components/kit';
import { WindowPicker } from '@/shared/components/WindowPicker';
import { ALL, clampStart, panStart, sessionZoomOptions } from '@/shared/graph-window';
import { channelSamples, type ChannelSamples } from '@/shared/chunk-samples';
import { SignalTrace } from '@/shared/charts/SignalTrace';
import { DrawIn, useExpandAnimation } from '@/shared/components/motion';

/* One saved session, read from local storage. The chart is built by decoding the
 * stored chunks — the same bytes that will be uploaded — downsampled to fit.
 * Summaries are the stored per-channel aggregates; nothing is recomputed here.
 */

/* `short` is what the tab renders — the long `label` wraps/clips when 3-4 tabs
   share the row on a narrow phone. The long label stays for accessibility/headers. */
const META: Record<string, { label: string; short: string; token: 'wwDataEcg' | 'wwDataSpo2' | 'wwDataTemp' | 'wwDataHeart' | 'wwDataAccel'; digits: number }> = {
  ecg: { label: 'Heart rhythm', short: 'ECG', token: 'wwDataEcg', digits: 2 },
  bpm: { label: 'Heart rate', short: 'HR', token: 'wwDataHeart', digits: 0 },
  spo2: { label: 'Blood oxygen', short: 'SpO₂', token: 'wwDataSpo2', digits: 1 },
  temperature: { label: 'Temperature', short: 'Temp', token: 'wwDataTemp', digits: 2 },
  accel: { label: 'Movement', short: 'Move', token: 'wwDataAccel', digits: 2 },
  ppg: { label: 'Pulse (PPG)', short: 'PPG', token: 'wwDataHeart', digits: 0 },
};
const MAX_POINTS = 600;

const fmtDuration = (ms: number | null) => (ms == null ? '—' : `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`);

export default function SessionDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { status, participant } = useAuth();
  const { init, ready, devices } = useMonitoring();
  const [row, setRow] = React.useState<SessionSummaryRow | null | undefined>(undefined);
  const [falls, setFalls] = React.useState<FallEventRecord[]>([]);
  const [focus, setFocus] = React.useState<SensorType | null>(null);
  /* The focused channel's stored bytes, read on demand: the chart pulls ~600 strided
     points for the whole session or a zoomed window, never decoding it all. */
  const [samples, setSamples] = React.useState<ChannelSamples | null>(null);
  const [zoomSec, setZoomSec] = React.useState(ALL);
  const [startSec, setStartSec] = React.useState(0);
  const [advanced, setAdvanced] = React.useState(false);
  const expand = useExpandAnimation();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [sync, setSync] = React.useState<SyncState | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  React.useEffect(() => { if (participant?.id) void init(participant.id); }, [participant?.id, init]);

  React.useEffect(() => {
    const store = getSessionStore();
    if (!store || !ready || !id || status !== 'signed-in' || !participant) return;
    let cancelled = false;
    /* Fetch once per session — NOT on every tab tap. `focus` is seeded from the
       first channel here and then owned by the tab buttons; listing it as a dep
       would refetch the whole session (and re-decode the trace) on each switch. */
    void store.getSession(id).then(async (candidate) => {
      if (cancelled) return;
      setFalls([]); setSamples(null); setFocus(null);
      const r = candidate?.session.userId === participant.id ? candidate : null;
      setRow(r);
      if (r && r.channels[0]) setFocus((f) => f ?? r.channels[0]!.sensorType);
      if (r) {
        const events = await store.listFallEvents(id);
        if (!cancelled) setFalls(events);
        const state = await store.getSyncState(id);
        if (!cancelled) setSync(state);
      }
    }).catch(() => { if (!cancelled) setRow(null); });
    return () => { cancelled = true; };
  }, [ready, id, status, participant]);

  React.useEffect(() => {
    const store = getSessionStore();
    const ch = row?.channels.find((c) => c.sensorType === focus);
    if (!store || !row || !ch) return;
    void store.listChunks(row.session.id, ch.id).then((chunks) => {
      /* A new channel starts zoomed out at the beginning. */
      setSamples(channelSamples(chunks, SAMPLE_SCALE[ch.sensorType].scale));
      setZoomSec(ALL); setStartSec(0);
    });
  }, [row, focus]);

  const focusCh = row?.channels.find((c) => c.sensorType === focus);
  const total = samples?.length ?? 0;
  /* Time comes from the session's real length, not samples ÷ nominal rate: heart
     rate and SpO₂ arrive per beat rather than on a fixed clock, which made a 5-min
     session read "of 04:11". Samples are spread evenly over the recorded time. */
  const sessionSec = (row?.session.durationMs ?? 0) / 1000;
  const durationSec = sessionSec > 0 ? sessionSec : (focusCh?.sampleRateHz ? total / focusCh.sampleRateHz : 0);
  const rateHz = durationSec > 0 ? total / durationSec : 0;
  /* Stride, not a min/max envelope: it keeps the shape honest at phone widths. */
  const trace = React.useMemo(() => {
    if (!samples) return [];
    const from = zoomSec === ALL ? 0 : startSec * rateHz;
    const to = zoomSec === ALL ? total : from + zoomSec * rateHz;
    return samples.strided(from, to, MAX_POINTS);
  }, [samples, total, rateHz, startSec, zoomSec]);
  const zoomOptions = durationSec > 0 ? sessionZoomOptions(durationSec) : [];

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;
  if (row === null || (row && row.session.userId !== participant?.id)) return <Redirect href="/history" />;

  const ch: SessionChannel | undefined = row?.channels.find((c) => c.sensorType === focus);
  const meta = ch ? META[SENSOR_CODES[ch.sensorType]] : undefined;

  /* Any sync attempt writes the session row before its channels, so once a sync
     state exists a cloud copy may exist too — even a failed or partial upload. */
  const uploaded = sync?.status === 'synced';
  const cloudMayExist = sync != null && (sync.status !== 'pending' || sync.attempts > 0);

  const del = async () => {
    const store = getSessionStore();
    if (!store || !row || row.session.userId !== participant?.id) return;
    setDeleting(true); setDeleteError(null);
    try {
      await deleteSessionEverywhere(participant.id, row.session.id);
      router.replace('/history');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'The session could not be deleted. Please try again.');
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View style={{ gap: 4 }}>
          <Typo variant="h2">Session detail</Typo>
          {row && <Typo variant="caption">{new Date(row.session.startedAt).toLocaleString()}</Typo>}
        </View>

        {!row ? <Typo variant="bodySm">Loading…</Typo> : (
          <>
            {/* Meta pills use the kit Badge so their height and iconography match every
                other pill in the app, rather than a hand-rolled one-off. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(() => {
                const interrupted = row.session.status === 'interrupted';
                const pills: { text: string; icon?: string; tone: 'neutral' | 'warning' }[] = [
                  interrupted
                    ? { text: 'Interrupted', icon: 'triangle-alert', tone: 'warning' }
                    : uploaded
                      ? { text: 'Uploaded to cloud', icon: 'cloud', tone: 'neutral' }
                      : { text: cloudMayExist ? 'Saved on this phone · upload pending' : 'Saved on this phone', icon: 'circle-check', tone: 'neutral' },
                  { text: fmtDuration(row.session.durationMs), icon: 'clock', tone: 'neutral' },
                  { text: row.session.simulated ? 'Simulated' : deviceLabel(devices, row.session.deviceId, row.session.configurationSnapshot.deviceName), icon: 'cpu', tone: 'neutral' },
                ];
                return pills.map((p) => <Badge key={p.text} tone={p.tone} icon={p.icon}>{p.text}</Badge>);
              })()}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {row.channels.map((c) => {
                const m = META[SENSOR_CODES[c.sensorType]]; const on = c.sensorType === focus;
                return (
                  <Pressable key={c.id} onPress={() => setFocus(c.sensorType)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                    accessibilityLabel={m?.label ?? SENSOR_CODES[c.sensorType]}
                    style={{ flex: 1, minHeight: 44, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 10,
                      backgroundColor: on ? colors.surfaceRaised : 'transparent', borderWidth: 1, borderColor: on ? colors.borderStrong : colors.borderDefault }}>
                    <Typo variant="label" numberOfLines={1} color={on ? colors.textHeading : colors.textSecondary}>{m?.short ?? (SENSOR_CODES[c.sensorType] ?? '').toUpperCase()}</Typo>
                  </Pressable>
                );
              })}
            </View>

            {ch && meta && (
              <Card style={{ gap: 12, paddingHorizontal: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 4 }}>
                  <Typo variant="dataLg" color={colors[meta.token]}>{ch.averageValue == null ? '—' : ch.averageValue.toFixed(meta.digits)}</Typo>
                  <Typo variant="unit">{ch.canonicalUnit}</Typo>
                  <Typo variant="micro" style={{ marginLeft: 'auto' }}>Session average</Typo>
                </View>
                {/* Draws in left → right each time a channel's data lands — not on re-renders. */}
                {/* Keyed to the loaded channel, so zooming and panning don't replay it. */}
                <DrawIn playKey={total ? samples : null}>
                  <SignalTrace data={trace} color={colors[meta.token]} height={130} />
                </DrawIn>
                {zoomOptions.length > 1 && (
                  <View style={{ gap: 10, paddingHorizontal: 4 }}>
                    <WindowPicker options={zoomOptions} value={zoomSec} label={meta.label}
                      onChange={(sec) => { setZoomSec(sec); setStartSec((s0) => clampStart(s0, sec, durationSec)); }} />
                    {zoomSec !== ALL && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <IconButton icon="chevron-left" size="sm" label="Earlier" onPress={() => setStartSec((s0) => panStart(s0, -1, zoomSec, durationSec))} />
                        <Typo variant="caption" color={colors.textSecondary} style={{ flex: 1, textAlign: 'center' }}>
                          {fmtDuration(startSec * 1000)} – {fmtDuration(Math.min(durationSec, startSec + zoomSec) * 1000)} of {fmtDuration(durationSec * 1000)}
                        </Typo>
                        <IconButton icon="chevron-right" size="sm" label="Later" onPress={() => setStartSec((s0) => panStart(s0, 1, zoomSec, durationSec))} />
                      </View>
                    )}
                  </View>
                )}
                <View style={{ flexDirection: 'row' }}>
                  {[
                    { label: 'Minimum', value: ch.minimumValue },
                    { label: 'Maximum', value: ch.maximumValue },
                    { label: 'Samples', value: ch.sampleCount, int: true },
                  ].map((s, i) => (
                    <View key={s.label} style={{ flex: 1, alignItems: 'center', gap: 4, borderLeftWidth: i ? 1 : 0, borderLeftColor: colors.borderDefault }}>
                      <Typo variant="dataSm" style={{ fontSize: 18 }}>{s.value == null ? '—' : s.int ? s.value.toLocaleString() : s.value.toFixed(meta.digits)}</Typo>
                      <Typo variant="micro">{s.label}</Typo>
                    </View>
                  ))}
                </View>
              </Card>
            )}

            {falls.length > 0 && (
              <Card style={{ gap: 10, backgroundColor: colors.statusErrorBg, borderColor: colors.borderError }}>
                <Typo variant="label" color={colors.statusErrorText}>
                  {falls.length} fall{falls.length === 1 ? '' : 's'} detected
                </Typo>
                {falls.map((f) => (
                  <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12,
                    borderTopWidth: 1, borderTopColor: colors.borderError, paddingTop: 8 }}>
                    <Typo variant="dataSm" style={{ fontSize: 16 }} color={colors.wwError}>{fmtDuration(f.detectedAtMs)}</Typo>
                    <Typo variant="caption" style={{ flex: 1 }} color={colors.statusErrorText}>Impact {f.impactPeakG.toFixed(1)} g</Typo>
                    <Badge tone={f.status === 'emergency' ? 'error' : 'neutral'} size="sm">
                      {f.status === 'emergency' ? 'Emergency' : 'Marked OK'}
                    </Badge>
                  </View>
                ))}
              </Card>
            )}

            {row.session.status === 'interrupted' && (
              <Card style={{ backgroundColor: colors.statusWarningBg, borderColor: colors.borderWarning, gap: 4 }}>
                <Typo variant="label" color={colors.statusWarningText}>This session was interrupted</Typo>
                <Typo variant="bodySm" color={colors.statusWarningText}>
                  The app closed before it was stopped. Everything saved up to that point is here
                  {row.session.recoveryState?.chunksCorrupt ? `; ${row.session.recoveryState.chunksCorrupt} damaged block(s) were skipped` : ''}.
                </Typo>
              </Card>
            )}

            <Pressable onPress={() => { expand(); setAdvanced(!advanced); }} accessibilityRole="button" accessibilityState={{ expanded: advanced }}>
              <Card style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Typo variant="label" style={{ flex: 1 }}>Advanced details</Typo>
                  <Typo variant="caption">{advanced ? 'Hide' : 'Show'}</Typo>
                </View>
                {advanced && (
                  <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.borderDefault, paddingTop: 10 }}>
                    {[
                      ['Sampling', row.channels.map((c) => `${SENSOR_CODES[c.sensorType]} ${c.sampleRateHz} Hz`).join(' · ')],
                      ['Transport', `${row.session.initialTransport}${row.session.transportSwitchCount ? ` → ${row.session.finalTransport} (${row.session.transportSwitchCount} switch)` : ''}`],
                      ['Protocol', `v${row.session.configurationSnapshot.protocolVersion}`],
                      ['Session id', row.session.id],
                      ['Stored', 'Encrypted on this phone'],
                    ].map(([k, v]) => (
                      <View key={k} style={{ flexDirection: 'row', gap: 12 }}>
                        <Typo variant="caption" style={{ width: 90 }}>{k}</Typo>
                        <Typo variant="caption" color={colors.textBody} style={{ flex: 1 }}>{v}</Typo>
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            </Pressable>

            {confirmDelete ? (
              <Card style={{ gap: 10 }}>
                <Typo variant="label">{cloudMayExist ? 'Delete this session everywhere?' : 'Delete this session from this phone?'}</Typo>
                <Typo variant="caption">
                  {cloudMayExist
                    ? 'It will be removed from this phone and from the cloud backup. This cannot be undone.'
                    : 'It has not been uploaded anywhere yet, so this cannot be undone.'}
                </Typo>
                {deleteError && (
                  <Typo variant="caption" color={colors.statusErrorText} accessibilityLiveRegion="assertive">{deleteError}</Typo>
                )}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button variant="secondary" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }}>Keep</Button>
                  <Button onPress={() => void del()} disabled={deleting} style={{ flex: 1 }}>{deleting ? 'Deleting…' : 'Delete'}</Button>
                </View>
              </Card>
            ) : (
              <Button variant="ghost" onPress={() => setConfirmDelete(true)}>Delete Session</Button>
            )}
          </>
        )}

        <Button variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/history"))}>Back</Button>
      </ScrollView>
    </SafeAreaView>
  );
}
