import React from 'react';
import { View, ScrollView, Pressable, Share, Switch as RNSwitch, ActivityIndicator } from 'react-native';
import { Redirect, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontFamilies } from '@wearwise/design-tokens';
import type { SensorType } from '@wearwise/sensor-protocol';
import {
  sharing, isSharingFailure, normaliseSignals, SHAREABLE_SIGNALS,
  type AccessGrant, type PendingShareCode, type ShareCode, type ShareScope, type SharingFailureCode,
} from '@/data/remote/sharing';
import { useAuth } from '@/features/authentication/auth-store';
import { useSync } from '@/features/sync/sync-store';
import { LiveViewSection } from '@/features/live-view/LiveView';
import { useLiveView } from '@/features/live-view/live-view-store';
import { canCopy, copyText } from '@/platform/clipboard/clipboard';
import { metaFor, signalName } from '@/shared/signal-meta';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Avatar } from '@/shared/components/Avatar';
import { Icon } from '@/shared/icons/Icon';
import { IconButton, Badge, Alert, SectionLabel, Micro } from '@/shared/components/kit';

/* PRIVACY & ACCESS — who can see this participant's cloud data, and the controls to
 * change that. Nobody sees anything until the participant makes a one-time share
 * code and gives it to a researcher or clinician, who enters it in the dashboard.
 * Each person's access can be narrowed or removed here at any time; the server
 * applies it on their next query. A code nobody has used yet can be withdrawn.
 * Live view for setup lets the people with access watch readings as they arrive.
 */

const FAILURE_COPY: Record<SharingFailureCode, string> = {
  offline: 'You’re offline, or the server can’t be reached. Check your connection and try again.',
  'not-configured': 'This build isn’t connected to a WearWise server.',
  'not-allowed': 'Only a participant account can share data. If that’s you, contact the study team.',
  'no-signals': 'Choose at least one signal.',
  unavailable: 'Sharing isn’t available on this server yet. Try again later.',
  unknown: 'Something went wrong on our side. Try again in a moment.',
};
const failureCode = (e: unknown): SharingFailureCode => (isSharingFailure(e) ? e.code : 'unknown');

const ALL: ShareScope = { sensorTypes: [...SHAREABLE_SIGNALS], includeFalls: true };

const fmtSince = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/* On screen, "14:05 tomorrow" — a code always expires about a day out. */
const fmtUntil = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? `${t} today` : days === 1 ? `${t} tomorrow`
    : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${t}`;
};

/* In a shared message, an absolute time: it may be read on another day. */
const fmtUntilAbsolute = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const sameScope = (a: ShareScope, b: ShareScope) =>
  a.includeFalls === b.includeFalls && a.sensorTypes.length === b.sensorTypes.length
  && a.sensorTypes.every((t) => b.sensorTypes.includes(t));

const scopeLabel = (s: ShareScope) => [...normaliseSignals(s.sensorTypes).map(signalName), ...(s.includeFalls ? ['falls'] : [])].join(', ');

/* What a code or grant covers, read-only: each signal with its own glyph and data
   colour, the way the rest of the app shows signals. */
function ScopeChips({ scope, lead = 'Can see' }: { scope: ShareScope; lead?: string }) {
  const { colors } = useTheme();
  const chip = (key: string, icon: string, tint: string, label: string) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 9,
      borderRadius: 13, borderWidth: 1, borderColor: colors.borderDefault, backgroundColor: colors.surfaceSubtle }}>
      <Icon name={icon} size={12} color={tint} />
      <Typo variant="caption" color={colors.textBody} style={{ fontFamily: fontFamilies.medium }}>{label}</Typo>
    </View>
  );
  return (
    <View accessible accessibilityLabel={`${lead} ${scopeLabel(scope)}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {/* Canonical order, whatever order the picker toggled them in. */}
      {normaliseSignals(scope.sensorTypes).map((t) => { const m = metaFor(t); return chip(String(t), m.icon, colors[m.token], signalName(t)); })}
      {scope.includeFalls && chip('falls', 'person-standing', colors.statusErrorText, 'Falls')}
    </View>
  );
}

