import React from 'react';
import { View, Pressable, type ViewStyle, type StyleProp } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, useReducedMotion, withRepeat, withTiming, withSequence } from 'react-native-reanimated';
import { fontFamilies, layout } from '@wearwise/design-tokens';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Icon, type IconName } from '@/shared/icons/Icon';
import { Typo } from './Typography';

/* RN ports of the web mockup's presentational kit — the same components the web
 * screens compose (chrome.jsx + design-system/data + feedback), so the phone reads
 * pixel-close to the mockup. Presentation only; no domain or data here.
 */

/* ---- Micro: the wide-tracked uppercase label ---- */
export function Micro({ children, color, style }: { children: React.ReactNode; color?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <Typo variant="micro" color={color ?? colors.textMuted} style={style as never}>{children}</Typo>;
}

export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Micro>{children}</Micro>
      {action}
    </View>
  );
}

/* ---- LiveDot: pulsing "LIVE" (a steady dot under Reduce Motion — the label says it) ---- */
export function LiveDot({ label = 'Live' }: { label?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const p = useSharedValue(1);
  React.useEffect(() => {
    if (reduced) return;
    p.set(withRepeat(withSequence(withTiming(0.3, { duration: 700 }), withTiming(1, { duration: 700 })), -1, false));
  }, [p, reduced]);
  const dot = useAnimatedStyle(() => ({ opacity: p.value }));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.stateLive }, dot]} />
      <Typo variant="micro" color={colors.stateLive}>{label}</Typo>
    </View>
  );
}

/* ---- IconButton ---- */
export function IconButton({ icon, label, onPress, variant = 'ghost', size = 'md' }: {
  icon: IconName | string; label: string; onPress?: () => void; variant?: 'ghost' | 'outline'; size?: 'sm' | 'md';
}) {
  const { colors } = useTheme();
  /* Match the web IconButton: a rounded SQUARE (radius-input), md == the 44px
     touch-minimum, not a circle. A circular d/2 was the port drifting from the DS. */
  const d = size === 'sm' ? 36 : 44;
  const base: ViewStyle = {
    width: d, height: d, borderRadius: layout.radiusInput, alignItems: 'center', justifyContent: 'center',
    borderWidth: variant === 'outline' ? 1 : 0, borderColor: colors.borderDefault,
  };
  const glyph = <Icon name={icon} size={size === 'sm' ? 18 : 20} color={colors.textSecondary} />;

  /* No handler → render a static icon, NOT a button. A pressable that does nothing
     reads as a broken control; a plain icon reads as decoration. */
  if (!onPress) {
    return <View style={[base, { backgroundColor: variant === 'outline' ? colors.surfaceCard : 'transparent' }]}>{glyph}</View>;
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [base, {
        backgroundColor: pressed ? colors.surfaceSubtle : (variant === 'outline' ? colors.surfaceCard : 'transparent'),
      }]}>
      {glyph}
    </Pressable>
  );
}

/* ---- Badge ---- */
type Tone = 'neutral' | 'teal' | 'success' | 'warning' | 'error' | 'info';
export function Badge({ children, tone = 'neutral', icon, size = 'md' }: {
  children: React.ReactNode; tone?: Tone; icon?: IconName | string; size?: 'sm' | 'md';
}) {
  const { colors } = useTheme();
  const map: Record<Tone, { bg: string; fg: string; border: string }> = {
    neutral: { bg: colors.statusNeutralBg, fg: colors.statusNeutralText, border: colors.borderDefault },
    teal: { bg: colors.badgeTealBg, fg: colors.badgeTealText, border: colors.borderInfo },
    success: { bg: colors.statusSuccessBg, fg: colors.statusSuccessText, border: colors.borderSuccess },
    warning: { bg: colors.statusWarningBg, fg: colors.statusWarningText, border: colors.borderWarning },
    error: { bg: colors.statusErrorBg, fg: colors.statusErrorText, border: colors.borderError },
    info: { bg: colors.statusInfoBg, fg: colors.statusInfoText, border: colors.borderInfoBlue },
  };
  const t = map[tone]; const sm = size === 'sm';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
      height: sm ? 22 : 26, paddingHorizontal: sm ? 8 : 10, borderRadius: 999,
      backgroundColor: t.bg, borderWidth: 1, borderColor: t.border }}>
      {icon && <Icon name={icon} size={sm ? 12 : 13} color={t.fg} />}
      {/* Web Badge label is medium-weight with .01em tracking — the plain caption
          role reads too light/tight next to the mockup's pills. */}
      <Typo variant="caption" color={t.fg} style={{ fontFamily: fontFamilies.medium, fontSize: sm ? 11 : 12, letterSpacing: (sm ? 11 : 12) * 0.01 }}>{children}</Typo>
    </View>
  );
}

