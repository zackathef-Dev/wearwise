import React from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterForm } from '@/shared/validation/auth-schemas';
import { isAuthFailure } from '@/domain/errors/auth-errors';
import { useAuth } from '@/features/authentication/auth-store';
import { authFailureCopy } from '@/features/authentication/auth-copy';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { FormField } from '@/shared/components/FormField';
import { PasswordStrength } from '@/shared/components/PasswordStrength';
import { CheckRow } from '@/shared/components/CheckRow';
import { LegalLinks } from '@/features/legal/LegalLinks';
import { ACCEPTANCE_VERSION } from '@wearwise/legal';

/* Registration. The age, terms and consent rows are first-class form fields with their own
 * errors — not pre-ticked boxes, not buried in terms. WearWise accounts are for people
 * 18 or older (a research study for adults); the consent copy explains WHAT is stored
 * and WHO decides about sharing, matching the mockup's register screen. Both are
 * recorded server-side and a sign-up without either is refused there too.
 */
export default function Register() {
  const router = useRouter();
  const { colors } = useTheme();
  const { register: registerAccount, status } = useAuth();
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '', adult: false as never, terms: false as never, consent: false as never },
  });

  /* The name and email so far: a password built on them scores lower. */
  const [nameSoFar, emailSoFar] = useWatch({ control, name: ['displayName', 'email'] });

  const submit = handleSubmit(async ({ displayName, email, password }) => {
    setFailure(null);
    setBusy(true);
    try {
      const outcome = await registerAccount({
        displayName,
        email,
        password,
        consentRecordedAt: new Date().toISOString(),
        adultConfirmedAt: new Date().toISOString(),
        termsVersion: ACCEPTANCE_VERSION,
      });
      if (outcome === 'signed-in') router.replace('/home'); // a new account has just confirmed 18+
      else setSentTo(email);
    } catch (e) {
      setFailure(authFailureCopy[isAuthFailure(e) ? e.code : 'unknown']);
    } finally {
      setBusy(false);
    }
  });

  /* Confirmation-pending state replaces the form — there is nothing else useful
     to do on this screen until the link is followed. */
  if (sentTo) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
          <Typo variant="h2" accessibilityRole="header">Check your email</Typo>
          <Typo variant="body">
            We sent a confirmation link to {sentTo}. Open it on this phone to finish
            creating your account.
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
            <Typo variant="h2" accessibilityRole="header">Create account</Typo>
            <Typo variant="bodySm" color={colors.textSecondary}>
              Your account keeps your readings yours. Nothing is shared until you grant access.
            </Typo>
          </View>

          <View style={{ gap: 14 }}>
            <Controller
              control={control}
              name="displayName"
              render={({ field }) => (
                <FormField label="Full name" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur}
                  error={formState.errors.displayName?.message} autoComplete="name" textContentType="name" />
              )}
            />
            <Controller
              control={control}
              name="email"
              render={({ field }) => (
                <FormField label="Email" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur}
                  error={formState.errors.email?.message} autoCapitalize="none" autoComplete="email"
                  keyboardType="email-address" textContentType="emailAddress" />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <View style={{ gap: 8 }}>
                  <FormField label="Password" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur}
                    error={formState.errors.password?.message} secureTextEntry autoComplete="new-password"
                    textContentType="newPassword" placeholder="At least 10 characters" />
                  <PasswordStrength password={field.value} context={[nameSoFar, emailSoFar]} />
                </View>
              )}
            />

            <Controller
              control={control}
              name="adult"
              render={({ field }) => (
                <CheckRow
                  checked={!!field.value} onToggle={() => field.onChange(!field.value)}
                  title="I’m 18 or older"
                  detail="WearWise is a research study for adults."
                  error={formState.errors.adult?.message}
                />
              )}
            />

            <Controller
              control={control}
              name="terms"
              render={({ field }) => (
                <View style={{ gap: 8 }}>
                  <CheckRow
                    checked={!!field.value} onToggle={() => field.onChange(!field.value)}
                    title="I agree to the Terms of Use and Privacy Policy"
                    detail="And I’ve read the Collection Notice and the research participation information."
                    error={formState.errors.terms?.message}
                  />
                  <LegalLinks />
                </View>
              )}
            />

            <Controller
              control={control}
              name="consent"
              render={({ field }) => (
                <CheckRow
                  checked={!!field.value} onToggle={() => field.onChange(!field.value)}
                  title="I consent to WearWise storing my health readings"
                  detail="Readings are saved on this device and synced to your account, as the Collection Notice explains. You choose who else can see them."
                  error={formState.errors.consent?.message}
                />
              )}
            />
          </View>

          {failure && (
            <Typo variant="bodySm" color={colors.statusErrorText} accessibilityLiveRegion="assertive">{failure}</Typo>
          )}

          <Button size="lg" onPress={() => void submit()} disabled={busy || status === 'unconfigured'}>
            {busy ? 'Creating Account…' : 'Create Account'}
          </Button>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            <Typo variant="bodySm" color={colors.textSecondary}>Already have an account?</Typo>
            <Pressable onPress={() => router.replace('/sign-in')} accessibilityRole="link" hitSlop={8}>
              <Typo variant="label" color={colors.textLink}>Sign In</Typo>
            </Pressable>
          </View>

          <Pressable onPress={() => router.push('/legal/health-safety')} accessibilityRole="link" hitSlop={8}>
            <Typo variant="caption" style={{ textAlign: 'center' }}>
              WearWise reports measurements. It does not diagnose or give medical advice.{' '}
              <Typo variant="caption" color={colors.textLink}>Health & safety</Typo>
            </Typo>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
