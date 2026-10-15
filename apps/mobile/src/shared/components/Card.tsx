import React from 'react';
import { View, type ViewProps } from 'react-native';
import { layout } from '@wearwise/design-tokens';
import { useTheme } from '@/shared/theme/ThemeProvider';

const asNum = (v: unknown, fb: number): number => (typeof v === 'number' ? v : fb);

/* The design system's Card: 16px radius, hairline border, no drop shadow on the
   night canvas (depth comes from surface, not shadow). */
export function Card({ style, children, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View
      {...rest}
      style={[{
        backgroundColor: colors.surfaceCard, borderColor: colors.borderDefault, borderWidth: 1,
        borderRadius: asNum(layout.radiusCard, 16), padding: asNum(layout.cardPadding, 16),
      }, style]}
    >
      {children}
    </View>
  );
}
