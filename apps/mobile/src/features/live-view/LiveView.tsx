import React from 'react';
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { backendConfigured } from '@/data/remote/supabase-client';
import type { AccessGrant } from '@/data/remote/sharing';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { signalName } from '@/shared/signal-meta';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Icon } from '@/shared/icons/Icon';
import { LiveDot, Micro } from '@/shared/components/kit';
import { useLiveView, type LiveViewEnd } from './live-view-store';
import {
  DEFAULT_LIVE_VIEW_MINUTES, LIVE_VIEW_MINUTES, durationLabel, liveViewBlocker, liveViewGrants, timeLeftLabel, viewerName,
  type LiveGrant, type LiveViewBlocker,
} from './live-view-core';
import { WindowPicker } from '@/shared/components/WindowPicker';

/* Live view for setup, on screen: the Privacy & access section that explains it and
 * turns it on or off, and the compact banner Home shows while it is on.
 */

/* The clock, re-read every `everyMs` while `active` (time left on screen). */
function useNow(everyMs: number, active: boolean): number {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [everyMs, active]);
  return now;
}

const names = (viewers: readonly LiveGrant[]): string => {
  const [a, b] = viewers.map(viewerName);
  if (viewers.length === 1) return a!;
  if (viewers.length === 2) return `${a} and ${b}`;
  return `${a} and ${viewers.length - 1} others`;
};

const BLOCKED: Record<LiveViewBlocker, string> = {
  'no-backend': 'This build isn’t connected to a WearWise server.',
  'no-viewers': 'Nobody can watch yet. Live view is only for people you already share with, and their access must be active.',
  'no-sensor': 'Connect your sensor to use live view.',
};

const DURATIONS = LIVE_VIEW_MINUTES.map((m) => ({ sec: m * 60, label: durationLabel(m) }));

const ENDED: Record<LiveViewEnd, string> = {
  'time-up': 'Live view switched itself off at the end of the time you chose.',
  'sensor-lost': 'Live view switched off because your sensor disconnected.',
  'no-viewers': 'Live view switched off because nobody you share with can watch any more.',
  'viewers-stopped': 'Live view switched off because everyone watching stopped.',
  offline: 'Live view switched off because the phone couldn’t reach the server to check who can watch.',
  'signed-out': '',
};

function ViewerRow({ v, last }: { v: LiveGrant; last: boolean }) {
  const { colors } = useTheme();
  return (
    <View accessible style={{ gap: 2, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.borderDefault }}>
      <Typo variant="label" style={{ fontSize: 14 }} numberOfLines={1}>{viewerName(v)}</Typo>
      {v.name && v.email ? <Typo variant="caption" color={colors.textSecondary} numberOfLines={1}>{v.email}</Typo> : null}
      <Typo variant="caption" color={colors.textMuted}>Sees {[...v.sensorTypes.map(signalName), ...(v.includeFalls ? ['falls'] : [])].join(', ')}</Typo>
    </View>
  );
}

/* Privacy & access. `grants` is the screen's list of people with access (null while
   it loads), so the section shows who WOULD see it before it is turned on. */