/* ---- StatStrip: number/label pairs split by hairlines, no container ---- */
export interface Stat { value: string; unit?: string; label: string; color?: string; caption?: string }
export function StatStrip({ items, size = 'md', align = 'center' }: { items: Stat[]; size?: 'sm' | 'md' | 'lg'; align?: 'center' | 'flex-start' }) {
  const { colors } = useTheme();
  const V = { sm: 18, md: 24, lg: 32 }[size];
  const U = { sm: 11, md: 12, lg: 14 }[size];
  return (
    <View style={{ flexDirection: 'row' }}>
      {items.map((it, i) => (
        <View key={i} style={{ flex: 1, gap: 6, alignItems: align, justifyContent: 'space-between', paddingHorizontal: 10,
          borderLeftWidth: i ? 1 : 0, borderLeftColor: colors.borderDefault }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Typo variant="dataLg" color={it.color ?? colors.textHeading} style={{ fontSize: V, lineHeight: V, letterSpacing: -V * 0.02 }}>{it.value}</Typo>
            {/* Same line height as the value: the body line height made a column with a
                unit taller than its neighbours, pushing its label out of line. */}
            {it.unit ? <Typo variant="bodySm" color={colors.textSecondary} style={{ fontSize: U, lineHeight: V }}>{it.unit}</Typo> : null}
          </View>
          <Micro>{it.label}</Micro>
          {it.caption ? <Typo variant="caption" color={colors.textSecondary}>{it.caption}</Typo> : null}
        </View>
      ))}
    </View>
  );
}

/* ---- SegmentBar: one bar split into proportional segments, optional legend ---- */
export interface Segment { value: number; color: string; label: string; display?: string }
export function SegmentBar({ segments, height = 12, legend }: { segments: Segment[]; height?: number; legend?: boolean }) {
  const { colors } = useTheme();
  const total = segments.reduce((a, s) => a + (s.value || 0), 0) || 1;
  return (
    <View style={{ gap: legend ? 12 : 0 }}>
      <View style={{ flexDirection: 'row', gap: 2, height, borderRadius: 999, overflow: 'hidden', backgroundColor: colors.surfaceTrack }}>
        {segments.map((s, i) => (
          <View key={i} style={{ flex: Math.max(0.02, s.value / total), backgroundColor: s.color, borderRadius: 999 }} />
        ))}
      </View>
      {legend && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {segments.map((s, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginRight: 10 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
              <Typo variant="caption" color={colors.textSecondary}>{s.label}</Typo>
              <Typo variant="caption" color={colors.textHeading}>{s.display ?? `${Math.round((s.value / total) * 100)}%`}</Typo>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/* ---- TrendBars: 7-day history strip, most recent highlighted ---- */
export interface Trend { value: number; label: string; color?: string }
export function TrendBars({ data, height = 82, max, baseline }: { data: Trend[]; height?: number; max?: number; baseline?: { value: number; label?: string } }) {
  const { colors } = useTheme();
  const top = max ?? Math.max(...data.map((d) => d.value), 1) * 1.12;
  const h = (v: number) => Math.max(3, (v / top) * height);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height }}>
        {baseline != null && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: h(baseline.value), borderTopWidth: 1, borderTopColor: colors.wwDataReference, borderStyle: 'dashed' }}>
            {/* The web TrendBars sits a small right-aligned tag on the reference line;
                the port drew the line but silently dropped the label. */}
            {baseline.label ? (
              <View style={{ position: 'absolute', right: 0, top: -13, backgroundColor: colors.surfaceCard, paddingHorizontal: 4 }}>
                <Typo variant="micro" color={colors.textMuted}>{baseline.label}</Typo>
              </View>
            ) : null}
          </View>
        )}
        {data.map((d, i) => {
          const last = i === data.length - 1;
          return <View key={i} style={{ flex: 1, height: h(d.value), borderRadius: 4, backgroundColor: d.color ?? (last ? colors.wwTeal : colors.surfaceTrack) }} />;
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {data.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Micro color={i === data.length - 1 ? colors.textSecondary : colors.textMuted}>{d.label}</Micro>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---- Alert ---- */
type Kind = 'info' | 'teal' | 'success' | 'warning' | 'error';
export function Alert({ kind = 'info', title, children }: { kind?: Kind; title?: string; children?: React.ReactNode }) {
  const { colors } = useTheme();
  const map: Record<Kind, { bg: string; border: string; fg: string; icon: IconName }> = {
    info: { bg: colors.statusInfoBg, border: colors.borderInfoBlue, fg: colors.statusInfoText, icon: 'info' },
    teal: { bg: colors.wwAqua, border: colors.borderInfo, fg: colors.badgeTealText, icon: 'info' },
    success: { bg: colors.statusSuccessBg, border: colors.borderSuccess, fg: colors.statusSuccessText, icon: 'circle-check' },
    warning: { bg: colors.statusWarningBg, border: colors.borderWarning, fg: colors.statusWarningText, icon: 'triangle-alert' },
    error: { bg: colors.statusErrorBg, border: colors.borderError, fg: colors.statusErrorText, icon: 'circle-alert' },
  };
  const k = map[kind];
  return (
    <View style={{ flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16, backgroundColor: k.bg, borderWidth: 1, borderColor: k.border }}>
      <Icon name={k.icon} size={20} color={k.fg} />
      <View style={{ flex: 1, gap: 6 }}>
        {title ? <Typo variant="label" color={k.fg} style={{ fontFamily: fontFamilies.semiBold, fontSize: 15 }}>{title}</Typo> : null}
        {children ? <Typo variant="bodySm" color={colors.textBody}>{children}</Typo> : null}
      </View>
    </View>
  );
}
