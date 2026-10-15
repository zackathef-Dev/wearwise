import React from 'react';
import { View, ScrollView, Pressable, Switch as RNSwitch, Linking } from 'react-native';
import { Redirect, useRouter, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontFamilies } from '@wearwise/design-tokens';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { useAuth } from '@/features/authentication/auth-store';
import { useSync } from '@/features/sync/sync-store';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { ageFrom, bmi } from '@/domain/vitals/health-profile';
import { useAvatar } from '@/features/profile/avatar';
import { PhoneNotificationsSetting } from '@/features/notifications/PhoneNotificationsSetting';
import { sharing } from '@/data/remote/sharing';
import { ORG } from '@wearwise/legal';
import { Avatar } from '@/shared/components/Avatar';
import { FormField } from '@/shared/components/FormField';
import { Typo } from '@/shared/components/Typography';
import { Card } from '@/shared/components/Card';
import { Button } from '@/shared/components/Button';
import { Icon, type IconName } from '@/shared/icons/Icon';
import { Micro, Alert, IconButton } from '@/shared/components/kit';

/* PROFILE — account, appearance, consent and the plain-language data controls, in
 * the web mockup's layout: avatar header, grouped rows with leading icons and a
 * trailing chevron, an appearance switch, and the account actions. Server-controlled
 * facts (role/status) are never written here — RLS pins them regardless.
 */

/* Data export and account deletion go to the privacy contact by email (no in-app
   flow yet; the Privacy Policy explains both). Until the organisation's privacy email
   is set (packages/legal/src/org.ts), the policy itself is shown instead. */
function askPrivacy(subject: string, router: ReturnType<typeof useRouter>): void {
  if (!ORG.privacyEmail) { router.push('/legal/privacy'); return; }
  Linking.openURL(`mailto:${ORG.privacyEmail}?subject=${encodeURIComponent(subject)}`).catch(() => router.push('/legal/privacy'));
}

