import React from 'react';
import { View, Pressable } from 'react-native';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';

/* A tick box with its explanation: a 44 pt row, the whole of it pressable. */
export function CheckRow({ checked, onToggle, title, detail, error }: {
  checked: boolean; onToggle: () => void; title: string; detail: string; error?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={title}
        onPress={onToggle}
        style={{
          flexDirection: 'row', gap: 12, alignItems: 'flex-start',
          backgroundColor: colors.surfaceSubtle, borderRadius: 12, padding: 14,
          borderWidth: 1, borderColor: colors.borderDefault, minHeight: 44,
        }}
      >
        <View style={{
          width: 22, height: 22, borderRadius: 6, marginTop: 2,
          borderWidth: checked ? 0 : 1.5, borderColor: colors.borderStrong,
          backgroundColor: checked ? colors.actionPrimary : 'transparent',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {checked ? <Typo variant="label" color={colors.actionPrimaryText}>✓</Typo> : null}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Typo variant="label">{title}</Typo>
          <Typo variant="caption">{detail}</Typo>
        </View>
      </Pressable>
      {error ? <Typo variant="caption" color={colors.statusErrorText}>{error}</Typo> : null}
    </View>
  );
}
