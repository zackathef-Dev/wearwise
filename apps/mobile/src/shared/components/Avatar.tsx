import React from 'react';
import { View, Image } from 'react-native';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from './Typography';

/* The participant's picture, or their initials on the brand tint when there is none
   (or the file can't be shown). */
export function Avatar({ uri, name, size = 36 }: { uri: string | null; name: string; size?: number }) {
  const { colors } = useTheme();
  /* Remember WHICH picture failed, so a new one is tried again without an effect. */
  const [failedUri, setFailedUri] = React.useState<string | null>(null);
  const failed = !!uri && failedUri === uri;
  const initials = (name || 'You').split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden',
      backgroundColor: colors.surfaceSelected, alignItems: 'center', justifyContent: 'center' }}>
      {uri && !failed
        ? <Image source={{ uri }} style={{ width: size, height: size }} onError={() => setFailedUri(uri)} accessibilityIgnoresInvertColors />
        : <Typo variant="label" color={colors.wwTeal} style={{ fontSize: Math.round(size * 0.34) }}>{initials}</Typo>}
    </View>
  );
}
