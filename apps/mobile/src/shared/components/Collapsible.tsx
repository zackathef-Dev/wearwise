import React from 'react';
import { View, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from './Typography';
import { Icon, type IconName } from '@/shared/icons/Icon';
import { Disclosure, useExpandAnimation } from './motion';

/* A titled row that shows its explanation only when tapped — for the "how this works"
 * text that is worth having but not worth reading every time. Closed by default. */
export function Collapsible({ title, icon = 'info', children, style }: {
  title: string; icon?: IconName | string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = React.useState(false);
  const expand = useExpandAnimation();
  const toggle = () => {
    expand();
    setOpen((o) => !o);
  };
  return (
    <View style={[{ borderRadius: 14, borderWidth: 1, borderColor: colors.borderDefault, backgroundColor: colors.surfaceCard, overflow: 'hidden' }, style]}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12,
          backgroundColor: pressed ? colors.surfaceSubtle : 'transparent' })}>
        <Icon name={icon} size={16} color={colors.textSecondary} />
        <Typo variant="label" style={{ flex: 1, fontSize: 13.5 }}>{title}</Typo>
        <Disclosure open={open} size={16} color={colors.textMuted} />
      </Pressable>
      {open && <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>{children}</View>}
    </View>
  );
}
