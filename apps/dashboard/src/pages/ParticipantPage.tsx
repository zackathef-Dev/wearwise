import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useViewer } from '../auth/AuthProvider';
import {
  Alert, Button, ButtonLink, EmptyState, ErrorState, FallStatusBadge, LoadingState, SessionStatusBadge,
  SignalBadges, SimulatedBadge,
} from '../components/ui';
import { useAsync } from '../components/useAsync';
import { api } from '../data/client';
import { formatCount, formatDate, formatDateTime, formatDuration } from '../data/format';
import { SIGNAL_ORDER } from '../data/signals';
import type { ChannelRow, SharedParticipant } from '../data/types';
import { LiveView } from './LiveView';
import { RemoveParticipantDialog } from './RemoveParticipantDialog';
import { PanelBoundary } from '../components/PanelBoundary';
import { participantLabel } from './ParticipantsPage';

const PAGE_SIZE = 25;

/** Whose data a page shows: a participant who shares with the viewer, or the
 *  signed-in account's own (`self`, under /me). `base` is the page's URL. */
export interface Subject extends SharedParticipant {
  self: boolean;
  base: string;
}

/** The subject, or null if this participant no longer shares with the viewer. */
export function useSubject(participantId: string | undefined, self: boolean) {
  const { profile } = useViewer();
  return useAsync(async (): Promise<Subject | null> => {
    if (self) {
      const { rows, total } = await api!.listSessions(profile.id, 0, 1);
      return {
        grantId: '', participantId: profile.id, name: profile.displayName, sensorTypes: SIGNAL_ORDER,
        includeFalls: true, sharedSince: '', lastSessionAt: rows[0]?.startedAt ?? null, sessionCount: total,
        self: true, base: '/me',
      };
    }
    const p = (await api!.listSharedParticipants()).find((x) => x.participantId === participantId);
    return p ? { ...p, self: false, base: `/participants/${p.participantId}` } : null;
  }, [participantId, self, profile.id]);
}

export function NotShared() {
  return (
    <div className="card">
      <EmptyState
        icon="users" title="Not shared with you"
        action={<ButtonLink to="/participants" icon="arrow-left">Back to participants</ButtonLink>}
      >
        This participant isn’t sharing data with you, or no longer is. They may have stopped sharing, or the link
        may be wrong. Only participants on your list can be viewed.
      </EmptyState>
    </div>
  );
}

export function ParticipantPage({ self = false }: { self?: boolean }) {
  const { participantId } = useParams();
  const participant = useSubject(participantId, self);

  if (participant.status === 'loading' && participant.data === undefined) return <LoadingState label="Loading participant…" />;
  if (participant.status === 'error' && participant.data === undefined) {
    return <div className="card"><ErrorState message={participant.error!} onRetry={participant.reload} /></div>;
  }
  if (!participant.data) return <NotShared />;
  return participant.data.self ? <MyData p={participant.data} /> : <ParticipantDetail p={participant.data} />;
}

/** The signed-in account's own recordings: what the phone uploaded. */
function MyData({ p }: { p: Subject }) {
  return (
    <>
      <div className="page-head">
        <div className="titles">
          <h1>My data</h1>
          <p className="muted">Recordings your WearWise app has uploaded. Only you, and people you share with, can see them.</p>
        </div>
      </div>
      <div className="facts">
        <div className="fact"><span className="overline">Sessions</span><span className="value">{formatCount(p.sessionCount)}</span></div>
        <div className="fact"><span className="overline">Last session</span><span className="value">{p.lastSessionAt ? formatDateTime(p.lastSessionAt) : 'None yet'}</span></div>
        <div className="fact"><span className="overline">Who can see it</span><Link to="/sharing" className="value">Manage sharing</Link></div>
      </div>
      <SessionsSection p={p} />
      <FallsSection p={p} />
    </>
  );
}

function ParticipantDetail({ p }: { p: Subject }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const name = participantLabel(p);

  /* Either way the grant is gone: back to a refreshed list. */
  const onRemoved = (who: string, ended: boolean) => navigate('/participants', {
    state: { flash: ended ? `${who} was removed from your list.` : `${who} had already stopped sharing with you.` },
  });

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/participants">Participants</Link><span aria-hidden>/</span><span>{name}</span>
      </nav>
      <div className="page-head">
        <div className="titles">
          <h1>{name}</h1>
        </div>
        <div className="page-actions">
          <Button variant="danger" icon="user-minus" onClick={() => setConfirming(true)}>Remove participant</Button>
        </div>
      </div>

      <div className="facts">
        <div className="fact"><span className="overline">Shared with you</span><SignalBadges types={p.sensorTypes} /></div>
        <div className="fact"><span className="overline">Falls</span><span className="value">{p.includeFalls ? 'Included' : 'Not shared'}</span></div>
        <div className="fact"><span className="overline">Shared since</span><span className="value">{formatDate(p.sharedSince)}</span></div>
        <div className="fact"><span className="overline">Sessions</span><span className="value">{formatCount(p.sessionCount)}</span></div>
      </div>

      <PanelBoundary label="Live view"><LiveView grantId={p.grantId} name={name} sensorTypes={p.sensorTypes} includeFalls={p.includeFalls} /></PanelBoundary>
      <SessionsSection p={p} />
      {p.includeFalls
        ? <FallsSection p={p} />
        : (
          <section className="section">
            <h2>Falls</h2>
            <p className="muted">Falls aren’t part of what {name} shared with you.</p>
          </section>
        )}

      <RemoveParticipantDialog
        target={confirming ? { grantId: p.grantId, name } : null} onClose={() => setConfirming(false)} onRemoved={onRemoved}
      />
    </>
  );
}

