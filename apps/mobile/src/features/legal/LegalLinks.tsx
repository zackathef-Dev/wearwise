import React from 'react';
import { View, Pressable } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';

/** Links to the documents someone agrees to, shown under the agreement box. */
export function LegalLinks() {
  const router = useRouter();
  const { colors } = useTheme();
  const links: [string, Href][] = [
    ['Terms of Use', '/legal/terms'], ['Privacy Policy', '/legal/privacy'],
    ['Collection Notice', '/legal/collection-notice'], ['Research information', '/legal/research'],
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 4 }}>
      {links.map(([label, href]) => (
        <Pressable key={label} onPress={() => router.push(href)} accessibilityRole="link" hitSlop={8}>
          <Typo variant="label" color={colors.textLink}>{label}</Typo>
        </Pressable>
      ))}
    </View>
  );
}
