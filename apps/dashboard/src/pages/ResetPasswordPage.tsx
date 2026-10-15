import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { checkNewPassword, parseRecoveryLink } from '../auth/password';
import { Logo } from '../components/AppShell';
import { PasswordInput } from '../components/PasswordInput';
import { PasswordStrength } from '../components/PasswordStrength';
import { Alert, Button, LoadingState } from '../components/ui';

/* Where the emailed reset link lands. The link carries a short-lived session; it
   is read once, then wiped from the address bar so it isn't left in history. */
export function ResetPasswordPage() {
  const { state, notice, openRecoveryLink, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [linkError, setLinkError] = useState<string | null>(null);
  const [opening, setOpening] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return; // React dev mode runs effects twice; the link is single-use
    read.current = true;
    const link = parseRecoveryLink(window.location.hash, window.location.search);
    window.history.replaceState(null, '', window.location.pathname);
    if (link.kind === 'error') { setLinkError(link.message); setOpening(false); return; }
    if (link.kind === 'none') { setOpening(false); return; }
    /* Someone else is signed in here: never swap their session for the link's. */
    if (link.kind === 'tokens' && state.status === 'viewer' && link.subject !== state.profile.id) {
      setLinkError('This reset link is for a different account than the one signed in here. Sign out, then open the link again.');
      setOpening(false);
      return;
    }
    void openRecoveryLink(link).then((message) => { setLinkError(message); setOpening(false); });
  }, [openRecoveryLink, state]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = checkNewPassword(password, confirm);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    const message = await updatePassword(password);
    setBusy(false);
    if (message) { setError(message); return; }
    setPassword(''); setConfirm('');
    setDone(true);
  };

  const signedIn = state.status === 'viewer';
  const body = (() => {
    if (opening || (state.status === 'loading' && !linkError)) return <LoadingState label="Opening your reset link…" />;
    if (done) {
      return (
        <>
          <Alert kind="success" title="Password changed">Use your new password next time you sign in.</Alert>
          <Button variant="primary" onClick={() => navigate('/', { replace: true })}>Continue to the dashboard</Button>
        </>
      );
    }
    if (linkError || !signedIn) {
      return (
        <>
          {notice
            ? <Alert kind="warning" title="You can’t use this dashboard">{notice}</Alert>
            : <Alert kind="error">{linkError ?? 'Open this page from the reset link in your email.'}</Alert>}
          <Link to="/sign-in" className="btn btn-secondary">Back to sign in</Link>
        </>
      );
    }
    return (
      <>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <PasswordInput id="new-password" autoComplete="new-password" value={password} autoFocus
              onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error || undefined} aria-describedby="pw-hint" />
            <PasswordStrength id="pw-hint" password={password} />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <PasswordInput id="confirm-password" autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!error || undefined} />
          </div>
          <Button type="submit" variant="primary" busy={busy}>{busy ? 'Saving…' : 'Set new password'}</Button>
        </form>
      </>
    );
  })();

  return (
    <div className="signin">
      <div className="card signin-card">
        <Logo className="logo" />
        <div className="stack" style={{ gap: 6 }}>
          <h1>Set a new password</h1>
          {signedIn && !done && <p className="muted">For {state.email}.</p>}
        </div>
        {body}
      </div>
    </div>
  );
}