function SessionsSection({ p }: { p: Subject }) {
  const { participantId } = p;
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const sessions = useAsync(async () => {
    const { rows, total } = await api!.listSessions(participantId, page, PAGE_SIZE);
    const channels = await api!.listChannelsForSessions(rows.map((r) => r.id));
    const bySession = new Map<string, ChannelRow[]>();
    for (const c of channels) bySession.set(c.sessionId, [...(bySession.get(c.sessionId) ?? []), c]);
    return { rows, total, bySession };
  }, [participantId, page]);

  const d = sessions.data;
  const from = page * PAGE_SIZE;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Sessions</h2>
        {d && d.total > 0 && (
          <span className="small muted num">
            {from + 1}–{Math.min(from + PAGE_SIZE, d.total)} of {formatCount(d.total)}, newest first
          </span>
        )}
      </div>
      <div className="card flush">
        {sessions.status === 'error' && !d ? (
          <ErrorState title="Sessions couldn’t be loaded" message={sessions.error!} onRetry={sessions.reload} />
        ) : !d ? (
          <LoadingState label="Loading sessions…" />
        ) : d.rows.length === 0 ? (
          <EmptyState icon="activity" title="No sessions yet">
            {p.self
              ? 'Sessions appear here once you record with WearWise and the app uploads the recording.'
              : 'Sessions appear here once the participant records with WearWise and their phone uploads the recording.'}
          </EmptyState>
        ) : (
          <div className="table-wrap" style={{ opacity: sessions.status === 'loading' ? 0.6 : 1 }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col" className="num">Duration</th>
                  <th scope="col">Status</th>
                  <th scope="col">{p.self ? 'Signals' : 'Signals shared'}</th>
                  <th scope="col" className="hide-md">Device</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((s) => {
                  const href = `${p.base}/sessions/${s.id}`;
                  const channels = d.bySession.get(s.id) ?? [];
                  return (
                    <tr key={s.id} className="link-row" onClick={() => navigate(href)}>
                      <td><div className="primary-cell"><Link to={href} onClick={(e) => e.stopPropagation()}>{formatDateTime(s.startedAt)}</Link></div></td>
                      <td className="num">{formatDuration(s.durationMs)}</td>
                      <td><span className="row"><SessionStatusBadge status={s.status} />{s.simulated && <SimulatedBadge />}</span></td>
                      <td>
                        {channels.length
                          ? <SignalBadges types={channels.filter((c) => c.sampleCount > 0).map((c) => c.sensorType)} />
                          : <span className="small muted">None of the shared signals</span>}
                      </td>
                      <td className="hide-md">{s.simulated ? <span className="muted">Simulator</span> : (s.deviceName ?? <span className="muted">—</span>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {sessions.status === 'error' && d && <Alert kind="error">{sessions.error}</Alert>}
      {d && d.total > PAGE_SIZE && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" icon="chevron-left" disabled={page === 0 || sessions.status === 'loading'} onClick={() => setPage((n) => n - 1)}>Newer</Button>
          <Button size="sm" disabled={from + PAGE_SIZE >= d.total || sessions.status === 'loading'} onClick={() => setPage((n) => n + 1)}>
            Older
          </Button>
        </div>
      )}
    </section>
  );
}

function FallsSection({ p }: { p: Subject }) {
  const { participantId } = p;
  const falls = useAsync(() => api!.listFallsForParticipant(participantId), [participantId]);
  const rows = falls.data ?? [];
  return (
    <section className="section">
      <div className="section-head">
        <h2>Falls</h2>
        {rows.length > 0 && <span className="small muted">Newest first</span>}
      </div>
      <div className="card flush">
        {falls.status === 'error' && !falls.data ? (
          <ErrorState title="Falls couldn’t be loaded" message={falls.error!} onRetry={falls.reload} />
        ) : !falls.data ? (
          <LoadingState label="Loading falls…" />
        ) : rows.length === 0 ? (
          <EmptyState icon="circle-check" title="No falls recorded">
            {p.self ? 'No falls were detected in your uploaded sessions.' : 'No falls were detected in this participant’s uploaded sessions.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col" className="num">Impact</th>
                  <th scope="col" className="num hide-md">Free-fall low</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="visually-hidden">Session</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td>{formatDateTime(f.createdAt)}</td>
                    <td className="num">{f.impactPeakG.toFixed(1)} g</td>
                    <td className="num hide-md">{f.freefallMinG.toFixed(2)} g</td>
                    <td><FallStatusBadge status={f.status} /></td>
                    <td><Link to={`${p.base}/sessions/${f.sessionId}?fall=${encodeURIComponent(f.id)}`}>View in session</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
