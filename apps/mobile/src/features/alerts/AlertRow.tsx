import React from 'react';
import { View, Pressable } from 'react-native';
import type { AlertRecord } from '@/domain/entities/session';
import { metaFor } from '@/shared/signal-meta';
import { alertTitle, alertValue } from '@/domain/vitals/alert-text';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Icon } from '@/shared/icons/Icon';
import { IconButton } from '@/shared/components/kit';

/* One alert, written out: what happened, how far out of range, when, for how long. */

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function alertWhen(a: AlertRecord, withDate = false): string {
  const start = new Date(a.startedAt);
  const day = withDate ? `${start.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ` : '';
  if (a.kind === 'fall') return `${day}${clock(a.startedAt)}`;
  if (!a.endedAt) return `${day}${clock(a.startedAt)} · still going`;
  const mins = Math.max(1, Math.round((Date.parse(a.endedAt) - start.getTime()) / 60000));
  return `${day}${clock(a.startedAt)}–${clock(a.endedAt)} · ${mins} min`;
}

export function AlertRow({ alert, onPress, onDelete, withDate, last }: {
  alert: AlertRecord; onPress?: () => void; onDelete?: () => void; withDate?: boolean; last?: boolean;
}) {
  const { colors } = useTheme();
  const severe = alert.kind === 'fall' || !alert.endedAt;
  const fg = severe ? colors.statusErrorText : colors.statusWarningText;
  const bg = severe ? colors.statusErrorBg : colors.statusWarningBg;
  const icon = alert.kind === 'fall' ? 'person-standing'
    : alert.sensorType != null ? metaFor(alert.sensorType).icon : 'triangle-alert';
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${alertTitle(alert)}, ${alertValue(alert)}, ${alertWhen(alert, true)}${alert.seen ? '' : ', new'}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.borderDefault }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={fg} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Typo variant="label" style={{ fontSize: 14 }}>{alertTitle(alert)}</Typo>
          {!alert.seen && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.wwError }} />}
        </View>
        <Typo variant="caption" color={colors.textSecondary}>
          {alertValue(alert)} · {alertWhen(alert, withDate)}{alert.sessionId ? ' · in a recording' : ''}
        </Typo>
      </View>
      {onDelete
        ? <IconButton icon="trash-2" label={`Delete ${alertTitle(alert)} alert`} size="sm" onPress={onDelete} />
        : onPress && <Icon name="chevron-right" size={16} color={colors.textMuted} />}
    </Pressable>
  );
}
