import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Redirect, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SENSOR_CODES } from '@wearwise/sensor-protocol';
import { layout } from '@wearwise/design-tokens';
import { useAuth } from '@/features/authentication/auth-store';
import { useSync } from '@/features/sync/sync-store';
import { useMonitoring, getSessionStore, deviceLabel } from '@/features/monitoring/monitoring-store';
import { deleteSessionsEverywhere } from '@/features/sync/delete-sessions';
import type { SessionSummaryRow } from '@/domain/repositories/session-store';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Icon } from '@/shared/icons/Icon';
import { Reveal } from '@/shared/components/Reveal';

/* History — the local session list, read straight from the encrypted store.
 * A just-stopped session appears here immediately (build instruction §15.6):
 * the list re-queries on every focus, not on a timer.
 *
 * Select mode: tick sessions one by one (or Select all) and delete them together —
 * from this phone and from the cloud backup, with a confirmation first. A long press
 * on a row starts select mode with that row ticked.
 */

const CHIP: Record<string, string> = { ecg: 'ECG', bpm: 'HR', spo2: 'SpO₂', temperature: 'Temp', accel: 'Move', ppg: 'PPG' };
const fmtDuration = (ms: number | null) => {
  if (ms == null) return '—';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m >= 1 ? `${m} min` : `${Math.round(ms / 1000)} s`;
};
const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today · ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${time}`;
};
const STATUS_COPY: Record<string, string> = { complete: 'Saved', interrupted: 'Interrupted', recording: 'Recording', discarded: 'Deleted' };

export default function History() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status, participant } = useAuth();
  /* Narrow selectors, NOT a whole-store read. History stays mounted under the Live
     route after the first recording ends here, and a selector-less useMonitoring()
     re-renders on every store write — including the ~15 fps engine snapshot during a
     recording — reconciling the (growing) session list behind the live screen and
     stealing the JS thread. None of these slices change at packet cadence. */
  const init = useMonitoring((s) => s.init);
  const devices = useMonitoring((s) => s.devices);
  const ready = useMonitoring((s) => s.ready);
  const recovered = useMonitoring((s) => s.recovered);
  const keepRecovered = useMonitoring((s) => s.keepRecovered);
  const deleteRecovered = useMonitoring((s) => s.deleteRecovered);
  const storage = useMonitoring((s) => s.storage);
  const [rows, setRows] = React.useState<SessionSummaryRow[] | null>(null);
  const [fallCounts, setFallCounts] = React.useState<Record<string, number>>({});
  const participantId = participant?.id;
  const refreshPending = useSync((s) => s.refreshPending);
  /* Select mode */
  const [selecting, setSelecting] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [deleteNote, setDeleteNote] = React.useState<string | null>(null);
  const exitSelect = () => { setSelecting(false); setPicked(new Set()); setConfirmDelete(false); };
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  React.useEffect(() => { if (participantId) void init(participantId); }, [participantId, init]);

  const reload = React.useCallback(() => {
    const store = getSessionStore();
    if (!participantId || !store) return;
    void store.listSessions(participantId).then(setRows);
    void store.fallCountsForUser(participantId).then(setFallCounts).catch(() => setFallCounts({}));
  }, [participantId]);

  useFocusEffect(React.useCallback(() => {
    if (ready) reload();
    return () => { setSelecting(false); setPicked(new Set()); setConfirmDelete(false); };
  }, [ready, reload]));
  const restoredAt = useSync((s) => s.restoredAt);
  React.useEffect(() => { if (ready) reload(); }, [ready, reload, recovered.length, restoredAt]);

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  /* A session still awaiting the Keep/Delete prompt shows as its own card; don't ALSO
     list it as a row. A session still recording can't be selected. */
  const recoveredIds = new Set(recovered.map((r) => r.session.id));
  const listRows = rows?.filter((r) => !recoveredIds.has(r.session.id)) ?? null;
  const selectable = (listRows ?? []).filter((r) => r.session.status !== 'recording');
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.session.id));

  const runDelete = async () => {
    if (!participantId || !picked.size) return;
    const ids = [...picked];
    setConfirmDelete(false); setDeleteNote(null);
    setProgress({ done: 0, total: ids.length });
    const { deleted, failed } = await deleteSessionsEverywhere(participantId, ids, (done) => setProgress({ done, total: ids.length }));
    setProgress(null);
    setPicked(new Set(failed.map((f) => f.id)));
    if (!failed.length) setSelecting(false);
    setDeleteNote(failed.length
      ? `Deleted ${deleted.length}. ${failed.length} could not be deleted: ${failed[0]!.reason}`
      : `Deleted ${deleted.length} session${deleted.length === 1 ? '' : 's'}.`);
    reload();
    void refreshPending(participantId);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Typo variant="h2" accessibilityRole="header">History</Typo>
            <Typo variant="caption">
              {selecting ? `${picked.size} selected` : `Your recorded sessions${storage?.mode === 'memory-only' ? ' · this session only' : ''}`}
            </Typo>
          </View>
          {selecting ? (
            <>
              <Button variant="ghost" size="md" disabled={!!progress} onPress={() => setPicked(allPicked ? new Set() : new Set(selectable.map((r) => r.session.id)))}>
                {allPicked ? 'Clear' : 'Select all'}
              </Button>
              <Button variant="ghost" size="md" disabled={!!progress} onPress={exitSelect}>Cancel</Button>
            </>
          ) : selectable.length > 0 ? (
            <Button variant="ghost" size="md" onPress={() => { setDeleteNote(null); setSelecting(true); }}>Select</Button>
          ) : null}
        </View>

        {deleteNote && !progress && <Typo variant="bodySm" color={colors.textSecondary} accessibilityLiveRegion="polite">{deleteNote}</Typo>}

        {selecting && (
          <Card style={{ gap: 10 }}>
            {progress ? (
              <Typo variant="label" accessibilityLiveRegion="polite">Deleting {progress.done} of {progress.total}…</Typo>
            ) : confirmDelete ? (
              <>
                <Typo variant="label">Delete {picked.size} session{picked.size === 1 ? '' : 's'}?</Typo>
                <Typo variant="caption">
                  {picked.size === 1 ? 'It is' : 'They are'} removed from this phone and from the cloud backup, including any falls recorded in {picked.size === 1 ? 'it' : 'them'}. This cannot be undone.
                </Typo>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmDelete(false)}>Cancel</Button>
                  <Button style={{ flex: 1 }} onPress={() => void runDelete()}>Delete</Button>
                </View>
              </>
            ) : (
              <Button disabled={!picked.size} onPress={() => setConfirmDelete(true)}>
                {picked.size ? `Delete ${picked.size} session${picked.size === 1 ? '' : 's'}` : 'Tick sessions to delete'}
              </Button>
            )}
          </Card>
        )}

        {recovered.map((r) => (
          <Card key={r.session.id} style={{ backgroundColor: colors.statusWarningBg, borderColor: colors.borderWarning, gap: 10 }}>
            <Typo variant="label" color={colors.statusWarningText}>A recording was interrupted</Typo>
            <Typo variant="bodySm" color={colors.statusWarningText}>
              The app closed before this session was finished. {r.totalSamples.toLocaleString()} readings were saved
              {r.recovery.chunksCorrupt ? ` (${r.recovery.chunksCorrupt} damaged block${r.recovery.chunksCorrupt > 1 ? 's' : ''} skipped)` : ''}.
              Keep it, or delete it?
            </Typo>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button size="md" onPress={() => void keepRecovered(r.session.id)} style={{ flex: 1 }}>Keep</Button>
              <Button size="md" variant="secondary" onPress={() => void deleteRecovered(r.session.id)} style={{ flex: 1 }}>Delete</Button>
            </View>
          </Card>
        ))}

        {(() => {
        return listRows == null ? (
          <Typo variant="bodySm" color={colors.textSecondary}>Loading…</Typo>
        ) : listRows.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
            <Typo variant="label">No sessions yet</Typo>
            <Typo variant="caption" style={{ textAlign: 'center' }}>Record from Home and the session appears here as soon as you stop it.</Typo>
            <Button onPress={() => router.navigate('/home')}>Go to Home</Button>
          </Card>
        ) : (
          <Card style={{ padding: 0 }}>
            {/* Rows rise in on the first load (the first eight, staggered). A refresh keeps
                their keys, so it never replays; a just-recorded session rises in alone. */}
            {listRows.map((r, i) => {
              const canPick = r.session.status !== 'recording';
              const on = picked.has(r.session.id);
              return (
              <Reveal key={r.session.id} index={i}>
              <Pressable
                onPress={() => { if (selecting) { if (canPick) toggle(r.session.id); } else router.push(`/session/${r.session.id}`); }}
                onLongPress={() => { if (!selecting && canPick) { setDeleteNote(null); setSelecting(true); setPicked(new Set([r.session.id])); } }}
                disabled={selecting && (!canPick || !!progress)}
                accessibilityRole={selecting ? 'checkbox' : 'button'}
                accessibilityState={selecting ? { checked: on, disabled: !canPick } : undefined}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 64,
                  borderTopWidth: i ? 1 : 0, borderTopColor: colors.borderDefault,
                  backgroundColor: selecting && on ? colors.surfaceSelected : 'transparent' }}>
                {selecting && (
                  <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', opacity: canPick ? 1 : 0.3,
                    borderWidth: 2, borderColor: on ? colors.actionPrimary : colors.borderStrong, backgroundColor: on ? colors.actionPrimary : 'transparent' }}>
                    {on && <Icon name="check" size={13} color={colors.actionPrimaryText} />}
                  </View>
                )}
                {/* Leading avatar tile — the scannable left rail every row has in the mockup. */}
                <View style={{ width: 36, height: 36, borderRadius: layout.radiusXs, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="activity" size={17} color={colors.textHeading} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                  {/* Title is the device that recorded this session. */}
                  <Typo variant="label" style={{ fontSize: 14.5 }} numberOfLines={1}>
                    {r.session.simulated ? 'Simulated Patch'
                      : deviceLabel(devices, r.session.deviceId, r.session.configurationSnapshot.deviceName || 'Unknown device')}
                  </Typo>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <Typo variant="caption">{fmtWhen(r.session.startedAt)}</Typo>
                    {r.channels.map((c) => (
                      <View key={c.id} style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.statusNeutralBg, borderWidth: 1, borderColor: colors.borderDefault }}>
                        <Typo variant="caption" color={colors.statusNeutralText}>{CHIP[SENSOR_CODES[c.sensorType]] ?? SENSOR_CODES[c.sensorType]}</Typo>
                      </View>
                    ))}
                    {(fallCounts[r.session.id] ?? 0) > 0 && (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.statusErrorBg, borderWidth: 1, borderColor: colors.borderError }}>
                        <Typo variant="caption" color={colors.statusErrorText}>
                          {fallCounts[r.session.id]} fall{fallCounts[r.session.id] === 1 ? '' : 's'}
                        </Typo>
                      </View>
                    )}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Typo variant="label">{fmtDuration(r.session.durationMs)}</Typo>
                  <Typo variant="micro" color={r.session.status === 'interrupted' ? colors.statusWarningText : colors.textMuted}>
                    {STATUS_COPY[r.session.status] ?? r.session.status}
                  </Typo>
                </View>
                {/* Disclosure chevron — signals the row opens the session detail. */}
                {!selecting && <Icon name="chevron-right" size={18} color={colors.textMuted} />}
              </Pressable>
              </Reveal>
              );
            })}
          </Card>
        );
        })()}

        <Typo variant="caption" style={{ textAlign: 'center' }}>
          Sessions are saved on this phone first, then backed up to the cloud when you’re online.
        </Typo>
        <Button variant="ghost" onPress={() => router.replace('/home')}>Home</Button>
      </ScrollView>
    </SafeAreaView>
  );
}
