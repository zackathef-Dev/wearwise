import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { FallMarker } from '../charts/SignalChart';
import { TimeWindowBar } from '../charts/TimeWindowBar';
import { around, clampWindow, panWindow, zoomWindow, type TimeWindow } from '../charts/window';
import {
  Alert, Badge, Button, ButtonLink, EmptyState, ErrorState, FallStatusBadge, LoadingState, SessionStatusBadge,
  SignalBadge, SimulatedBadge,
} from '../components/ui';
import { useAsync } from '../components/useAsync';
import { api } from '../data/client';
import { fileTime } from '../data/csv';
import { formatClock, formatCount, formatDateTime, formatDuration, formatElapsed, formatRate, formatValue } from '../data/format';
import { bySignalOrder, signalMeta } from '../data/signals';
import { sessionTimeline } from '../data/timeline';
import type { ChannelRow, FallRow, SessionRow } from '../data/types';
import { usePalette } from '../theme/useColorScheme';
import { ChannelPanel } from './ChannelPanel';
import { PanelBoundary } from '../components/PanelBoundary';
import { NotShared, useSubject, type Subject } from './ParticipantPage';
import { participantLabel } from './ParticipantsPage';

export function SessionPage({ self = false }: { self?: boolean }) {
  const { participantId, sessionId } = useParams();
  const [params] = useSearchParams();
  const participant = useSubject(participantId, self);
  const bundle = useAsync(async () => {
    const [session, channels, falls] = await Promise.all([
      api!.getSession(sessionId!), api!.listChannels(sessionId!), api!.listFallsForSession(sessionId!),
    ]);
    return { session, channels, falls };
  }, [sessionId]);

  const firstError = participant.status === 'error' ? participant : bundle.status === 'error' ? bundle : null;
  if (firstError && (participant.data === undefined || bundle.data === undefined)) {
    return <div className="card"><ErrorState message={firstError.error!} onRetry={() => { participant.reload(); bundle.reload(); }} /></div>;
  }
  if (participant.data === undefined || bundle.data === undefined) return <LoadingState label="Loading session…" />;
  if (!participant.data) return <NotShared />;

  const { session, channels, falls } = bundle.data;
  if (!session || session.participantId !== participant.data.participantId) {
    return (
      <div className="card">
        <EmptyState
          icon="activity" title="Session not available"
          action={(
            <ButtonLink to={participant.data.base} icon="arrow-left">
              Back to {participant.data.self ? 'my data' : participantLabel(participant.data)}
            </ButtonLink>
          )}
        >
          {participant.data.self
            ? 'This session doesn’t exist. It may have been deleted from the app.'
            : 'This session isn’t available to you. It may have been deleted, or it has none of the signals they share with you.'}
        </EmptyState>
      </div>
    );
  }
  return (
    <SessionDetail
      key={session.id} participant={participant.data} session={session} channels={channels} falls={falls}
      focusFallId={params.get('fall')}
    />
  );
}

