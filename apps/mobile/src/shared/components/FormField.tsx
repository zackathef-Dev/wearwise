import React from 'react';
import { View, TextInput, Pressable, type TextInputProps } from 'react-native';
import { layout } from '@wearwise/design-tokens';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from './Typography';

/* Labelled text input with an error line. The error is text under the field, in
 * the error colour AND in words — never a red border alone (status is written,
 * not implied by colour).
 *
 * A `secureTextEntry` field gets a Show/Hide toggle — in words, like status.
 */

const asNum = (v: unknown, fb: number): number => (typeof v === 'number' ? v : fb);

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | undefined;
}

export function FormField({ label, error, secureTextEntry, ...input }: FormFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);

  return (
    <View style={{ gap: 6 }}>
      <Typo variant="label">{label}</Typo>
      <View style={{ justifyContent: 'center' }}>
      <TextInput
        {...input}
        secureTextEntry={secureTextEntry && !revealed}
        /* Revealed text must still read as a password to the keyboard, or Android
           offers suggestions and can learn it into the user dictionary. */
        {...(secureTextEntry ? { autoCorrect: false, spellCheck: false, keyboardType: revealed ? 'visible-password' : 'default' } as const : {})}
        accessibilityLabel={label}
        onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
        placeholderTextColor={colors.textMuted}
        style={{
          minHeight: asNum(layout.touchMin, 44),
          borderRadius: asNum(layout.radiusInput, 10),
          borderWidth: focused ? 2 : 1,
          borderColor: error ? colors.wwError : focused ? colors.borderFocus : colors.borderDefault,
          paddingHorizontal: 14,
          paddingRight: secureTextEntry ? 72 : 14,
          fontSize: 15,
          fontFamily: 'Poppins_400Regular',
          color: colors.textBody,
          backgroundColor: colors.surfaceCard,
        }}
      />
      {secureTextEntry ? (
        <Pressable
          onPress={() => setRevealed((r) => !r)}
          accessibilityRole="button"
          accessibilityLabel={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          hitSlop={8}
          style={{ position: 'absolute', right: 0, minWidth: 64, minHeight: asNum(layout.touchMin, 44),
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}
        >
          <Typo variant="label" color={colors.textLink}>{revealed ? 'Hide' : 'Show'}</Typo>
        </Pressable>
      ) : null}
      </View>
      {error ? (
        <Typo variant="caption" color={colors.wwError} accessibilityLiveRegion="polite">
          {error}
        </Typo>
      ) : null}
    </View>
  );
}
