import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DOCS, TEAM, copyrightLine, fill } from '@wearwise/legal';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Card } from '@/shared/components/Card';
import { Icon } from '@/shared/icons/Icon';
import { IconButton } from '@/shared/components/kit';

/* LEGAL & PRIVACY — every document, readable signed in or not (sign-up links here).
   The researcher terms are listed too: participants can see what researchers agree to.
   Below them, who made WearWise and its licence (TEAM in @wearwise/legal). */
const ICONS: Record<string, string> = {
  terms: 'book-open', privacy: 'shield-check', 'collection-notice': 'info', 'health-safety': 'heart',
  research: 'microscope', 'researcher-terms': 'user', accessibility: 'contrast',
};

export default function Legal() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
        <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Typo variant="h2" accessibilityRole="header" style={{ flex: 1 }}>Legal & privacy</Typo>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        {DOCS.map((d) => (
          <Pressable key={d.slug} onPress={() => router.push(`/legal/${d.slug}`)} accessibilityRole="button" accessibilityLabel={d.title}>
            <Card style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <Icon name={ICONS[d.slug] ?? 'info'} size={20} color={colors.actionPrimary} />
              <View style={{ flex: 1, gap: 3 }}>
                <Typo variant="label">{d.title}</Typo>
                <Typo variant="caption" color={colors.textMuted}>{fill(d.summary)}</Typo>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </Card>
          </Pressable>
        ))}

        <Card style={{ gap: 12, marginTop: 8 }}>
          <Typo variant="label" accessibilityRole="header">Made by the {TEAM.name}</Typo>
          {TEAM.members.map((m) => (
            <View key={m.name} style={{ gap: 2 }}>
              <Typo variant="bodySm">{m.name}</Typo>
              <Typo variant="caption" color={colors.textMuted}>{m.role}</Typo>
            </View>
          ))}
          <Typo variant="caption" color={colors.textMuted}>
            {copyrightLine()} · {TEAM.project}. {TEAM.licenceSummary} Licence: {TEAM.licence}.
          </Typo>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
