import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from './Typography';
import type { WindowOption } from '@/shared/graph-window';

/* A compact row of time-window choices ("30 s · 1 min · 5 min") for a graph.
 * Same selected look as the session detail's signal tabs. */
export function WindowPicker({ options, value, onChange, label, groupLabel, optionLabel }: {
  options: readonly WindowOption[];
  value: number;
  onChange: (sec: number) => void;
  /** what the window applies to, for screen readers ("Heart rate graph") */
  label: string;
  /** for other choices of time (how long live view stays on): the group's and each option's spoken name */
  groupLabel?: string;
  optionLabel?: (o: WindowOption) => string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={groupLabel ?? `${label} time window`}>
      {options.map((o) => {
        const on = o.sec === value;
        return (
          <Pressable key={o.sec} onPress={() => onChange(o.sec)} hitSlop={6}
            accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={optionLabel ? optionLabel(o) : o.label === 'All' ? 'Whole session' : `Last ${o.label}`}
            style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? colors.surfaceRaised : 'transparent', borderWidth: 1, borderColor: on ? colors.borderStrong : colors.borderDefault }}>
            <Typo variant="caption" numberOfLines={1} color={on ? colors.textHeading : colors.textSecondary}>{o.label}</Typo>
          </Pressable>
        );
      })}
    </View>
  );
}
