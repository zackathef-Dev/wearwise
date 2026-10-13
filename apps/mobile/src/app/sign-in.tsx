import React from 'react';
import { View, Image, ScrollView, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signInSchema, type SignInForm } from '@/shared/validation/auth-schemas';
import { isAuthFailure } from '@/domain/errors/auth-errors';
import { homeRoute, useAuth } from '@/features/authentication/auth-store';
import { authFailureCopy } from '@/features/authentication/auth-copy';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { FormField } from '@/shared/components/FormField';
import { Icon } from '@/shared/icons/Icon';

export default function SignIn() {
  const router = useRouter();
  const { colors, dark } = useTheme();
  const { status, signIn } = useAuth();
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const { control, handleSubmit, formState } = useForm<SignInForm>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit(async ({ email, password }) => {
    setFailure(null);
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace(homeRoute(useAuth.getState().participant));
    } catch (e) {
      setFailure(authFailureCopy[isAuthFailure(e) ? e.code : 'unknown']);
    } finally {
      setBusy(false);
    }
  });

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center', gap: 26 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Image
              source={dark ? require('@/assets/brand/wearwise-logo-white.png') : require('@/assets/brand/wearwise-logo.png')}
              style={{ width: 190, height: 62, resizeMode: 'contain' }}
              accessibilityLabel="WearWise"
            />
            <Typo variant="label" color={colors.textSecondary}>Your Data, Your Decisions.</Typo>
          </View>

          {status === 'unconfigured' && (
            <View style={{ backgroundColor: colors.statusInfoBg, borderRadius: 12, padding: 14 }}>
              <Typo variant="bodySm" color={colors.statusInfoText}>
                {authFailureCopy['backend-not-configured']}
              </Typo>
            </View>
          )}

          <View style={{ gap: 14 }}>
            <Controller
              control={control}
              name="email"
              render={({ field }) => (
                <FormField
                  label="Email"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={formState.errors.email?.message}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <FormField
                  label="Password"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={formState.errors.password?.message}
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  onSubmitEditing={() => void submit()}
                />
              )}
            />
            <Pressable onPress={() => router.push('/reset-password')} accessibilityRole="link" hitSlop={8} style={{ alignSelf: 'flex-end' }}>
              <Typo variant="label" color={colors.textLink}>Forgot password?</Typo>
            </Pressable>
          </View>

          {failure && (
            <Typo variant="bodySm" color={colors.statusErrorText} accessibilityLiveRegion="assertive">
              {failure}
            </Typo>
          )}

          <View style={{ gap: 10 }}>
            <Button size="lg" onPress={() => void submit()} disabled={busy || status === 'unconfigured'}>
              {busy ? 'Signing In…' : 'Sign In'}
            </Button>
            <Button size="lg" variant="secondary" onPress={() => router.push('/register')} disabled={busy}>
              Create Account
            </Button>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="shield-check" size={15} color={colors.wwTeal} />
            <Typo variant="caption">Secure access to your wearable data.</Typo>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
            {([['Terms', '/legal/terms'], ['Privacy', '/legal/privacy'], ['Health & safety', '/legal/health-safety']] as const).map(([label, href]) => (
              <Pressable key={label} onPress={() => router.push(href)} accessibilityRole="link" hitSlop={8}>
                <Typo variant="caption" color={colors.textLink}>{label}</Typo>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
