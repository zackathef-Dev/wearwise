import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Alert, Button } from '../components/ui';
import { api } from '../data/client';
import { stopLiveFor } from '../live/live-stop';

/* "Remove participant", from their page or from a row of the list. Live view, if it is
 * on, is stopped first (the phone stops sending at once rather than at its next check
 * of who may watch), then the grant is revoked. */
export function RemoveParticipantDialog({ target, onClose, onRemoved }: {
  target: { grantId: string; name: string } | null;
  onClose: () => void;
  /** `ended` false: the grant had already ended (the participant may have removed you first) */
  onRemoved: (name: string, ended: boolean) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = target?.name ?? '';

  const close = () => { if (!removing) { setError(null); onClose(); } };

  const remove = async () => {
    if (!target) return;
    setRemoving(true);
    setError(null);
    try {
      await stopLiveFor(target.grantId);
      const ended = await api!.revokeAccessGrant(target.grantId);
      setRemoving(false);
      onRemoved(target.name, ended);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The participant could not be removed.');
      setRemoving(false);
    }
  };

  return (
    <Dialog open={target != null} onClose={close} labelledBy="remove-title">
      <div className="dialog-body">
        <h2 id="remove-title">Remove {name}?</h2>
        <p className="muted">
          You will lose access to their data straight away, and live view stops if it is on. To see it again, they
          would have to create a new share code for you in the WearWise app. Nothing is deleted from their account.
        </p>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={close} disabled={removing}>Cancel</Button>
          <Button variant="danger" icon="user-minus" busy={removing} onClick={() => void remove()}>Remove</Button>
        </div>
      </div>
    </Dialog>
  );
}
