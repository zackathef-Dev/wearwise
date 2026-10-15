import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { checkNewPassword } from '../auth/password';
import { useViewer } from '../auth/AuthProvider';
import { Dialog } from './Dialog';
import { PasswordInput } from './PasswordInput';
import { PasswordStrength } from './PasswordStrength';
import { Alert, Button } from './ui';

/* Change password while signed in — the way to replace the one-time password an
   administrator hands out, with no email involved. The current password is checked
   first, so someone at an unlocked browser can't lock the owner out of their account. */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { email, profile } = useViewer();
  const { updatePassword, verifyPassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const close = () => {
    if (busy) return;
    setCurrent(''); setPassword(''); setConfirm(''); setError(null); setDone(false);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) { setError('Enter your current password.'); return; }
    const problem = checkNewPassword(password, confirm);
    if (problem) { setError(problem); return; }
    if (password === current) { setError('Choose a password that’s different from your current one.'); return; }
    setBusy(true);
    setError(null);
    const wrong = await verifyPassword(current);
    if (wrong) { setBusy(false); setError(wrong); return; }
    const message = await updatePassword(password);
    setBusy(false);
    if (message) { setError(message); return; }
    setCurrent(''); setPassword(''); setConfirm('');
    setDone(true);
  };

  return (
    <Dialog open={open} onClose={close} labelledBy="change-pw-title">
      <div className="dialog-body">
        <h2 id="change-pw-title">Change password</h2>
        {done ? (
          <>
            <Alert kind="success" title="Password changed">Use your new password next time you sign in.</Alert>
            <div className="dialog-actions"><Button variant="primary" onClick={close}>Done</Button></div>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="dialog-body">
            {error && <Alert kind="error">{error}</Alert>}
            <div className="field">
              <label htmlFor="cp-current">Current password</label>
              <PasswordInput id="cp-current" autoComplete="current-password" value={current} autoFocus
                onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!error || undefined} />
            </div>
            <div className="field">
              <label htmlFor="cp-new">New password</label>
              <PasswordInput id="cp-new" autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error || undefined} aria-describedby="cp-hint" />
              <PasswordStrength id="cp-hint" password={password} context={[email, profile.displayName]} />
            </div>
            <div className="field">
              <label htmlFor="cp-confirm">Confirm new password</label>
              <PasswordInput id="cp-confirm" autoComplete="new-password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!error || undefined} />
            </div>
            <div className="dialog-actions">
              <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
              <Button type="submit" variant="primary" busy={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
