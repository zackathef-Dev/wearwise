import { useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { Alert, Button } from '../components/ui';
import { api } from '../data/client';
import { checkShareCode, formatShareCodeInput } from '../data/share-code';
import type { RedeemResult } from '../data/types';

export type Added = Extract<RedeemResult, { ok: true }>;

const FAILURE: Record<'invalid_or_expired' | 'rate_limited', { title: string; body: string }> = {
  invalid_or_expired: {
    title: 'That code didn’t work',
    body: 'It may have been mistyped, already used, or expired (codes last 24 hours). Check it with the participant, or ask them to create a new one in the WearWise app.',
  },
  rate_limited: {
    title: 'Code entry is paused',
    body: 'Too many codes didn’t work in the last hour, so the server is refusing more attempts for now. This protects participants from guessed codes. Try again later.',
  },
};

export function AddParticipantDialog({ open, onClose, onAdded }: {
  open: boolean; onClose: () => void; onAdded: (result: Added) => void;
}) {
  const [code, setCode] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setCode(''); setHint(null); setFailure(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const check = checkShareCode(code);
    if (!check.ok) {
      /* Caught here so an impossible code never counts against the rate limit. */
      setHint(
        check.reason === 'empty' ? 'Enter the share code.'
          : check.reason === 'characters'
            ? `Share codes never contain ${check.invalid.join(', ')}. One of the characters has been misread; check the code with the participant.`
            : 'A share code has 10 letters and numbers, like ABCDE-FGHJK.',
      );
      return;
    }
    if (!api) return;
    setHint(null);
    setBusy(true);
    try {
      const result = await api.redeemShareCode(check.code);
      if (result.ok) {
        setCode('');
        onAdded(result);
      } else {
        setFailure(FAILURE[result.reason]);
      }
    } catch (err) {
      setFailure({ title: 'The code couldn’t be checked', body: err instanceof Error ? err.message : 'Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} labelledBy="add-title">
      <form className="dialog-body" onSubmit={submit} noValidate>
        <h2 id="add-title">Add a participant</h2>
        <p className="muted">
          Enter the share code the participant created in the WearWise app. A code works once and expires after
          24 hours; it decides which signals you can see, and whether falls are included.
        </p>
        <div className="field">
          <label htmlFor="share-code">Share code</label>
          <input
            id="share-code" className="input code" value={code} placeholder="ABCDE-FGHJK"
            autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" maxLength={14}
            onChange={(e) => { setCode(formatShareCodeInput(e.target.value)); setHint(null); setFailure(null); }}
            aria-invalid={!!(hint || failure) || undefined} aria-describedby="share-code-hint"
            autoFocus
          />
          <span id="share-code-hint" className="hint" role={hint ? 'alert' : undefined}>
            {hint ?? 'Letters and numbers only; dashes and spaces are optional.'}
          </span>
        </div>
        {failure && <Alert kind={failure === FAILURE.rate_limited ? 'warning' : 'error'} title={failure.title}>{failure.body}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Add participant</Button>
        </div>
      </form>
    </Dialog>
  );
}