function SessionDetail({ participant, session, channels, falls, focusFallId }: {
  participant: Subject; session: SessionRow; channels: ChannelRow[]; falls: FallRow[]; focusFallId: string | null;
}) {
  const palette = usePalette();
  const name = participant.self ? 'You' : participantLabel(participant);
  const sorted = useMemo(() => [...channels].sort((a, b) => bySignalOrder(a.sensorType, b.sensorType)), [channels]);
  const timeline = useMemo(() => sessionTimeline(channels, falls, session.durationMs), [channels, falls, session.durationMs]);
  const domain = useMemo<TimeWindow>(() => ({ start: timeline.start, end: timeline.end }), [timeline]);
  const markers = useMemo<FallMarker[]>(
    () => falls.map((f) => ({ id: f.id, t: f.detectedAtMs / 1000, status: f.status, impactG: f.impactPeakG })),
    [falls],
  );

  const [view, setViewRaw] = useState<TimeWindow>(() => {
    const f = markers.find((m) => m.id === focusFallId);
    return f ? around(f.t, 30, domain) : domain;
  });
  const [hoverT, setHoverT] = useState<number | null>(null);
  const chartsRef = useRef<HTMLDivElement>(null);

  const setView = useCallback((w: TimeWindow | ((w: TimeWindow) => TimeWindow)) => {
    setViewRaw((cur) => clampWindow(typeof w === 'function' ? w(cur) : w, domain));
  }, [domain]);
  const zoomBy = useCallback((factor: number, center: number) => setView((v) => zoomWindow(v, factor, domain, center)), [setView, domain]);
  const pan = useCallback((fraction: number) => setView((v) => panWindow(v, fraction, domain)), [setView, domain]);

  const showFall = (t: number) => {
    setView(around(t, 30, domain));
    chartsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startMs = Date.parse(session.startedAt);
  const sessionStartMs = Number.isNaN(startMs) ? null : startMs;
  const fileStem = `wearwise_${fileTime(session.startedAt)}`;
  const device = session.simulated ? 'Simulator' : session.deviceName;
  const withSamples = sorted.filter((c) => c.sampleCount > 0);

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        {participant.self ? (
          <><Link to="/me">My data</Link><span aria-hidden>/</span></>
        ) : (
          <>
            <Link to="/participants">Participants</Link><span aria-hidden>/</span>
            <Link to={participant.base}>{name}</Link><span aria-hidden>/</span>
          </>
        )}
        <span>Session</span>
      </nav>
      <div className="page-head">
        <div className="titles">
          <h1>Session on {formatDateTime(session.startedAt)}</h1>
          <p className="muted">
            {participant.self ? '' : `${name} · `}{formatDuration(session.durationMs)}
            {device ? ` · ${device}` : ''}
            {session.firmwareVersion && !session.simulated ? ` · firmware ${session.firmwareVersion}` : ''}
          </p>
        </div>
        <div className="row">
          <SessionStatusBadge status={session.status} />
          {session.simulated && <SimulatedBadge />}
        </div>
      </div>

      <div className="stack">
        {session.simulated && (
          <Alert kind="info" title="Simulated data">
            This session was generated by the WearWise app’s built-in simulator, not measured from a person.
          </Alert>
        )}
        {session.status === 'interrupted' && (
          <Alert kind="warning" title="This recording was interrupted">
            The app stopped before the session was ended normally (for example the phone restarted or the app was
            closed). Everything recorded up to that point is shown.
          </Alert>
        )}
      </div>

      {/* ------------------------------------------------------- summary ------ */}
      <section className="section">
        <div className="section-head">
          <h2>Shared signals</h2>
          <span className="small muted">Summaries cover the whole session, as computed on {participant.self ? 'your' : 'the participant’s'} phone.</span>
        </div>
        <div className="card flush">
          {sorted.length === 0 ? (
            <EmptyState icon="activity" title="Nothing shared from this session">
              None of the signals {name} shares with you were recorded in this session.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Signal</th>
                    <th scope="col" className="num">Minimum</th>
                    <th scope="col" className="num">Average</th>
                    <th scope="col" className="num">Maximum</th>
                    <th scope="col" className="num">Rate</th>
                    <th scope="col" className="num">Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => {
                    const m = signalMeta(c.sensorType);
                    const v = (x: number | null) => (x == null ? '—' : `${formatValue(x, m.digits)} ${m.unit}`);
                    return (
                      <tr key={c.id}>
                        <td><span className="row"><SignalBadge type={c.sensorType} />{m.label !== m.short && <span className="hide-md">{m.label}</span>}</span></td>
                        <td className="num">{v(c.min)}</td>
                        <td className="num">{v(c.avg)}</td>
                        <td className="num">{v(c.max)}</td>
                        <td className="num">{formatRate(c.sampleRateHz)}</td>
                        <td className="num">{formatCount(c.sampleCount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* --------------------------------------------------------- falls ------ */}
      <section className="section">
        <div className="section-head">
          <h2>Falls</h2>
          {participant.includeFalls && falls.length > 0 && (
            <span className="small muted">Fall times come from the phone’s clock and line up with the charts to within about a second.</span>
          )}
        </div>
        {!participant.includeFalls ? (
          <p className="muted">Falls aren’t part of what {name} shared with you.</p>
        ) : falls.length === 0 ? (
          <p className="muted">No falls were detected in this session.</p>
        ) : (
          <div className="card flush">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Into session</th>
                    <th scope="col" className="hide-md">Time</th>
                    <th scope="col" className="num">Impact</th>
                    <th scope="col" className="num hide-md">Free-fall low</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="visually-hidden">Chart</span></th>
                  </tr>
                </thead>
                <tbody>
                  {falls.map((f) => (
                    <tr key={f.id}>
                      <td className="num" style={{ textAlign: 'left' }}>{formatElapsed(f.detectedAtMs / 1000)}</td>
                      <td className="hide-md">{Number.isNaN(Date.parse(f.createdAt)) ? '—' : formatClock(Date.parse(f.createdAt))}</td>
                      <td className="num">{f.impactPeakG.toFixed(1)} g</td>
                      <td className="num hide-md">{f.freefallMinG.toFixed(2)} g</td>
                      <td><FallStatusBadge status={f.status} /></td>
                      <td>
                        {withSamples.length > 0 && (
                          <Button size="sm" variant="ghost" icon="zoom-in" onClick={() => showFall(f.detectedAtMs / 1000)}>Show on charts</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- charts ------ */}
      {withSamples.length > 0 && (
        <section className="section" ref={chartsRef} style={{ scrollMarginTop: 72 }}>
          <div className="section-head">
            <h2>Charts</h2>
            <span className="small muted">Drag across any chart to zoom all of them; double-click for the whole session.</span>
          </div>
          <TimeWindowBar view={view} domain={domain} onChange={setView} />
          {markers.length > 0 && (
            <div className="row small muted">
              <Badge tone="outline"><span className="fall-dot" aria-hidden />Fall, alarm raised</Badge>
              <Badge tone="outline"><span className="fall-dot cancelled" aria-hidden />Fall, marked OK</Badge>
            </div>
          )}
          {sorted.map((c) => (
            <PanelBoundary key={c.id} label={`The ${signalMeta(c.sensorType).label.toLowerCase()} chart`}>
              <ChannelPanel
                channel={c} meta={signalMeta(c.sensorType)} originUs={timeline.originUs} palette={palette}
                view={view} domain={domain} hoverT={hoverT} falls={markers} sessionStartMs={sessionStartMs}
                fileStem={fileStem} onHover={setHoverT} onView={setView} onZoomBy={zoomBy} onPan={pan}
              />
            </PanelBoundary>
          ))}
        </section>
      )}
    </>
  );
}
