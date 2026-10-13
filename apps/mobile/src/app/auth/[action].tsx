import React from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/data/remote/supabase-client';
import { passwordSchema } from '@/shared/validation/auth-schemas';
import { Typo } from '@/shared/components/Typography';
import { Button } from '@/shared/components/Button';
import { PasswordStrength } from '@/shared/components/PasswordStrength';
import { homeRoute, useAuth } from '@/features/authentication/auth-store';
import { useTheme } from '@/shared/theme/ThemeProvider';

export default function AuthLink() {
  const { action, code, sb_flow_id } = useLocalSearchParams<{ action: string; code?: string; sb_flow_id?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [ready, setReady] = React.useState(false);
  const [message, setMessage] = React.useState('Checking your link…');
  const [password, setPassword] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const exchange = React.useRef<Promise<boolean> | null>(null);

  React.useEffect(() => {
    let active = true;
    exchange.current ??= (async () => {
      if (!supabase || !code || !/^[A-Za-z0-9_-]{1,256}$/.test(code) || !['reset', 'confirmed'].includes(action)) return false;
      try { const { error } = await supabase.auth.exchangeCodeForSession(code, sb_flow_id ? { flowId: sb_flow_id } : undefined); return !error; }
      catch { return false; }
    })();
    void exchange.current.then((ok) => {
      if (!active) return;
      setReady(ok);
      setMessage(ok ? (action === 'reset' ? 'Choose a new password.' : 'Email confirmed. You can continue.') : 'This link is expired or was opened on a different device. Request a new link in this app.');
    });
    return () => { active = false; };
  }, [action, code, sb_flow_id]);

  const save = async () => {
    if (!ready || !supabase || busy) return;
    const validation = passwordSchema.safeParse(password);
    if (!validation.success) { setMessage(validation.error.issues[0]!.message); return; }
    if (password !== confirmation) { setMessage('The passwords do not match.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setMessage('Password could not be changed. Try again or request a new link.'); return; }
      setPassword(''); setConfirmation('');
      router.replace(homeRoute(useAuth.getState().participant));
    } catch { setMessage('Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  const field = { borderWidth: 1, borderColor: colors.borderDefault, borderRadius: 12, padding: 14, color: colors.textBody };
  return (
    <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
      <View style={{ gap: 18 }}>
        <Typo variant="h2">{action === 'reset' ? 'Reset password' : 'Confirm email'}</Typo>
        <Typo variant="bodySm">{message}</Typo>
        {ready && action === 'reset' && <>
          <TextInput style={field} accessibilityLabel="New password" placeholder="New password" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} />
          <PasswordStrength password={password} context={[useAuth.getState().participant?.email ?? '', useAuth.getState().participant?.displayName ?? '']} />
          <TextInput style={field} accessibilityLabel="Confirm password" placeholder="Confirm password" placeholderTextColor={colors.textMuted} value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} />
          <Button disabled={busy} onPress={() => void save()}>{busy ? 'Saving…' : 'Save password'}</Button>
        </>}
        <Button variant="ghost" onPress={() => router.replace(ready ? homeRoute(useAuth.getState().participant) : '/sign-in')}>{ready ? 'Continue' : 'Back to sign in'}</Button>
      </View>
    </SafeAreaView>
  );
}
