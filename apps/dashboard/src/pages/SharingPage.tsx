import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Alert, Badge, Button, EmptyState, ErrorState, LoadingState, SignalBadges } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { api } from '../data/client';
import { formatDate } from '../data/format';
import type { MyGrant } from '../data/types';

const ROLE: Record<string, string> = { researcher: 'Researcher', clinician: 'Clinician' };

/* A participant's own view of who can see their data, with the same "stop sharing"
   the app's Privacy & access screen has. New share codes are made in the app. */
export function SharingPage() {
  const grants = useAsync(() => api!.listMyGrants(), []);
  const [ending, setEnding] = useState<MyGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const stop = async (g: MyGrant) => {
    setBusy(true);
    setProblem(null);
    try {
      await api!.revokeAccessGrant(g.grantId);
      setEnding(null);
      setFlash(`${g.name || g.email} can no longer see your data.`);
      grants.reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Sharing could not be stopped. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const rows = grants.data ?? [];
  return (
    <>
      <div className="page-head">
        <div className="titles">
          <h1>Sharing</h1>
          <p className="muted">
            Researchers and clinicians you have given a share code to. They see only the signals you chose, and only
            while you keep sharing. To share with someone new, create a share code in the WearWise app.
          </p>
        </div>
      </div>

      {flash && <div style={{ marginBottom: 16 }}><Alert kind="success" onDismiss={() => setFlash(null)}>{flash}</Alert></div>}

      <div className="card flush">
        {grants.status === 'error' && !grants.data ? (
          <ErrorState title="Sharing couldn’t be loaded" message={grants.error!} onRetry={grants.reload} />
        ) : !grants.data ? (
          <LoadingState label="Loading…" />
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title="You aren’t sharing with anyone">
            Nobody else can see your data. If a researcher or clinician needs it, create a share code for them in the
            WearWise app (Profile → Privacy &amp; access).
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Can see</th>
                  <th scope="col" className="hide-md">Since</th>
                  <th scope="col"><span className="visually-hidden">Stop</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.grantId}>
                    <td>
                      <div className="primary-cell">
                        <strong>{g.name || g.email}</strong>
                        <span className="small muted">{ROLE[g.role] ?? 'Account'}{g.name ? ` · ${g.email}` : ''}</span>
                        {!g.accessActive && <span><Badge tone="neutral">Access paused by WearWise</Badge></span>}
                      </div>
                    </td>
                    <td><SignalBadges types={g.sensorTypes} falls={g.includeFalls} /></td>
                    <td className="hide-md">{formatDate(g.createdAt)}</td>
                    <td><Button size="sm" variant="danger" onClick={() => setEnding(g)}>Stop sharing</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!ending} onClose={() => !busy && setEnding(null)} labelledBy="stop-title">
        {ending && (
          <div className="dialog-body">
            <h2 id="stop-title">Stop sharing with {ending.name || ending.email}?</h2>
            <p className="muted">
              They lose access to your data straight away, including anything you shared before. Nothing is deleted
              from your account. To share again, you would create a new share code in the app.
            </p>
            {problem && <Alert kind="error">{problem}</Alert>}
            <div className="dialog-actions">
              <Button variant="ghost" onClick={() => setEnding(null)} disabled={busy}>Cancel</Button>
              <Button variant="danger" busy={busy} onClick={() => void stop(ending)}>Stop sharing</Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
