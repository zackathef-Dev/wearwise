import React from 'react';
import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ACCEPTANCE_VERSION } from '@wearwise/legal';
import { isAuthFailure } from '@/domain/errors/auth-errors';
import { accountNeeds, useAuth } from '@/features/authentication/auth-store';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { CheckRow } from '@/shared/components/CheckRow';
import { LegalLinks } from '@/features/legal/LegalLinks';

/* BEFORE YOU CONTINUE — what a signed-in account must answer before using the app:
 *   - that the person is 18 or older (accounts made before that rule), and/or
 *   - the current terms, privacy policy, collection notice and research information
 *     (new, or changed since the account last accepted them).
 * Only the questions this account still needs are shown. "I'm under 18" explains and
 * signs out; the study team can delete the account and its readings on request.
 */
export default function ConfirmAccount() {
  const router = useRouter();
  const { colors } = useTheme();
  const participant = useAuth((s) => s.participant);
  const confirmAccount = useAuth((s) => s.confirmAccount);
  const signOut = useAuth((s) => s.signOut);
  const needs = accountNeeds(participant);
  const updated = !!participant?.termsVersion; // accepted an earlier version before
  const [adult, setAdult] = React.useState(false);
  const [terms, setTerms] = React.useState(false);
  const [under18, setUnder18] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const ready = (!needs.adult || adult) && (!needs.terms || terms);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await confirmAccount({ adult: needs.adult, termsVersion: needs.terms ? ACCEPTANCE_VERSION : null });
      router.replace('/home');
    } catch (e) {
      setProblem(isAuthFailure(e) && e.code === 'network'
        ? 'Check your connection and try again.'
        : 'That didn’t go through. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    await signOut().catch(() => undefined);
    router.replace('/sign-in');
  };

  if (under18) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
          <Typo variant="h2" accessibilityRole="header">WearWise is for adults</Typo>
          <Typo variant="body">
            WearWise is a research study for people 18 or older, so this account can’t be used. If you’d like your
            account and readings deleted, ask the study team and they will remove them.
          </Typo>
          <Button size="lg" onPress={() => void leave()}>Sign out</Button>
          <Button size="lg" variant="ghost" onPress={() => setUnder18(false)}>Back</Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
        <Typo variant="h2" accessibilityRole="header">Before you continue</Typo>
        <Typo variant="body">
          {needs.terms && updated
            ? 'We’ve updated our terms and privacy information. Please read them and agree to keep using WearWise.'
            : 'Please confirm the following to keep using your account. You only need to do this once.'}
        </Typo>

        {needs.adult && (
          <CheckRow checked={adult} onToggle={() => setAdult((v) => !v)}
            title="I’m 18 or older" detail="WearWise is a research study for adults." />
        )}
        {needs.terms && (
          <View style={{ gap: 8 }}>
            <CheckRow checked={terms} onToggle={() => setTerms((v) => !v)}
              title="I agree to the Terms of Use and Privacy Policy"
              detail="And I’ve read the Collection Notice and the research participation information." />
            <LegalLinks />
          </View>
        )}

        {problem && <Typo variant="bodySm" color={colors.statusErrorText} accessibilityLiveRegion="assertive">{problem}</Typo>}
        <Button size="lg" onPress={() => void submit()} disabled={!ready || busy}>{busy ? 'Saving…' : 'Continue'}</Button>
        {needs.adult && <Button size="lg" variant="ghost" onPress={() => setUnder18(true)} disabled={busy}>I’m under 18</Button>}
        <Button size="lg" variant="ghost" onPress={() => void leave()} disabled={busy}>Sign out</Button>
      </ScrollView>
    </SafeAreaView>
  );
}
