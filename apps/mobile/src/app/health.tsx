import React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BLOOD_GROUPS, type BloodGroup, type Sex } from '@/domain/entities/session';
import { validateProfile, num, ageFrom, bmi, bmiBand } from '@/domain/vitals/health-profile';
import { useAuth } from '@/features/authentication/auth-store';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { FormField } from '@/shared/components/FormField';
import { IconButton, Micro } from '@/shared/components/kit';

/* HEALTH INFORMATION — the participant's basic facts: sex, date of birth, height,
 * weight, blood group. All optional. Stored only in the encrypted database on this
 * phone; nothing here is uploaded.
 */

const SEXES: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' },
  { value: 'intersex', label: 'Intersex' }, { value: 'unspecified', label: 'Prefer not to say' },
];

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }} hitSlop={4}
      style={{ paddingHorizontal: 14, height: 40, borderRadius: 20, justifyContent: 'center',
        borderWidth: on ? 1.5 : 1, borderColor: on ? colors.actionPrimary : colors.borderDefault,
        backgroundColor: on ? colors.surfaceSelected : colors.surfaceCard }}>
      <Typo variant="label" color={on ? colors.actionPrimary : colors.textBody} style={{ fontSize: 14 }}>{label}</Typo>
    </Pressable>
  );
}

export default function HealthInfo() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status } = useAuth();
  const profile = useMonitoring((s) => s.healthProfile);
  const save = useMonitoring((s) => s.saveHealthProfile);

  const [sex, setSex] = React.useState<Sex | null>(profile?.sex ?? null);
  const [bloodGroup, setBloodGroup] = React.useState<BloodGroup | null>(profile?.bloodGroup ?? null);
  const [dateOfBirth, setDob] = React.useState(profile?.dateOfBirth ?? '');
  const [heightCm, setHeight] = React.useState(profile?.heightCm != null ? String(profile.heightCm) : '');
  const [weightKg, setWeight] = React.useState(profile?.weightKg != null ? String(profile.weightKg) : '');
  const [submitted, setSubmitted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  const errors = validateProfile({ dateOfBirth, heightCm, weightKg });
  const shown = submitted ? errors : {};
  const age = ageFrom(dateOfBirth.trim() || null);
  const b = bmi({ heightCm: num(heightCm), weightKg: num(weightKg) });

  const onSave = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    setSaving(true); setSaveError(null);
    try {
      await save({
        sex, bloodGroup, dateOfBirth: dateOfBirth.trim() || null,
        heightCm: num(heightCm), weightKg: num(weightKg),
      });
      router.back();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
        <IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />
        <Typo variant="h2" accessibilityRole="header" style={{ flex: 1 }}>Health information</Typo>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Typo variant="caption" color={colors.textSecondary}>
          Everything here is optional and stays in the encrypted database on this phone — it is not uploaded.
        </Typo>

        <View style={{ gap: 10 }}>
          <Micro>Sex</Micro>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            {SEXES.map((s) => <Chip key={s.value} label={s.label} on={sex === s.value} onPress={() => setSex(sex === s.value ? null : s.value)} />)}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <FormField label="Date of birth" value={dateOfBirth} onChangeText={setDob} placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation" maxLength={10} autoCorrect={false} error={shown.dateOfBirth} />
          {age != null && !errors.dateOfBirth && <Typo variant="caption" color={colors.textMuted}>Age {age}</Typo>}
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <FormField label="Height (cm)" value={heightCm} onChangeText={setHeight} placeholder="170"
              keyboardType="decimal-pad" maxLength={5} error={shown.heightCm} />
          </View>
          <View style={{ flex: 1 }}>
            <FormField label="Weight (kg)" value={weightKg} onChangeText={setWeight} placeholder="70"
              keyboardType="decimal-pad" maxLength={5} error={shown.weightKg} />
          </View>
        </View>
        {b != null && !errors.heightCm && !errors.weightKg && (
          <Typo variant="caption" color={colors.textMuted}>BMI {b.toFixed(1)} · {bmiBand(b)} (WHO adult bands)</Typo>
        )}

        <View style={{ gap: 10 }}>
          <Micro>Blood group</Micro>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            {BLOOD_GROUPS.map((g) => <Chip key={g} label={g} on={bloodGroup === g} onPress={() => setBloodGroup(bloodGroup === g ? null : g)} />)}
            <Chip label="Don’t know" on={bloodGroup === null} onPress={() => setBloodGroup(null)} />
          </View>
        </View>

        {saveError && <Typo variant="bodySm" color={colors.statusErrorText}>{saveError}</Typo>}
        <Card style={{ gap: 12, padding: 0, borderWidth: 0, backgroundColor: 'transparent' }}>
          <Button size="lg" onPress={() => void onSave()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          <Button variant="ghost" onPress={() => router.back()}>Cancel</Button>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