export function LiveViewSection({ grants }: { grants: AccessGrant[] | null }) {
  const { colors } = useTheme();
  const phase = useLiveView((s) => s.phase);
  const endsAt = useLiveView((s) => s.endsAt);
  const watching = useLiveView((s) => s.viewers);
  const reachable = useLiveView((s) => s.reachable);
  const error = useLiveView((s) => s.error);
  const ended = useLiveView((s) => s.ended);
  const start = useLiveView((s) => s.start);
  const stop = useLiveView((s) => s.stop);
  const connected = useMonitoring((s) => s.engine?.connection === 'connected_ble' || s.engine?.connection === 'connected_wifi');
  const on = phase === 'on';
  const now = useNow(15_000, on);
  /* How long, chosen each time: 30 minutes unless they pick longer. */
  const [minutes, setMinutes] = React.useState<number>(DEFAULT_LIVE_VIEW_MINUTES);

  const viewers = on ? watching : grants ? liveViewGrants(grants) : [];
  const blocker = grants == null && !on ? null : liveViewBlocker({ backend: backendConfigured, viewers: viewers.length, sensorConnected: connected });

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Icon name="signal" size={18} color={on ? colors.actionPrimary : colors.textSecondary} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Typo variant="label" style={{ flexShrink: 1 }}>Live view for setup</Typo>
            {on && <LiveDot />}
          </View>
          <Typo variant="caption" color={colors.textSecondary}>
            While someone helps you put your sensor on, they can watch your readings as they arrive. Nothing is saved: the readings go straight to them and aren’t stored anywhere. It switches itself off after the time you choose, from 30 minutes to 8 hours. They can ask you to start a recording; nothing records unless you tap Start. Keep WearWise open while it’s on: it pauses while the app is in the background.
          </Typo>
        </View>
      </View>

      {viewers.length > 0 && (
        <View>
          <Micro>{on ? 'Who can watch now' : 'Who would see it'}</Micro>
          {viewers.map((v, i) => <ViewerRow key={v.id} v={v} last={i === viewers.length - 1} />)}
        </View>
      )}

      {on && endsAt != null ? (
        <View style={{ gap: 10 }} accessibilityLiveRegion="polite">
          <Typo variant="bodySm" color={colors.textBody}>
            On · {timeLeftLabel(endsAt, now)} · {reachable === 0 ? 'connecting…' : `reaching ${reachable} of ${watching.length}`}
          </Typo>
          <Button variant="secondary" onPress={() => void stop()}>Stop live view</Button>
        </View>
      ) : (
        <View style={{ gap: 10 }} accessibilityLiveRegion="polite">
          {blocker && <Typo variant="caption" color={colors.statusWarningText}>{BLOCKED[blocker]}</Typo>}
          {!blocker && ended && ENDED[ended] ? <Typo variant="caption" color={colors.textSecondary}>{ENDED[ended]}</Typo> : null}
          {error && <Typo variant="bodySm" color={colors.statusErrorText}>{error}</Typo>}
          {!blocker && grants != null && (
            <View style={{ gap: 8 }}>
              <Micro>How long</Micro>
              <WindowPicker
                options={DURATIONS} value={minutes * 60} onChange={(sec) => setMinutes(sec / 60)} label="Live view"
                groupLabel="How long live view stays on" optionLabel={(o) => `For ${o.label}`}
              />
            </View>
          )}
          <Button disabled={!!blocker || grants == null || phase === 'starting'} onPress={() => void start(minutes)}>
            {phase === 'starting' ? 'Starting…' : `Start live view · ${durationLabel(minutes)}`}
          </Button>
        </View>
      )}
    </Card>
  );
}

/* Home, while live view is on: who can watch, time left, and Stop. */
export function LiveViewBanner() {
  const router = useRouter();
  const { colors } = useTheme();
  const on = useLiveView((s) => s.phase === 'on');
  const endsAt = useLiveView((s) => s.endsAt);
  const viewers = useLiveView((s) => s.viewers);
  const stop = useLiveView((s) => s.stop);
  const now = useNow(15_000, on);
  if (!on || endsAt == null) return null;
  const who = viewers.length ? `${names(viewers)} can watch` : 'Live readings are being shared';
  const left = timeLeftLabel(endsAt, now);
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderColor: colors.actionPrimary }}>
      <Pressable onPress={() => router.push('/privacy')} accessibilityRole="button"
        accessibilityLabel={`Live view is on. ${who}, ${left}. Opens Privacy and access.`}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="signal" size={18} color={colors.actionPrimary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Typo variant="label" style={{ fontSize: 14 }}>Live view is on</Typo>
          <Typo variant="caption" color={colors.textSecondary} numberOfLines={2}>{who} · {left}</Typo>
        </View>
      </Pressable>
      <Button size="md" variant="secondary" style={{ paddingHorizontal: 14 }} onPress={() => void stop()}>Stop</Button>
    </Card>
  );
}
