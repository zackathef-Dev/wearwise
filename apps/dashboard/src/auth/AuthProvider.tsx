import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, supabase } from '../data/client';
import { ACCOUNT_ROLES, isStaff, type ViewerProfile } from '../data/types';
import { ACCEPTANCE_VERSION } from '@wearwise/legal';
import { RESET_PATH, resetRequestMessage, updatePasswordMessage, type RecoveryLink } from './password';

/* Who is signed in, and what they may do here.
 *
 * Any WearWise account may sign in with the same email and password as the app.
 * After every sign-in (and on every page load with a stored session) the caller's
 * own `profiles` row is read: the account must be active, and its role decides the
 * pages: everyone sees their own data, researchers and clinicians ("staff") also
 * see what participants share with them. A suspended account is signed straight
 * back out with an explanation. The server enforces every rule on every read
 * regardless (RLS, private.my_live_grants), so this gate is about telling people
 * clearly, not about security.
 */

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  /** needs: what the account must answer before anything else (AccountChecksPage):
      that it is 18 or older (accounts made before that rule) and/or the current terms. */
  | { status: 'viewer'; email: string; profile: ViewerProfile; staff: boolean; needs: AccountNeeds };

export interface AccountNeeds { adult: boolean; terms: boolean }

interface AuthContextValue {
  state: AuthState;
  /** shown on the sign-in page after a refused or expired sign-in */
  notice: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Emails a reset link back to this dashboard. Resolves to an error message or null. */
  requestPasswordReset: (email: string) => Promise<string | null>;
  /** Turns the reset link's tokens into a session. Resolves to an error message or null. */
  openRecoveryLink: (link: Extract<RecoveryLink, { kind: 'tokens' | 'code' }>) => Promise<string | null>;
  /** Sets a new password for whoever is signed in (reset session or a viewer). */
  updatePassword: (password: string) => Promise<string | null>;
  /** Checks the signed-in account's current password. Error message, or null if right. */
  verifyPassword: (password: string) => Promise<string | null>;
  /** Answers what the account still needs (18+, current terms). Error message or null. */
  confirmAccount: (needs: AccountNeeds) => Promise<string | null>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const NOT_A_VIEWER =
  'This account can’t be used with the dashboard. If you think it should, contact a WearWise administrator.';
const NOT_ACTIVE = 'Your account is not active at the moment. Contact a WearWise administrator.';

const isAccount = (p: ViewerProfile) => (ACCOUNT_ROLES as readonly string[]).includes(p.role);

function signInMessage(error: { message?: string; status?: number; code?: string }): string {
  if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message ?? '')) {
    return 'That email and password don’t match an account. Check them and try again.';
  }
  if (error.code === 'email_not_confirmed') return 'This account’s email address hasn’t been confirmed yet.';
  if (error.status === 429) return 'Too many sign-in attempts. Wait a few minutes and try again.';
  if (error.status === 0 || /fetch|network/i.test(error.message ?? '')) {
    return 'Couldn’t reach the server. Check your connection and try again.';
  }
  return 'Sign-in failed. Please try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session); });
    /* Only record the session here: supabase-js warns against awaiting other
       supabase calls inside this callback. The profile check runs in the effect below. */
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const userId = session?.user.id ?? null;
  const email = session?.user.email ?? '';
  /* Declared at sign-up (app) or on AccountChecksPage. The server's record decides
     (profiles.adult_confirmed_at / terms_version, which the client can't write); the
     account metadata only stands in on a server without those columns yet. */
  const meta = session?.user.user_metadata ?? {};
  const needsFor = (p: ViewerProfile): AccountNeeds => ({
    adult: p.adultConfirmedAt !== undefined ? !p.adultConfirmedAt : !meta.adult_confirmed_at,
    terms: String((p.termsVersion !== undefined ? p.termsVersion : meta.terms_version) ?? '') < ACCEPTANCE_VERSION,
  });

  useEffect(() => {
    if (session === undefined || !supabase || !api) return;
    if (!userId) { setState({ status: 'signed-out' }); return; }
    let alive = true;
    setState({ status: 'loading' });
    api.getProfile(userId).then(async (profile) => {
      if (!alive) return;
      if (!profile || !isAccount(profile) || profile.status !== 'active') {
        setNotice(profile && isAccount(profile) ? NOT_ACTIVE : NOT_A_VIEWER);
        await supabase!.auth.signOut().catch(() => undefined);
        if (alive) setState({ status: 'signed-out' });
        return;
      }
      setState({ status: 'viewer', email, profile, staff: isStaff(profile), needs: needsFor(profile) });
    }).catch((e: unknown) => {
      if (alive) setState({ status: 'error', message: e instanceof Error ? e.message : 'Your account could not be checked.' });
    });
    return () => { alive = false; };
    /* Not keyed on `session` itself: it changes on every token refresh, and the
       profile only needs re-checking when the user changes. */
  }, [userId, session === undefined, attempt]);

  const signIn = useCallback(async (address: string, password: string) => {
    if (!supabase) return 'The dashboard is not configured.';
    setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({ email: address.trim(), password });
    return error ? signInMessage(error) : null;
  }, []);

  const signOut = useCallback(async () => {
    setNotice(null);
    await supabase?.auth.signOut();
  }, []);

  const requestPasswordReset = useCallback(async (address: string) => {
    if (!supabase) return 'The dashboard is not configured.';
    const { error } = await supabase.auth.resetPasswordForEmail(address.trim(), {
      redirectTo: `${window.location.origin}${RESET_PATH}`,
    });
    /* An unknown address is reported as sent too: the form mustn't reveal who has an account. */
    if (error && error.code !== 'user_not_found') return resetRequestMessage(error);
    return null;
  }, []);

  const openRecoveryLink = useCallback(async (link: Extract<RecoveryLink, { kind: 'tokens' | 'code' }>) => {
    if (!supabase) return 'The dashboard is not configured.';
    setNotice(null);
    const { error } = link.kind === 'tokens'
      ? await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
      : await supabase.auth.exchangeCodeForSession(link.code);
    return error ? 'This reset link has expired or was already used. Ask for a new one.' : null;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) return 'The dashboard is not configured.';
    const { error } = await supabase.auth.updateUser({ password });
    return error ? updatePasswordMessage(error) : null;
  }, []);

  const confirmAccount = useCallback(async (answer: AccountNeeds) => {
    if (!supabase) return 'The dashboard is not configured.';
    const failed = 'That didn’t go through. Check your connection and try again.';
    /* The server's record first (profiles.adult_confirmed_at gates uploads; terms_version
       is the acceptance record), then the account metadata. A server without those
       migrations has no such function (PGRST202): the metadata alone carries it. */
    const meta: Record<string, string> = {};
    if (answer.adult) {
      const { data: at, error } = await supabase.rpc('confirm_adult');
      if (error && error.code !== 'PGRST202') return failed;
      meta.adult_confirmed_at = typeof at === 'string' ? at : new Date().toISOString();
    }
    if (answer.terms) {
      const { error } = await supabase.rpc('accept_terms', { p_version: ACCEPTANCE_VERSION });
      if (error && error.code !== 'PGRST202') return failed;
      meta.terms_version = ACCEPTANCE_VERSION;
      meta.terms_accepted_at = new Date().toISOString();
    }
    const { error } = await supabase.auth.updateUser({ data: meta });
    if (error) return failed;
    setState((s) => (s.status === 'viewer' ? { ...s, needs: { adult: false, terms: false } } : s));
    return null;
  }, []);

  const verifyPassword = useCallback(async (password: string) => {
    if (!supabase) return 'The dashboard is not configured.';
    const { data } = await supabase.auth.getSession();
    const address = data.session?.user.email;
    if (!address) return 'You’re not signed in.';
    const { error } = await supabase.auth.signInWithPassword({ email: address, password });
    if (!error) return null;
    return error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message ?? '')
      ? 'Your current password isn’t right.'
      : signInMessage(error);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => ({ state, notice, signIn, signOut, requestPasswordReset, openRecoveryLink, updatePassword, verifyPassword, confirmAccount, retry }),
    [state, notice, signIn, signOut, requestPasswordReset, openRecoveryLink, updatePassword, verifyPassword, confirmAccount, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** The signed-in account. Only call below the sign-in gate (RequireViewer). */
export function useViewer(): { email: string; profile: ViewerProfile; staff: boolean } {
  const { state } = useAuth();
  if (state.status !== 'viewer') throw new Error('useViewer outside the viewer gate');
  return state;
}
