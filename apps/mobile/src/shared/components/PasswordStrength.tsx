import React from 'react';
import { View } from 'react-native';
import { passwordStrength } from '@wearwise/password';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';

/* Under a new-password field: a four-step meter, the strength in words, the one most
 * useful tip, and the checklist (required items vs recommendations). The rules are
 * shared with the web dashboard (packages/password). `context`: the person's name and
 * email, so a password built on them scores lower.
 */
export function PasswordStrength({ password, context = [] }: { password: string; context?: string[] }) {
  const { colors } = useTheme();
  const s = passwordStrength(password, context);
  const tone = [colors.surfaceTrack, colors.statusErrorText, colors.statusWarningText, colors.actionPrimary, colors.statusSuccessText][s.score];
  return (
    <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[1, 2, 3, 4].map((n) => (
          <View key={n} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: n <= s.score ? tone : colors.surfaceTrack }} />
        ))}
      </View>
      {password ? (
        <Typo variant="caption" color={colors.textBody}>
          <Typo variant="caption" style={{ fontWeight: '600' }}>Strength: {s.label}.</Typo>
          {s.tip ? ` ${s.tip}` : ' Good choice.'}
        </Typo>
      ) : null}
      <View style={{ gap: 2 }}>
        {s.checks.map((c) => (
          <Typo key={c.id} variant="caption" color={c.met ? colors.textBody : colors.textMuted}
            accessibilityLabel={`${c.label}${c.required ? '' : ', recommended'}: ${c.met ? 'done' : 'not yet'}`}>
            <Typo variant="caption" color={c.met ? colors.actionPrimary : colors.textMuted}>{c.met ? '✓' : '○'}</Typo>
            {`  ${c.label}`}{c.required ? '' : ' (recommended)'}
          </Typo>
        ))}
      </View>
    </View>
  );
}
