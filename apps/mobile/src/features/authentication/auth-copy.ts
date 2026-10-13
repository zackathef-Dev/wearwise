import type { AuthFailureCode } from '@/domain/errors/auth-errors';

/* User-facing copy for every auth failure the domain can produce.
 *
 * One table, so the wording is reviewed in one place and no screen invents its
 * own. Brand voice: plain, calm, says what to do next, no exclamation marks.
 * The invalid-credentials line is deliberately symmetric between "wrong password"
 * and "no such account".
 */
export const authFailureCopy: Record<AuthFailureCode, string> = {
  'invalid-credentials':
    'That email and password don’t match an account. Check both and try again.',
  'email-not-confirmed':
    'Confirm your email first — we sent you a link when you created the account.',
  'weak-password': 'Choose a longer password. Use at least 10 characters.',
  'email-in-use': 'There’s already an account for this email. Try signing in instead.',
  'rate-limited': 'Too many attempts for now. Wait a minute, then try again.',
  network: 'You’re offline, or the server can’t be reached. Check your connection and try again.',
  'backend-not-configured':
    'This build isn’t connected to a WearWise server yet. Add the Supabase URL and key to the app configuration, then rebuild.',
  unknown: 'Something went wrong on our side. Try again in a moment.',
};
