import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert, Button, EmptyState, ErrorState, LoadingState, SignalBadges } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { api } from '../data/client';
import { formatDate, formatDateTime } from '../data/format';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { AddParticipantDialog, type Added } from './AddParticipantDialog';
import { RemoveParticipantDialog } from './RemoveParticipantDialog';

/* Their display name; without one, a short code from their account id (stable, and the
   same one the whole study team sees). Participants' emails aren't shared with viewers. */
export const participantLabel = (p: { name: string; participantId: string }): string =>
  p.name || `Participant ${p.participantId.slice(0, 6).toUpperCase()}`;

export function ParticipantsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const list = useAsync(() => api!.listSharedParticipants(), []);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ grantId: string; name: string } | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);

  /* A message handed over by navigation (e.g. "removed") shows once; clear it from
     history so Back doesn't replay it. */
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const onAdded = (r: Added) => {
    const existed = list.data?.some((p) => p.grantId === r.grantId);
    const who = r.participantName || 'The participant';
    setAdding(false);
    setFlash(existed
      ? `Sharing with ${who} was updated: what you can see now matches their new code.`
      : `${who} is now sharing data with you.`);
    list.reload();
  };

  const onRemoved = (name: string, ended: boolean) => {
    setRemoving(null);
    setFlash(ended ? `${name} was removed from your list.` : `${name} had already stopped sharing with you.`);
    list.reload();
  };

  const rows = list.data ?? [];

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <h1>Participants</h1>
          <p className="muted">People who have shared WearWise data with you. Only what each chose to share is shown.</p>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add participant</Button>
        </div>
      </div>

      {flash && <div style={{ marginBottom: 16 }}><Alert kind="success" onDismiss={() => setFlash(null)}>{flash}</Alert></div>}

      <div className="card flush">
        {list.status === 'error' && !list.data ? (
          <ErrorState title="The participant list couldn’t be loaded" message={list.error!} onRetry={list.reload} />
        ) : list.status === 'loading' && !list.data ? (
          <LoadingState label="Loading participants…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="users" title="No one is sharing with you yet"
            action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add participant</Button>}
          >
            A participant shares by creating a one-time code in the WearWise app and giving it to you. Enter the code
            here to see the signals they chose. Codes work once and expire after 24 hours.
          </EmptyState>
        ) : (
          <div className="table-wrap" style={{ opacity: list.status === 'loading' ? 0.6 : 1 }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Participant</th>
                  <th scope="col">Shared with you</th>
                  <th scope="col" className="hide-md">Shared since</th>
                  <th scope="col" className="num">Sessions</th>
                  <th scope="col">Last session</th>
                  <th scope="col" className="row-actions"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.grantId} className="link-row" onClick={() => navigate(`/participants/${p.participantId}`)}>
                    <td>
                      <div className="primary-cell">
                        <Link to={`/participants/${p.participantId}`} onClick={(e) => e.stopPropagation()}>{participantLabel(p)}</Link>
                      </div>
                    </td>
                    <td><SignalBadges types={p.sensorTypes} falls={p.includeFalls} /></td>
                    <td className="hide-md">{formatDate(p.sharedSince)}</td>
                    <td className="num">{p.sessionCount}</td>
                    <td>{p.lastSessionAt ? formatDateTime(p.lastSessionAt) : <span className="muted">None yet</span>}</td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <Menu
                        label={`Actions for ${participantLabel(p)}`} trigger={<Icon name="ellipsis" size={18} />}
                        items={[
                          { label: 'Open', icon: 'chevron-right', onSelect: () => navigate(`/participants/${p.participantId}`) },
                          {
                            label: 'Remove participant', icon: 'user-minus', danger: true, separated: true,
                            onSelect: () => setRemoving({ grantId: p.grantId, name: participantLabel(p) }),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.status === 'error' && list.data && (
        <div style={{ marginTop: 12 }}><Alert kind="error">{list.error}</Alert></div>
      )}

      <AddParticipantDialog open={adding} onClose={() => setAdding(false)} onAdded={onAdded} />
      <RemoveParticipantDialog target={removing} onClose={() => setRemoving(null)} onRemoved={onRemoved} />
    </>
  );
}
