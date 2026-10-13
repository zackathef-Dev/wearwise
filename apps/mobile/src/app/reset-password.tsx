import React from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetRequestSchema, type ResetRequestForm } from '@/shared/validation/auth-schemas';
import { isAuthFailure } from '@/domain/errors/auth-errors';
import { useAuth } from '@/features/authentication/auth-store';
import { authFailureCopy } from '@/features/authentication/auth-copy';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { FormField } from '@/shared/components/FormField';

/* Password reset request. The sent-state copy is identical whether or not the
 * account exists — this screen must not be usable to probe for accounts, so it
 * never learns the answer itself (the gateway swallows it).
 */
export default function ResetPassword() {
  const router = useRouter();
  const { colors } = useTheme();
  const { requestPasswordReset, status } = useAuth();
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const { control, handleSubmit, formState, getValues } = useForm<ResetRequestForm>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { email: '' },
  });

  const submit = handleSubmit(async ({ email }) => {
    setFailure(null);
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (e) {
      setFailure(authFailureCopy[isAuthFailure(e) ? e.code : 'unknown']);
    } finally {
      setBusy(false);
    }
  });

  if (sent) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
          <Typo variant="h2" accessibilityRole="header">Check your email</Typo>
          <Typo variant="body">
            If there’s an account for {getValues('email')}, a reset link is on its way.
            Open it on this phone to choose a new password.
          </Typo>
          <Button size="lg" variant="secondary" onPress={() => router.replace('/sign-in')}>
            Back to Sign In
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center', gap: 22 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6 }}>
            <Typo variant="h2" accessibilityRole="header">Reset password</Typo>
            <Typo variant="bodySm" color={colors.textSecondary}>
              Enter the email you signed up with and we’ll send a reset link.
            </Typo>
          </View>

          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <FormField label="Email" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur}
                error={formState.errors.email?.message} autoCapitalize="none" autoComplete="email"
                keyboardType="email-address" textContentType="emailAddress"
                onSubmitEditing={() => void submit()} />
            )}
          />

          {failure && (
            <Typo variant="bodySm" color={colors.statusErrorText} accessibilityLiveRegion="assertive">{failure}</Typo>
          )}

          <View style={{ gap: 10 }}>
            <Button size="lg" onPress={() => void submit()} disabled={busy || status === 'unconfigured'}>
              {busy ? 'Sending…' : 'Send Reset Link'}
            </Button>
            <Button size="lg" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace("/sign-in"))}>
              Cancel
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
