import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { safeReturnPath } from '../auth/password';
import { Logo } from '../components/AppShell';
import { PasswordInput } from '../components/PasswordInput';
import { Alert, Button } from '../components/ui';
import { LegalFooter } from './LegalPages';

/* Email + password only, the same account as the WearWise app. Accounts are made in
   the app (participants) or by an administrator (researchers, clinicians), so there
   is deliberately no sign-up path here. "Forgot password?"
   swaps the card to a reset request; the emailed link lands on /reset-password. */
export function SignInPage() {
  const { state, notice, signIn, requestPasswordReset } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'sign-in' | 'forgot' | 'sent'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'viewer') {
    return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from)} replace />;
  }

  const switchTo = (next: typeof mode) => { setMode(next); setError(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    setError(null);
    const message = await signIn(email, password);
    setBusy(false);
    if (message) setError(message);
    else setPassword('');
  };

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter the email address you sign in with.'); return; }
    setBusy(true);
    setError(null);
    const message = await requestPasswordReset(email);
    setBusy(false);
    if (message) setError(message);
    else switchTo('sent');
  };

  const checking = busy || (state.status === 'loading' && !notice);

  return (
    <div className="signin">
      <div className="card signin-card">
        <Logo className="logo" />

        {mode === 'sign-in' && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1>Sign in to WearWise</h1>
              <p className="muted">Use the same email and password as the WearWise app.</p>
            </div>

            {notice && <Alert kind="warning" title="You can’t use this dashboard">{notice}</Alert>}
            {error && <Alert kind="error">{error}</Alert>}

            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" autoComplete="username" value={email}
                  onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error || undefined} required />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <PasswordInput id="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error || undefined} required />
                {/* Under the box, right-aligned with the Show/Hide toggle — as in the phone app. */}
                <button type="button" className="text-link field-link" onClick={() => switchTo('forgot')}>Forgot password?</button>
              </div>
              <Button type="submit" variant="primary" busy={checking}>{checking ? 'Signing in…' : 'Sign in'}</Button>
            </form>

            <p className="signin-foot">
              No account yet? Create one in the WearWise app (for people 18 or older). Researcher and clinician
              accounts are set up by a WearWise administrator.
            </p>
            <LegalFooter />
          </>
        )}

        {mode === 'forgot' && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1>Reset your password</h1>
              <p className="muted">Enter the email you sign in with. We’ll send a link to set a new password.</p>
            </div>
            {error && <Alert kind="error">{error}</Alert>}
            <form onSubmit={sendReset} noValidate>
              <div className="field">
                <label htmlFor="reset-email">Email</label>
                <input id="reset-email" className="input" type="email" autoComplete="username" value={email}
                  onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error || undefined} required autoFocus />
              </div>
              <Button type="submit" variant="primary" busy={busy}>{busy ? 'Sending…' : 'Send reset link'}</Button>
              <Button variant="ghost" onClick={() => switchTo('sign-in')}>Back to sign in</Button>
            </form>
          </>
        )}

        {mode === 'sent' && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <h1>Check your email</h1>
              <p className="muted">
                If <strong>{email.trim()}</strong> has a WearWise account, a reset link is on its way. It works once and
                expires after an hour. Check your spam folder if it doesn’t arrive in a few minutes.
              </p>
            </div>
            <Button variant="secondary" onClick={() => switchTo('sign-in')}>Back to sign in</Button>
          </>
        )}
      </div>
    </div>
  );
}
