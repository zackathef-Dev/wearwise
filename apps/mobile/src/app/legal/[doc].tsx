import React from 'react';
import { View, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { docBySlug } from '@wearwise/legal';
import { LegalDocView } from '@/features/legal/LegalDocView';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { IconButton } from '@/shared/components/kit';

/* One legal document. Public: sign-up and sign-in link here. */
export default function LegalDocScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { doc: slug } = useLocalSearchParams<{ doc: string }>();
  const doc = docBySlug(String(slug));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
        <IconButton icon="arrow-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/legal'))} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 48 }}>
        {doc ? <LegalDocView doc={doc} /> : <Typo variant="body">This document doesn’t exist.</Typo>}
      </ScrollView>
    </SafeAreaView>
  );
}
