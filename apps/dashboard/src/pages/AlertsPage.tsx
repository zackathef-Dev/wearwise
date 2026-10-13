import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAlerts } from '../alerts/AlertsProvider';
import { atMs } from '../alerts/unread';
import { useViewer } from '../auth/AuthProvider';
import { Alert, Badge, Button, EmptyState, ErrorState, FallStatusBadge, LoadingState } from '../components/ui';
import { alertTitle, alertValue } from '../data/alert-text';
import { formatDateTime, formatDuration } from '../data/format';
import type { AlertItem } from '../data/types';

/* Every alert this account can see, newest first: falls and readings that stayed out
   of range, from the phone app. Opening the page marks them seen. */
export function AlertsPage() {
  const { staff } = useViewer();
  const { items, error, loading, reload, nameOf, baseOf, seenUpTo, markSeen, notify, setNotify, sound, setSound } = useAlerts();
  /* What was new when the page opened stays highlighted while you're here. */
  const [newSince] = useState(seenUpTo);
  useEffect(() => { if (items) markSeen(); }, [items, markSeen]);

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <h1>Alerts</h1>
          <p className="muted">
            {staff
              ? 'Falls and readings that stayed out of the usual range, for participants who share them with you.'
              : 'Falls and readings that stayed out of the usual range in your recordings.'}
          </p>
        </div>
        <div className="page-actions">
          <Button size="sm" icon="refresh-cw" busy={loading && !!items} onClick={reload}>Refresh</Button>
        </div>
      </div>

      <NotifyCard notify={notify} setNotify={setNotify} />
      <div className="card notify-card" style={{ marginTop: 12 }}>
        <div className="titles">
          <strong>Alert sound</strong>
          <span className="small muted">
            {sound
              ? 'On: a short tone when a new alert arrives while WearWise is open (an urgent one for a fall).'
              : 'Off: new alerts arrive silently.'}
          </span>
        </div>
        <Button size="sm" variant={sound ? 'secondary' : 'primary'} onClick={() => setSound(!sound)}>{sound ? 'Turn off' : 'Turn on'}</Button>
      </div>

      <div className="card flush" style={{ marginTop: 16 }}>
        {error && !items ? (
          <ErrorState title="Alerts couldn’t be loaded" message={error} onRetry={reload} />
        ) : !items ? (
          <LoadingState label="Loading alerts…" />
        ) : items.length === 0 ? (
          <EmptyState icon="circle-check" title="No alerts">
            {staff
              ? 'Nothing has been flagged for the participants who share with you.'
              : 'Nothing has been flagged in your recordings.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  {staff && <th scope="col">Who</th>}
                  <th scope="col">Alert</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="visually-hidden">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="row">
                        {formatDateTime(a.at)}
                        {atMs(a) > newSince && <Badge tone="info">New</Badge>}
                      </span>
                    </td>
                    {staff && <td>{nameOf(a.participantId)}</td>}
                    <td>
                      <div className="primary-cell">
                        <strong>{alertTitle(a)}</strong>
                        <span className="small muted">{alertValue(a)}</span>
                      </div>
                    </td>
                    <td><AlertStatus a={a} /></td>
                    <td>
                      {a.sessionId
                        ? <Link to={`${baseOf(a.participantId)}/sessions/${a.sessionId}${a.kind === 'fall' ? `?fall=${encodeURIComponent(a.id)}` : ''}`}>View in session</Link>
                        : <span className="small muted">Not recorded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {error && items && <div style={{ marginTop: 16 }}><Alert kind="error">{error}</Alert></div>}
    </>
  );
}

function AlertStatus({ a }: { a: AlertItem }) {
  if (a.kind === 'fall') return <FallStatusBadge status={a.fallStatus ?? ''} />;
  if (!a.endedAt) return <Badge tone="warning" icon="triangle-alert">Ongoing</Badge>;
  return <Badge tone="neutral" title={`Lasted ${formatDuration(Date.parse(a.endedAt) - Date.parse(a.at))}`}>Ended</Badge>;
}

function NotifyCard({ notify, setNotify }: { notify: ReturnType<typeof useAlerts>['notify']; setNotify: (on: boolean) => Promise<void> }) {
  if (notify === 'unsupported') return null;
  return (
    <div className="card notify-card">
      <div className="titles">
        <strong>Browser notifications</strong>
        <span className="small muted">
          {notify === 'on' && 'On: a notification appears when a new alert arrives while WearWise is open in this browser.'}
          {notify === 'off' && 'Get a notification when a new alert arrives while WearWise is open in this browser.'}
          {notify === 'blocked' && 'Blocked for this site. Allow notifications in the browser’s site settings (the icon left of the address), then reload.'}
        </span>
      </div>
      {notify === 'on' && <Button size="sm" onClick={() => void setNotify(false)}>Turn off</Button>}
      {notify === 'off' && <Button size="sm" variant="primary" icon="bell" onClick={() => void setNotify(true)}>Turn on</Button>}
    </div>
  );
}