function Row({ icon, title, value, onPress, danger, last }: {
  icon: IconName | string; title: string; value?: string; onPress?: () => void; danger?: boolean; last?: boolean;
}) {
  const { colors } = useTheme();
  const fg = danger ? colors.statusErrorText : colors.textBody;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.borderDefault }}>
      <Icon name={icon} size={18} color={danger ? colors.statusErrorText : colors.textSecondary} />
      <Typo variant="body" color={fg} style={{ flex: 1 }}>{title}</Typo>
      {value ? <Typo variant="bodySm" color={colors.textMuted}>{value}</Typo> : null}
      {onPress ? <Icon name="chevron-right" size={16} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

export default function Profile() {
  const router = useRouter();
  const { colors, dark, followsSystem, setDark, useSystem } = useTheme();
  const { status, participant, signOut, updateDisplayName } = useAuth();
  const { pending, syncNow } = useSync();
  const [signingOut, setSigningOut] = React.useState(false);
  const [confirmSignOut, setConfirmSignOut] = React.useState(false);
  const health = useMonitoring((s) => s.healthProfile);
  const avatarUri = useAvatar((s) => s.uri);
  const loadAvatar = useAvatar((s) => s.load);
  const pickAvatar = useAvatar((s) => s.pick);
  const removeAvatar = useAvatar((s) => s.remove);
  /* Edit panel: name + picture */
  const [editing, setEditing] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const participantId = participant?.id;
  React.useEffect(() => { if (participantId) loadAvatar(participantId); }, [participantId, loadAvatar]);
  /* How many people can see this participant's data, re-checked whenever the tab
     comes back into view (e.g. after Privacy & access). Offline → no value at all,
     rather than a stale or guessed count. */
  const [sharedWith, setSharedWith] = React.useState<number | null>(null);
  useFocusEffect(React.useCallback(() => {
    if (!participantId) return;
    let current = true;
    sharing.listAccessGrants().then(
      (g) => { if (current) setSharedWith(g.length); },
      () => { if (current) setSharedWith(null); },
    );
    return () => { current = false; };
  }, [participantId]));

  if (status === 'signed-out' || status === 'unconfigured') return <Redirect href="/sign-in" />;

  const startEdit = () => { setNameDraft(participant?.displayName ?? ''); setEditError(null); setEditing(true); };
  const trimmed = nameDraft.trim();
  const nameError = !trimmed ? 'Enter your name.' : trimmed.length > 80 ? 'Use at most 80 characters.' : null;
  const saveName = async () => {
    if (nameError || !participant) return;
    if (trimmed === participant.displayName) { setEditing(false); return; }
    setSaving(true); setEditError(null);
    try { await updateDisplayName(trimmed); setEditing(false); }
    catch { setEditError('Your name could not be saved. Check your connection and try again.'); }
    finally { setSaving(false); }
  };
  const changePhoto = async () => {
    if (!participantId) return;
    setEditError(null);
    try { await pickAvatar(participantId); }
    catch { setEditError('That picture could not be used. Try another one.'); }
  };
  const consentDate = participant?.consentRecordedAt
    ? new Date(participant.consentRecordedAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfacePage }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 18,
          borderBottomWidth: 1, borderBottomColor: colors.borderDefault }}>
          <Pressable onPress={() => void changePhoto()} accessibilityRole="button" accessibilityLabel="Change profile picture">
            <Avatar uri={avatarUri} name={participant?.displayName ?? ''} size={52} />
          </Pressable>
          <View style={{ flex: 1, gap: 3 }}>
            <Typo variant="label" color={colors.textHeading} style={{ fontFamily: fontFamilies.semiBold, fontSize: 17 }} accessibilityRole="header">{participant?.displayName || 'You'}</Typo>
            <Typo variant="caption" color={colors.textSecondary}>{participant?.email}</Typo>
          </View>
          <IconButton icon={editing ? 'x' : 'pencil'} label={editing ? 'Close editing' : 'Edit name and picture'} onPress={editing ? () => setEditing(false) : startEdit} />
        </View>

        {editing && (
          <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
            <Card style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Avatar uri={avatarUri} name={trimmed || participant?.displayName || ''} size={64} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Button size="md" variant="secondary" onPress={() => void changePhoto()}>{avatarUri ? 'Change picture' : 'Add picture'}</Button>
                  {avatarUri && participantId && <Button size="md" variant="ghost" onPress={() => removeAvatar(participantId)}>Remove picture</Button>}
                </View>
              </View>
              <FormField label="Name" value={nameDraft} onChangeText={setNameDraft} maxLength={80} autoCapitalize="words"
                autoComplete="name" returnKeyType="done" onSubmitEditing={() => void saveName()} error={nameDraft ? (nameError ?? undefined) : undefined} />
              {editError && <Typo variant="bodySm" color={colors.statusErrorText}>{editError}</Typo>}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button variant="secondary" style={{ flex: 1 }} onPress={() => setEditing(false)}>Cancel</Button>
                <Button style={{ flex: 1 }} disabled={!!nameError || saving} onPress={() => void saveName()}>{saving ? 'Saving…' : 'Save'}</Button>
              </View>
              <Typo variant="caption" color={colors.textMuted}>Your picture stays on this phone. Your name is saved to your account.</Typo>
            </Card>
          </View>
        )}

        <View style={{ padding: 20, gap: 18 }}>
          {/* health information */}
          <Micro>Health information</Micro>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {(() => {
              const age = ageFrom(health?.dateOfBirth ?? null);
              const b = health ? bmi(health) : null;
              const sexLabel = { female: 'Female', male: 'Male', intersex: 'Intersex', unspecified: 'Prefer not to say' };
              const rows: [string, string, string][] = [
                ['user', 'Sex', health?.sex ? sexLabel[health.sex] : 'Not set'],
                ['history', 'Age', age != null ? `${age}` : 'Not set'],
                ['sliders-horizontal', 'Height', health?.heightCm ? `${health.heightCm} cm` : 'Not set'],
                ['activity', 'Weight', health?.weightKg ? `${health.weightKg} kg${b ? ` · BMI ${b.toFixed(1)}` : ''}` : 'Not set'],
                ['droplet', 'Blood group', health?.bloodGroup ?? 'Not set'],
              ];
              return rows.map(([icon, title, value]) => <Row key={title} icon={icon} title={title} value={value} />);
            })()}
            <Row icon="pencil" title={health ? 'Edit health information' : 'Add health information'} onPress={() => router.push('/health')} last />
          </Card>

          {/* account */}
          <Micro>Account</Micro>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Row icon="shield-check" title="Privacy & access" onPress={() => router.push('/privacy')}
              value={sharedWith == null ? undefined : sharedWith === 0 ? 'Not shared' : sharedWith === 1 ? '1 person' : `${sharedWith} people`} />
            <Row icon="cloud" title="Cloud & sync" value={pending > 0 ? `${pending} pending` : 'Up to date'} onPress={() => participant && void syncNow(participant.id)} />
            <Row icon="key-round" title="Change password" onPress={() => router.push('/reset-password')} />
            <Row icon="book-open" title="Legal & privacy" onPress={() => router.push('/legal')} last />
          </Card>

          {/* enrolment */}
          <Card style={{ flexDirection: 'row', gap: 12, backgroundColor: colors.surfaceInfo, borderColor: colors.borderInfoBlue }}>
            <Icon name="flask-conical" size={18} color={colors.wwTeal700} />
            <View style={{ flex: 1, gap: 3 }}>
              <Typo variant="label" style={{ fontSize: 13.5 }}>Storage consent on record</Typo>
              <Typo variant="caption" color={colors.textSecondary}>
                {consentDate ? `You consented to storage on ${consentDate}.` : 'Your consent is on record.'} Recordings are encrypted on this phone. Cloud sync sends recordings to the project backend. Signing out keeps saved recordings for your next sign-in.
              </Typo>
            </View>
          </Card>

          {/* notifications */}
          <Micro>Notifications</Micro>
          <PhoneNotificationsSetting />

          {/* appearance */}
          <Micro>Appearance</Micro>
          <Card style={{ padding: 16, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Typo variant="label">Dark appearance</Typo>
                <Typo variant="caption" color={colors.textMuted}>The night canvas. A white screen at 3am is a flashbulb.</Typo>
              </View>
              <RNSwitch value={dark} onValueChange={setDark}
                trackColor={{ true: colors.actionPrimary, false: colors.surfaceTrack }} thumbColor={colors.controlKnob} />
            </View>
            <View style={{ height: 1, backgroundColor: colors.borderDefault }} />
            <Pressable onPress={useSystem} accessibilityRole="button" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
              <Icon name="contrast" size={16} color={followsSystem ? colors.actionPrimary : colors.textMuted} />
              <Typo variant="bodySm" color={followsSystem ? colors.actionPrimary : colors.textSecondary} style={{ flex: 1 }}>
                {followsSystem ? 'Following your system setting' : 'Match my system setting'}
              </Typo>
            </Pressable>
          </Card>

          {/* data */}
          <Micro>Data</Micro>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Row icon="download" title="Export all my data" onPress={() => askPrivacy('Data export request', router)} />
            <Row icon="log-out" title={signingOut ? 'Signing out…' : 'Sign out'}
              /* signOut() flips auth status → the <Redirect> at the top unmounts this
                 screen and routes to /sign-in. Only reset on failure (still mounted). */
              onPress={() => setConfirmSignOut(true)} />
            <Row icon="trash-2" title="Request account deletion" danger last
              onPress={() => askPrivacy('Account deletion request', router)} />
          </Card>

          {confirmSignOut && (
            <Card style={{ gap: 10 }}>
              <Typo variant="label">Sign out of WearWise?</Typo>
              <Typo variant="caption">Your saved recordings stay on this phone for your next sign-in.</Typo>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button variant="secondary" onPress={() => setConfirmSignOut(false)} style={{ flex: 1 }}>Stay signed in</Button>
                <Button disabled={signingOut} style={{ flex: 1 }}
                  onPress={() => { setSigningOut(true); void signOut().catch(() => setSigningOut(false)); }}>
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </Button>
              </View>
            </Card>
          )}

          <Alert kind="info" title="Not a medical device">
            Simulated readings are always labelled as such. WearWise reports measurements and does not diagnose or give medical advice.
          </Alert>

          <Micro color={colors.textMuted}>WearWise · version {version}</Micro>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
