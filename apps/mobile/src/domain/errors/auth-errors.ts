/* Auth failures the UI is allowed to know about.
 *
 * Everything a gateway throws is folded into one of these BEFORE it crosses into
 * the domain. Two rules drive the shape:
 *
 *  - Generic on purpose. `invalid-credentials` covers wrong password AND unknown
 *    email — the UI must not be able to tell the difference, so the type system
 *    doesn't offer one (build instruction §16: errors must not reveal whether an
 *    account exists).
 *  - No server internals. The `cause` is retained for local debugging but is never
 *    part of the user-facing message and must never be logged in release builds.
 */

export type AuthFailureCode =
  | 'invalid-credentials'     // wrong email or password — deliberately indistinguishable
  | 'email-not-confirmed'
  | 'weak-password'           // rejected by server-side strength policy
  | 'email-in-use'            // ONLY safe on the register path, where the email was just typed
  | 'rate-limited'
  | 'network'                 // offline, DNS, timeouts — retryable
  | 'backend-not-configured'  // no Supabase URL/key in the build — a setup state, not an error
  | 'unknown';

export class AuthFailure extends Error {
  readonly code: AuthFailureCode;

  constructor(code: AuthFailureCode, cause?: unknown) {
    super(`auth failure: ${code}`);
    this.name = 'AuthFailure';
    this.code = code;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export const isAuthFailure = (e: unknown): e is AuthFailure => e instanceof AuthFailure;