/* Choose signals + falls. Same chip treatment as the Record picker on Home. */
function ScopePicker({ scope, onChange, disabled, emptyHint }: {
  scope: ShareScope; onChange: (s: ShareScope) => void; disabled?: boolean; emptyHint: string;
}) {
  const { colors } = useTheme();
  const toggle = (t: SensorType) => onChange({
    ...scope,
    sensorTypes: scope.sensorTypes.includes(t) ? scope.sensorTypes.filter((x) => x !== t) : [...scope.sensorTypes, t],
  });
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SHAREABLE_SIGNALS.map((t) => {
          const on = scope.sensorTypes.includes(t);
          return (
            <Pressable key={t} disabled={disabled} onPress={() => toggle(t)} hitSlop={4}
              accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !!disabled }} accessibilityLabel={signalName(t)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18,
                borderWidth: on ? 1.5 : 1, borderColor: on ? colors.actionPrimary : colors.borderDefault,
                backgroundColor: on ? colors.surfaceSelected : colors.surfaceCard }}>
              {on && <Icon name="check" size={13} color={colors.actionPrimary} />}
              <Typo variant="label" color={on ? colors.actionPrimary : colors.textBody} style={{ fontSize: 13 }}>{signalName(t)}</Typo>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Typo variant="label">Include falls</Typo>
          <Typo variant="caption" color={colors.textMuted}>Falls the sensor detected, with when they happened.</Typo>
        </View>
        <RNSwitch value={scope.includeFalls} disabled={disabled} accessibilityLabel="Include falls"
          onValueChange={(v) => onChange({ ...scope, includeFalls: v })}
          trackColor={{ true: colors.actionPrimary, false: colors.surfaceTrack }} thumbColor={colors.controlKnob} />
      </View>
      {scope.sensorTypes.length === 0 && <Typo variant="caption" color={colors.statusWarningText}>{emptyHint}</Typo>}
    </View>
  );
}

