import { MIN_PASSWORD, passwordStrength } from '@wearwise/password';

/* Password rules and the reset-link plumbing, kept free of React and Supabase so
   they can be tested on their own. The strength rules are shared with the phone app
   (packages/password). */

export { MIN_PASSWORD };

export const RESET_PATH = '/reset-password';

/** The new-password form's error, or null when it may be submitted. */
export function checkNewPassword(password: string, confirm: string): string | null {
  if (!password) return 'Enter a new password.';
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.trim() !== password) return 'The password can’t start or end with a space.';
  if (!passwordStrength(password).acceptable) return 'That is one of the first passwords attackers try. Choose something less predictable.';
  if (confirm !== password) return 'The two passwords don’t match.';
  return null;
}

export type RecoveryLink =
  /** subject: the account the link is for (the token's `sub`), to refuse swapping sessions */
  | { kind: 'tokens'; accessToken: string; refreshToken: string; subject: string | null }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

/* What the emailed reset link put in the address bar. Supabase sends the session
   in the #fragment (implicit flow) or a ?code= (PKCE); a dead link comes back
   with error/error_description instead. */
export function parseRecoveryLink(hash: string, search: string): RecoveryLink {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  const errorCode = h.get('error_code') ?? q.get('error_code');
  const error = h.get('error') ?? q.get('error');
  if (errorCode || error) {
    return {
      kind: 'error',
      message: errorCode === 'otp_expired'
        ? 'This reset link has expired or was already used. Ask for a new one.'
        : 'This reset link isn’t valid. Ask for a new one.',
    };
  }
  const accessToken = h.get('access_token');
  const refreshToken = h.get('refresh_token');
  /* A session in the URL is only taken from a password-reset link (older, implicit-flow
     emails); anything else would let a crafted link sign this browser into another account. */
  if (accessToken && refreshToken) {
    if (h.get('type') !== 'recovery') return { kind: 'error', message: 'This reset link isn’t valid. Ask for a new one.' };
    return { kind: 'tokens', accessToken, refreshToken, subject: tokenSubject(accessToken) };
  }
  const code = q.get('code');
  if (code) return { kind: 'code', code };
  return { kind: 'none' };
}

/** The `sub` (account id) inside an access token, unverified: only used to compare. */
export function tokenSubject(jwt: string): string | null {
  try {
    const part = jwt.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/** Where to go after signing in: only a path inside this app (no //host, no \\host). */
export function safeReturnPath(from: unknown): string {
  return typeof from === 'string' && /^\/(?![\/\\])/.test(from) && from !== '/sign-in' ? from : '/';
}

interface AuthErrorLike { message?: string; status?: number; code?: string }

const offline = (e: AuthErrorLike) => e.status === 0 || /fetch|network/i.test(e.message ?? '');

/* Requesting a reset never says whether the address has an account (so the form
   can't be used to find out who is a viewer); only failures that aren't about the
   address get their own message. */
export function resetRequestMessage(e: AuthErrorLike): string {
  if (e.status === 429 || e.code === 'over_email_send_rate_limit') {
    return 'Too many reset emails have been sent recently. Wait an hour and try again, or ask a WearWise administrator to reset your password.';
  }
  if (e.code === 'email_address_not_authorized') {
    return 'This server can’t send reset emails yet. Ask a WearWise administrator to reset your password.';
  }
  if (offline(e)) return 'Couldn’t reach the server. Check your connection and try again.';
  return 'The reset email couldn’t be sent. Try again, or ask a WearWise administrator.';
}

export function updatePasswordMessage(e: AuthErrorLike): string {
  if (e.code === 'same_password') return 'That’s your current password. Choose a different one.';
  if (e.code === 'weak_password') return `That password is too weak. Use at least ${MIN_PASSWORD} characters, mixing words, numbers or symbols.`;
  if (e.code === 'reauthentication_needed') return 'For security, sign out and use “Forgot password?” to set a new one.';
  if (e.status === 401 || e.code === 'session_not_found' || e.code === 'session_expired') {
    return 'Your reset session has ended. Ask for a new reset link.';
  }
  if (offline(e)) return 'Couldn’t reach the server. Check your connection and try again.';
  return 'The password couldn’t be changed. Please try again.';
}
