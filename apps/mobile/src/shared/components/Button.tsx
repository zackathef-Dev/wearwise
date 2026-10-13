import React from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { layout } from '@wearwise/design-tokens';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from './Typography';

/* Primary / secondary / ghost actions. Sizes and radii come from tokens; the
 * pressed treatment is the design system's: darker fill plus a 0.985 scale, no
 * ripple (ripple is Android-only and the two platforms should feel the same).
 */

type Variant = 'primary' | 'secondary' | 'ghost';

const asNum = (v: unknown, fb: number): number => (typeof v === 'number' ? v : fb);

export interface ButtonProps {
  children: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'md' | 'lg';
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({ children, onPress, variant = 'primary', size = 'md', disabled, style }: ButtonProps) {
  const { colors } = useTheme();

  const height = size === 'lg' ? 52 : 44; // >= --touch-min in both sizes
  const byVariant: Record<Variant, { bg: string; bgPressed: string; fg: string; border?: string }> = {
    primary: { bg: colors.actionPrimary, bgPressed: colors.actionPrimaryPress, fg: colors.actionPrimaryText },
    secondary: { bg: colors.surfaceCard, bgPressed: colors.actionSecondaryHoverBg, fg: colors.actionSecondaryText, border: colors.actionSecondaryBorder },
    ghost: { bg: 'transparent', bgPressed: colors.surfaceSubtle, fg: colors.actionSecondaryText },
  };
  const v = byVariant[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height,
          minHeight: asNum(layout.touchMin, 44),
          borderRadius: asNum(layout.radiusButton, 12),
          paddingHorizontal: size === 'lg' ? 26 : 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? v.bgPressed : v.bg,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      {/* The button is a fixed height, so a label must stay on one line: shrink a
          little when space is tight rather than break mid-word. */}
      <Typo variant="label" color={v.fg} style={{ fontSize: size === 'lg' ? 16 : 15 }}
        numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {children}
      </Typo>
    </Pressable>
  );
}