/* One person with access: who they are, what they see, and Change / Remove. */
function GrantCard({ grant, onSaved, onRemoved, onGone }: {
  grant: AccessGrant; onSaved: (id: string, scope: ShareScope) => void; onRemoved: (id: string) => void;
  /* The grant had already ended when we tried to change or remove it. */
  onGone: (grant: AccessGrant, attempted: 'change' | 'remove') => void;
}) {
  const { colors } = useTheme();
  const [mode, setMode] = React.useState<'view' | 'edit' | 'remove'>('view');
  const [draft, setDraft] = React.useState<ShareScope>({ sensorTypes: grant.sensorTypes, includeFalls: grant.includeFalls });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const who = grant.name ?? grant.email;
  const open = (m: 'edit' | 'remove') => {
    setDraft({ sensorTypes: grant.sensorTypes, includeFalls: grant.includeFalls }); setError(null); setMode(m);
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (await sharing.updateAccessGrant(grant.id, draft)) { setMode('view'); onSaved(grant.id, draft); }
      else onGone(grant, 'change');
    } catch (e) { setError(FAILURE_COPY[failureCode(e)]); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    /* Either outcome unmounts this card (the parent drops the row), so only reset on failure. */
    try {
      if (await sharing.revokeAccessGrant(grant.id)) onRemoved(grant.id);
      else onGone(grant, 'remove');
    } catch (e) { setError(FAILURE_COPY[failureCode(e)]); setBusy(false); }
  };

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Avatar uri={null} name={grant.name ?? grant.email ?? ''} size={40} />
        <View style={{ flex: 1, gap: 4 }}>
          <Typo variant="label" style={{ fontSize: 15.5 }} numberOfLines={1}>{who ?? 'Unnamed viewer'}</Typo>
          {grant.name && grant.email ? <Typo variant="caption" color={colors.textSecondary} numberOfLines={1}>{grant.email}</Typo> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            {grant.role === 'researcher' && <Badge tone="info" size="sm">Researcher</Badge>}
            {grant.role === 'clinician' && <Badge tone="teal" size="sm">Clinician</Badge>}
            {!grant.accessActive && <Badge tone="warning" size="sm">Paused</Badge>}
            <Typo variant="caption" color={colors.textMuted}>Since {fmtSince(grant.createdAt)}</Typo>
          </View>
          {/* The grant stands but the server shows them nothing (account suspended, or no
              longer a researcher or clinician). It resumes if their account does. */}
          {!grant.accessActive && (
            <Typo variant="caption" color={colors.statusWarningText}>
              Their account isn’t active, so they can’t see anything right now.
            </Typo>
          )}
        </View>
      </View>

      {mode === 'edit' ? (
        <View style={{ gap: 12, borderTopWidth: 1, borderTopColor: colors.borderDefault, paddingTop: 12 }}>
          <Micro>What they can see</Micro>
          <ScopePicker scope={draft} onChange={setDraft} disabled={busy}
            emptyHint="Choose at least one signal. To stop sharing altogether, remove their access instead." />
          {error && <Typo variant="bodySm" color={colors.statusErrorText}>{error}</Typo>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="secondary" style={{ flex: 1 }} onPress={() => setMode('view')}>Cancel</Button>
            <Button size="md" style={{ flex: 1 }} disabled={busy || !draft.sensorTypes.length || sameScope(draft, grant)}
              onPress={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
          </View>
        </View>
      ) : mode === 'remove' ? (
        <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.borderDefault, paddingTop: 12 }}>
          <Typo variant="bodySm">
            Remove {who ? `${who}’s` : 'their'} access? They stop seeing your data straight away. To share with them again, you’d give them a new code.
          </Typo>
          {error && <Typo variant="bodySm" color={colors.statusErrorText}>{error}</Typo>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="secondary" style={{ flex: 1 }} onPress={() => setMode('view')}>Cancel</Button>
            <Button size="md" style={{ flex: 1 }} disabled={busy} onPress={() => void remove()}>{busy ? 'Removing…' : 'Remove'}</Button>
          </View>
        </View>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <Micro>{grant.accessActive ? 'Can see' : 'Can see once active'}</Micro>
            <ScopeChips scope={grant} lead={grant.accessActive ? 'Can see' : 'Can see once active:'} />
          </View>
          {/* Ghost with tight padding, as on Devices: keeps both labels on one line at 360dp. */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button size="md" variant="secondary" style={{ flex: 1 }} onPress={() => open('edit')}>Change</Button>
            <Button size="md" variant="ghost" style={{ paddingHorizontal: 12 }} onPress={() => open('remove')}>Remove access</Button>
          </View>
        </>
      )}
    </Card>
  );
}

/* Make a code: pick → create → show it once, with Copy and Share. Afterwards (or on
   a later visit) the code is only "waiting": its text can't be shown again, so the
   choices are to withdraw it or replace it. */
function ShareSection({ waiting, setWaiting, reload }: {
  waiting: PendingShareCode | null; setWaiting: (w: PendingShareCode | null) => void; reload: () => void;
}) {
  const { colors } = useTheme();
  const [picking, setPicking] = React.useState(false);
  const [scope, setScope] = React.useState<ShareScope>(ALL);
  const [creating, setCreating] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<{ code: ShareCode; scope: ShareScope } | null>(null);
  const [copied, setCopied] = React.useState(false);

  const startPicking = (from: ShareScope) => { setScope(from); setError(null); setNote(null); setPicking(true); };

  const create = async () => {
    setCreating(true); setError(null);
    try {
      const code = await sharing.createShareCode(scope);
      setMade({ code, scope }); setCopied(false); setPicking(false);
      setWaiting({ expiresAt: code.expiresAt, sensorTypes: normaliseSignals(scope.sensorTypes), includeFalls: scope.includeFalls });
      reload();
    } catch (e) { setError(FAILURE_COPY[failureCode(e)]); }
    finally { setCreating(false); }
  };

  const cancel = async () => {
    setCancelling(true); setError(null); setNote(null);
    try {
      const withdrawn = await sharing.cancelShareCode();
      setWaiting(null);
      setNote(withdrawn ? 'Code cancelled. Nobody can use it now.'
        : 'That code had already been used or had run out, so there was nothing to cancel.');
      /* Already used → someone new may be in the list. */
      reload();
    } catch (e) { setError(FAILURE_COPY[failureCode(e)]); }
    finally { setCancelling(false); }
  };

  /* A code left on screen past its expiry is useless — take it down when it lapses. */
  React.useEffect(() => {
    if (!made) return;
    const t = setTimeout(() => setMade(null), Math.max(0, Date.parse(made.code.expiresAt) - Date.now()));
    return () => clearTimeout(t);
  }, [made]);

  /* Used, cancelled or expired (no code waiting any more): stop showing it. */
  if (made && waiting) {
    const { code, expiresAt } = made.code;
    const until = fmtUntil(expiresAt);
    return (
      <Card style={{ gap: 14 }}>
        <Typo variant="label">Your share code</Typo>
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 16, paddingHorizontal: 12, borderRadius: 12,
          borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle }}>
          {/* Selectable so it can be long-pressed and copied even where Copy isn't offered;
              read out letter by letter for screen readers. */}
          <Typo variant="dataLg" selectable numberOfLines={1} adjustsFontSizeToFit
            accessibilityLabel={`Share code: ${code.replace('-', '').split('').join(' ')}`}
            style={{ fontSize: 30, lineHeight: 40, letterSpacing: 2 }}>{code}</Typo>
          <Typo variant="caption" color={colors.textSecondary}>Works once, until {until}</Typo>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {canCopy() && (
            <Button size="md" variant="secondary" style={{ flex: 1 }}
              onPress={() => setCopied(copyText(code, { clearAfterMs: 120_000 }))}>{copied ? 'Copied' : 'Copy'}</Button>
          )}
          <Button size="md" style={{ flex: 1 }}
            onPress={() => { Share.share({ message: `My WearWise share code is ${code}. It works once, until ${fmtUntilAbsolute(expiresAt)}.` }).catch(() => {}); }}>
            Share
          </Button>
        </View>
        <View style={{ gap: 8 }}>
          <Micro>This code shares</Micro>
          <ScopeChips scope={made.scope} lead="Shares" />
        </View>
        <Alert kind="info" title="Only give it to someone you trust">
          Give this code only to a researcher or doctor you trust. Once they enter it, they can see your name and your backed-up sessions for the signals you chose (not your email), until you remove them here.
        </Alert>
        <Typo variant="caption" color={colors.textMuted}>
          This is the only time the code is shown. Making a new code cancels this one if it hasn’t been used yet.
        </Typo>
        <Button variant="ghost" onPress={() => setMade(null)}>Done</Button>
      </Card>
    );
  }

  if (picking) {
    return (
      <Card style={{ gap: 14 }}>
        <Typo variant="label">What do you want to share?</Typo>
        <ScopePicker scope={scope} onChange={setScope} disabled={creating} emptyHint="Choose at least one signal to share." />
        {error && <Typo variant="bodySm" color={colors.statusErrorText}>{error}</Typo>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button size="md" variant="secondary" style={{ flex: 1 }} onPress={() => { setPicking(false); setError(null); }}>Cancel</Button>
          <Button size="md" style={{ flex: 1 }} disabled={creating || !scope.sensorTypes.length}
            onPress={() => void create()}>{creating ? 'Creating…' : 'Create code'}</Button>
        </View>
        <Typo variant="caption" color={colors.textMuted}>
          {waiting
            ? 'You’ll get a new code to give to a researcher or doctor. The code that’s waiting stops working.'
            : 'You’ll get a code to give to a researcher or doctor. It works once, within 24 hours.'}
        </Typo>
      </Card>
    );
  }

  const feedback = (error || note) && (
    <Typo variant="bodySm" color={error ? colors.statusErrorText : colors.textSecondary} accessibilityLiveRegion="polite">
      {error ?? note}
    </Typo>
  );

  if (waiting) {
    return (
      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Icon name="clock" size={18} color={colors.textSecondary} />
          <View style={{ flex: 1, gap: 3 }}>
            <Typo variant="label">A share code is waiting to be used</Typo>
            <Typo variant="caption" color={colors.textSecondary}>
              Until {fmtUntil(waiting.expiresAt)}. The code itself can’t be shown again — if you’ve lost it, make a new one.
            </Typo>
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Micro>It covers</Micro>
          <ScopeChips scope={waiting} lead="Covers" />
        </View>
        {feedback}
        {/* Same shape as Change / Remove access: the ghost keeps tight padding so both
            labels fit on one line at 360dp. */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button size="md" variant="secondary" style={{ flex: 1 }} disabled={cancelling}
            onPress={() => startPicking({ sensorTypes: waiting.sensorTypes, includeFalls: waiting.includeFalls })}>Make a new code</Button>
          <Button size="md" variant="ghost" style={{ paddingHorizontal: 12 }} disabled={cancelling}
            onPress={() => void cancel()}>{cancelling ? 'Cancelling…' : 'Cancel code'}</Button>
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Icon name="share-2" size={18} color={colors.textSecondary} />
        <View style={{ flex: 1, gap: 3 }}>
          <Typo variant="label">Share with a researcher or doctor</Typo>
          <Typo variant="caption" color={colors.textSecondary}>
            Make a one-time code for them to enter in the WearWise dashboard. You choose what they see, and you can remove them at any time.
          </Typo>
        </View>
      </View>
      {feedback}
      <Button onPress={() => startPicking(ALL)}>Share my data</Button>
    </Card>
  );
}

export default function Privacy() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status, participant } = useAuth();
  const { phase: syncPhase, pending: syncPending, syncNow, refreshPending } = useSync();
  const participantId = participant?.id;

  const [grants, setGrants] = React.useState<AccessGrant[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<SharingFailureCode | null>(null);
  const [waiting, setWaiting] = React.useState<PendingShareCode | null>(null);
  /* "X's access had already ended" — shown until the participant leaves the screen. */
  const [notice, setNotice] = React.useState<string | null>(null);
  /* Only the newest request may write: a slow list from before a change must not
     overwrite the list after it. */
  const seq = React.useRef(0);
  const load = React.useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const [list, code] = await Promise.allSettled([sharing.listAccessGrants(), sharing.pendingShareCode()]);
    if (mine !== seq.current) return;
    if (list.status === 'fulfilled') { setGrants(list.value); setLoadError(null); }
    else setLoadError(failureCode(list.reason));
    /* The waiting code is secondary: if it can't be checked, keep what we had. */
    if (code.status === 'fulfilled') setWaiting(code.value);
    setLoading(false);
  }, []);

  useFocusEffect(React.useCallback(() => {
    void load();
    if (participantId) void refreshPending(participantId);
    return () => setNotice(null);
  }, [load, participantId, refreshPending]));

  /* A viewer who stops live view may have removed themselves (Remove participant on
     the dashboard stops it first): re-list when live view loses someone. */
  React.useEffect(() => useLiveView.subscribe((now, before) => {
    if (now.viewers.length < before.viewers.length) void load();
  }), [load]);

  /* While a code is waiting, check now and then whether it has been used: the person
     who just handed it over should see the researcher appear without tapping refresh. */
  useFocusEffect(React.useCallback(() => {
    if (!waiting) return;
    const t = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(t);
  }, [waiting, load]));

  /* Drop the waiting code when it runs out, rather than offer to cancel a dead one. */
  React.useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaiting(null), Math.max(0, Date.parse(waiting.expiresAt) - Date.now()));
    return () => clearTimeout(t);
  }, [waiting]);

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  /* Show the change at once, then re-list: the server is the record (a grant the
     viewer ended meanwhile simply drops out). */
  /* Live view, if on, follows at once: a removed person stops receiving, a narrowed
     scope applies to the next batch. */
  const onSaved = (id: string, scope: ShareScope) => {
    setGrants((gs) => gs && gs.map((g) => (g.id === id ? { ...g, ...scope } : g)));
    void load();
    void useLiveView.getState().refreshViewers();
  };
  const drop = (id: string, message: string | null) => {
    setGrants((gs) => gs && gs.filter((g) => g.id !== id));
    setNotice(message);
    void load();
    void useLiveView.getState().refreshViewers();
  };
  const onRemoved = (id: string) => drop(id, null);
  /* Already ended (the viewer may have removed it): say so plainly, then re-list. */
  const onGone = (g: AccessGrant, attempted: 'change' | 'remove') => drop(g.id,
    `${g.name ?? g.email ?? 'This person'}’s access had already ended — they may have stopped it themselves${
      attempted === 'change' ? ', so there was nothing to change' : ''}. They can’t see your data.`);

  const offline = loadError === 'offline';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
        <IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />
        <Typo variant="h2" accessibilityRole="header" style={{ flex: 1 }}>Privacy & access</Typo>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <Typo variant="caption" color={colors.textSecondary}>
          You decide who can see your recordings and what they see. You can change or remove anyone’s access at any time.
        </Typo>

        <SectionLabel action={grants != null && (
          <IconButton icon="refresh-cw" size="sm" label="Check again" onPress={() => void load()} />
        )}>
          {grants?.length ? `People with access · ${grants.length}` : 'People with access'}
        </SectionLabel>

        {grants == null ? (
          loadError ? (
            <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }} accessibilityLiveRegion="polite">
              <Icon name={offline ? 'cloud-off' : 'circle-alert'} size={26} color={colors.textMuted} />
              <Typo variant="label">{offline ? 'Can’t check right now' : 'Couldn’t load who has access'}</Typo>
              <Typo variant="caption" style={{ textAlign: 'center' }}>{FAILURE_COPY[loadError]}</Typo>
              <Button size="md" variant="secondary" disabled={loading} onPress={() => void load()}>{loading ? 'Trying…' : 'Try again'}</Button>
            </Card>
          ) : (
            <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
              <ActivityIndicator color={colors.actionPrimary} />
              <Typo variant="caption">Checking who can see your data…</Typo>
            </Card>
          )
        ) : (
          <>
            {/* Last list stays up; say plainly that it might be out of date. */}
            {loadError && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLiveRegion="polite">
                <Icon name={offline ? 'cloud-off' : 'circle-alert'} size={16} color={colors.statusWarningText} />
                <Typo variant="caption" color={colors.statusWarningText} style={{ flex: 1 }}>
                  {offline ? 'Offline — this list may be out of date.' : 'Couldn’t check for changes — this list may be out of date.'}
                </Typo>
                <Button size="md" variant="ghost" style={{ paddingHorizontal: 12 }} disabled={loading} onPress={() => void load()}>Retry</Button>
              </View>
            )}
            {notice && <View accessibilityLiveRegion="polite"><Alert kind="info">{notice}</Alert></View>}
            {grants.length === 0 ? (
              <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 26 }}>
                <Icon name="lock" size={26} color={colors.textMuted} />
                <Typo variant="label">Nobody can see your data</Typo>
                <Typo variant="caption" style={{ textAlign: 'center' }}>
                  No researcher or doctor can see your recordings unless you share them using a code below.
                </Typo>
              </Card>
            ) : grants.map((g) => <GrantCard key={g.id} grant={g} onSaved={onSaved} onRemoved={onRemoved} onGone={onGone} />)}
          </>
        )}

        <SectionLabel>Live view for setup</SectionLabel>
        <LiveViewSection grants={grants} />

        <SectionLabel>Share my data</SectionLabel>
        <ShareSection waiting={waiting} setWaiting={setWaiting} reload={() => void load()} />

        {/* Viewers read the cloud copy only — so what's still on the phone is invisible
            to them. Same "back up now" as Home and Profile's Cloud & sync. */}
        <Card style={{ gap: 10, backgroundColor: colors.surfaceInfo, borderColor: colors.borderInfoBlue }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Icon name="cloud" size={18} color={colors.wwTeal700} />
            <View style={{ flex: 1, gap: 3 }}>
              <Typo variant="label" style={{ fontSize: 13.5 }}>Only backed-up sessions are shared</Typo>
              <Typo variant="caption" color={colors.textSecondary}>
                People you share with see sessions once they’re backed up to the cloud, not recordings that are only on this phone.
              </Typo>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 30 }}>
            <Typo variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>
              {syncPhase === 'syncing' ? 'Backing up…' : syncPending > 0 ? `${syncPending} session${syncPending === 1 ? '' : 's'} not backed up yet` : 'Everything on this phone is backed up.'}
            </Typo>
            {syncPending > 0 && syncPhase !== 'syncing' && (
              <Button size="md" variant="ghost" style={{ paddingHorizontal: 12 }}
                onPress={() => participantId && void syncNow(participantId)}>Back up now</Button>
            )}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
