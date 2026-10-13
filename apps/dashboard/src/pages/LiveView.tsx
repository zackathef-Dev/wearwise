import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_LABEL, STATUS_LABEL, SensorType, activityLevel, classify, type VitalStatus } from '@wearwise/sensor-protocol';
import { useAlerts } from '../alerts/AlertsProvider';
import { chimeAllowed, playChime } from '../alerts/chime';
import { Icon } from '../components/Icon';
import { Alert, Badge, Button, SignalBadges, SimulatedBadge } from '../components/ui';
import { api, supabase } from '../data/client';
import { formatClock } from '../data/format';
import { signalMeta } from '../data/signals';
import { LiveFeed, parseRecordAnswer, type LiveFall, type LivePhase, type LiveStatus, type RecordAnswer } from '../live/live-feed';
import { rememberLiveChannel, sendLiveStop, sendToPhone } from '../live/live-stop';
import { cssVarName } from '../theme/tokens';
import { usePalette } from '../theme/useColorScheme';

/* Live view for setup: while the participant has it switched on in the app, their
 * readings arrive over a private Realtime channel for this grant (`live:<grantId>`)
 * and are drawn as they come. Nothing is stored, here or on the server.
 * Contract: docs/architecture/live-view-and-alerts.md §2.
 *
 * Laid out like the live section of the phone's Home, so researcher and participant
 * look at the same thing: the ECG on ECG paper, then a tile per reading with the same
 * "Normal / High" verdicts (shared ranges in @wearwise/sensor-protocol), and a tapped
 * tile's graph under the ECG. Falls arrive here too while live view is on, if they
 * are shared.
 *
 * Realtime checks the grant when the channel is joined, not on every message, so
 * this re-checks the grant every minute and leaves the channel once it has ended.
 */

const GRANT_CHECK_MS = 60_000;
/* The phone gives the participant a minute to answer a recording request; after a bit
   longer with no word at all, say so. */
const RECORD_ANSWER_MS = 75_000;
/* Kept per signal: enough for the longest graph (heart rate, 60 s). */
const BUFFER_MS = 60_000;
const ECG_WINDOW_MS = 3_000;
/* Readings come in half-second batches: draw this far behind "now" so the trace
   moves smoothly instead of waiting at the right edge for the next batch. */
const DRAW_LAG_MS = 800;
/* While a fall's alarm is on (detected or raised), the fall sound repeats this often
   until the phone says it was answered or the researcher closes the banner, as the
   phone's own alarm keeps sounding. */
const FALL_REPEAT_MS = 4_000;
/* No value for this long = no contact (finger lifted, patch off). Heart rate and SpO₂
   report about once a second; the batches and the network add up to a second more. */
const STALE_MS = 3_000;

const TILES = [SensorType.HeartRate, SensorType.SpO2, SensorType.Temperature, SensorType.Accelerometer] as number[];
const TILE_NAME: Record<number, string> = {
  [SensorType.HeartRate]: 'Heart rate', [SensorType.SpO2]: 'SpO₂', [SensorType.Temperature]: 'Skin temp', [SensorType.Accelerometer]: 'Movement',
};
const ICON: Record<number, string> = {
  [SensorType.HeartRate]: 'heart', [SensorType.SpO2]: 'droplet', [SensorType.Temperature]: 'thermometer', [SensorType.Accelerometer]: 'person-standing',
};
/* The tapped tile's graph, as on the phone: how much time it shows, its fixed scale
   and the gridlines it labels. */
const GRAPH: Record<number, { windowMs: number; range: [number, number]; ticks: number[]; title: string }> = {
  [SensorType.HeartRate]: { windowMs: 60_000, range: [0, 198], ticks: [72, 114, 156, 198], title: 'Heart rate' },
  [SensorType.SpO2]: { windowMs: 30_000, range: [70, 100], ticks: [80, 90, 95, 100], title: 'Blood oxygen' },
  [SensorType.Temperature]: { windowMs: 60_000, range: [20, 42], ticks: [25, 30, 35, 40], title: 'Skin temperature' },
  [SensorType.Accelerometer]: { windowMs: 6_000, range: [0, 6], ticks: [1, 2, 4, 6], title: 'Movement' },
};

type Connection = 'connecting' | 'ready' | 'unavailable' | 'revoked';

export function LiveView({ grantId, name, sensorTypes, includeFalls }: {
  grantId: string; name: string; sensorTypes: number[]; includeFalls: boolean;
}) {
  const feedRef = useRef<LiveFeed | null>(null);
  if (!feedRef.current) feedRef.current = new LiveFeed(sensorTypes, BUFFER_MS, includeFalls);
  const feed = feedRef.current;
  const [connection, setConnection] = useState<Connection>('connecting');
  const [now, setNow] = useState(() => Date.now());
  const [focus, setFocus] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  /* This viewer's recording request: what the phone last said, or 'sending' / 'no-answer'
     on this side; null when there is nothing to show. */
  const [record, setRecord] = useState<RecordAnswer | 'sending' | 'no-answer' | 'failed' | null>(null);
  /* The fall banner, until the researcher closes it (a later step reopens it). `at` is
     the fall's time on this computer, fixed when it first arrives so it doesn't
     shift as the clock estimate settles. */
  const [fall, setFall] = useState<{ f: LiveFall; at: number } | null>(null);
  const { sound, notify } = useAlerts();
  const announce = useRef({ sound, notify });
  announce.current = { sound, notify };

  useEffect(() => {
    if (!supabase || !grantId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let forget = () => {};
    let closed = false;
    const leave = () => { forget(); if (channel) void supabase!.removeChannel(channel); channel = null; };
    const onFall = (payload: unknown) => {
      const f = feed.onFall(payload, Date.now());
      if (!f) return;
      setFall((prev) => ({ f, at: prev?.f.at === f.at ? prev.at : feed.toLocal(f.at) }));
      if (f.state === 'detected' || f.state === 'raised') alarm(f, announce.current);
    };
    /* Join with the signed-in user's token, not the anon key: the channel is private. */
    void supabase.realtime.setAuth().then(() => {
      if (closed) return;
      const ch = supabase!
        /* ack: a send resolves once the server has taken it, so "stop" is known to be
           through before Remove participant revokes the grant it was checked against. */
        .channel(`live:${grantId}`, { config: { private: true, broadcast: { self: false, ack: true } } })
        .on('broadcast', { event: 'status' }, ({ payload }) => feed.onStatus(payload, Date.now()))
        .on('broadcast', { event: 'samples' }, ({ payload }) => feed.onSamples(payload, Date.now()))
        .on('broadcast', { event: 'fall' }, ({ payload }) => onFall(payload))
        .on('broadcast', { event: 'record' }, ({ payload }) => { const a = parseRecordAnswer(payload); if (a) setRecord(a); })
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') { setConnection('ready'); forget(); forget = rememberLiveChannel(grantId, ch); }
          else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setConnection('unavailable');
        });
      channel = ch;
    });
    const check = window.setInterval(() => {
      void api?.listSharedParticipants().then((list) => {
        if (!closed && !list.some((p) => p.grantId === grantId)) { leave(); setConnection('revoked'); }
      }).catch(() => undefined);
    }, GRANT_CHECK_MS);
    return () => { closed = true; window.clearInterval(check); leave(); };
  }, [grantId, feed]);

  /* Waiting on the participant: give up after a while with no word from the phone. */
  useEffect(() => {
    if (record !== 'sending' && record !== 'asked') return;
    const id = window.setTimeout(() => setRecord('no-answer'), RECORD_ANSWER_MS);
    return () => window.clearTimeout(id);
  }, [record]);

  const ringing = fall && (fall.f.state === 'detected' || fall.f.state === 'raised') && sound;
  useEffect(() => {
    if (!ringing) return;
    const id = window.setInterval(() => playChime('fall'), FALL_REPEAT_MS);
    return () => window.clearInterval(id);
  }, [ringing]);

  /* Tiles and the phase update twice a second; the traces draw every frame. */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const phase: LivePhase = connection === 'revoked' ? 'ended' : feed.phase(now);
  const live = phase === 'live';
  const status = feed.status;
  const endsAt = feed.endsAtLocal();
  const phoneNow = feed.phoneNow(now) - DRAW_LAG_MS;
  /* A signal's buffer, if it has a value recent enough to count as live. */
  const fresh = (t: number) => {
    const buf = feed.buffers.get(t);
    return live && buf?.latest && phoneNow - buf.latest.t <= STALE_MS ? buf : null;
  };
  const tiles = TILES.filter((t) => sensorTypes.includes(t));
  const focused = focus != null && tiles.includes(focus) ? focus : null;

  const stop = async () => {
    setStopping(true);
    setStopError(null);
    if (await sendLiveStop(grantId)) feed.stopByViewer();
    else setStopError('Live view couldn’t be stopped from here right now. Try again in a moment.');
    setStopping(false);
    setNow(Date.now());
  };

  const askToRecord = async () => {
    setRecord('sending');
    if (!(await sendToPhone(grantId, 'record'))) setRecord('failed');
  };
  const stopRecording = async () => {
    setRecord('sending');
    if (!(await sendToPhone(grantId, 'record-stop'))) setRecord('failed');
  };
  const recording = live && !!status?.recording;
  const mine = recording && !!status?.startedByYou;
  const waiting = record === 'sending' || record === 'asked';

  return (
    <section className="section" aria-labelledby="live-title">
      <div className="section-head">
        <h2 id="live-title">Live view</h2>
        <span className="row">
          {live && <Badge tone="success"><span className="live-dot" aria-hidden />Live</Badge>}
          {live && status?.simulated && <SimulatedBadge />}
          {phase === 'paused' && <Badge tone="warning">Paused</Badge>}
          {phase === 'ended' && <Badge tone="neutral">Ended</Badge>}
          {recording && <Badge tone="error"><span className="live-dot" aria-hidden />Recording</Badge>}
          {live && !recording && (
            <Button size="sm" icon="circle-dot" busy={waiting} onClick={() => void askToRecord()}>Start recording</Button>
          )}
          {mine && <Button size="sm" icon="square" busy={waiting} onClick={() => void stopRecording()}>Stop recording</Button>}
          {live && <Button size="sm" icon="circle-stop" busy={stopping} onClick={() => void stop()}>Stop live view</Button>}
        </span>
      </div>

      <div className={`live-card${phase === 'ended' || phase === 'paused' ? ' ended' : ''}`}>
        <p className="small muted" role="status">{summary(phase, connection, feed, name, endsAt)}</p>
        {status && phase !== 'waiting' && <DeviceCard status={status} phase={phase} />}
        {stopError && <Alert kind="error" onDismiss={() => setStopError(null)}>{stopError}</Alert>}
        {record && <RecordNote answer={record} name={name} recording={recording} onClose={() => setRecord(null)} />}
        {live && includeFalls && sound && !chimeAllowed() && (
          <p className="small muted">Click anywhere on this page so a fall can sound an alarm here. Browsers keep a page silent until then.</p>
        )}
        {fall && <FallBanner fall={fall.f} name={name} at={fall.at} onClose={() => setFall(null)} />}

        <EcgCard feed={feed} running={live} hint={ecgHint(feed, phase, sensorTypes, name, live
          ? fresh(SensorType.Ecg) != null
          : (feed.buffers.get(SensorType.Ecg)?.length ?? 0) > 1)} />

        {focused != null && (
          <FocusGraph key={focused} feed={feed} sensor={focused} running={live} quiet={!fresh(focused)} onClose={() => setFocus(null)} />
        )}

        {tiles.length > 0 && (
          <div className="vital-tiles">
            {tiles.map((t) => {
              const buf = fresh(t);
              let value = '—';
              let sub: string | null = null;
              let verdict: VitalStatus | null = null;
              if (buf?.latest) {
                if (t === SensorType.Accelerometer) {
                  const level = activityLevel(buf.range(phoneNow - 3_000, phoneNow).v);
                  value = level ? ACTIVITY_LABEL[level] : '—';
                  sub = `${buf.latest.v.toFixed(2)} g`;
                } else {
                  value = buf.latest.v.toFixed(t === SensorType.Temperature ? 1 : 0);
                  verdict = classify(t as SensorType, buf.latest.v);
                }
              }
              const absent = live && status?.sensors != null && !status.sensors.includes(t);
              const hint = phase === 'paused' ? 'Paused' : !live ? 'Not live' : absent ? 'Not on this patch'
                : !buf ? (t === SensorType.HeartRate || t === SensorType.SpO2 ? 'Finger on the sensor' : 'No reading')
                : null;
              return (
                <VitalTile key={t} sensor={t} value={value} sub={sub} verdict={verdict} hint={hint}
                  on={focused === t} onToggle={() => setFocus(focused === t ? null : t)} />
              );
            })}
          </div>
        )}

        <details className="live-help">
          <summary>What “Normal” means</summary>
          <p className="small muted">
            Normal is the typical adult resting range: heart rate 60–100 BPM · SpO₂ 95 % or more · skin temperature
            31–37.5 °C. Exercise, sleep and fitness move these, so treat the label as a guide, not a diagnosis. Click a
            reading to see its graph under the ECG.
          </p>
        </details>
      </div>
    </section>
  );
}

const LINK_LABEL = { bluetooth: 'Bluetooth', wifi: 'Wi-Fi', simulation: 'Simulated' } as const;

/* The patch the participant's phone is connected to: its name, how the phone reaches
   it, its firmware, and which shared signals it is sending. */
function DeviceCard({ status, phase }: { status: LiveStatus; phase: LivePhase }) {
  const link = status.link ?? (status.simulated ? 'simulation' : null);
  /* The patch's sensors (of those shared), or, from older phones, what it is streaming. */
  return (
    <div className="device-card">
      <span className="device-icon" aria-hidden><Icon name={link === 'wifi' ? 'wifi' : 'bluetooth'} size={18} /></span>
      <div className="device-main">
        <span className="overline">Connected device</span>
        <strong>{status.device ?? 'WearWise patch'}</strong>
        <span className="small muted">
          {[link ? LINK_LABEL[link] : null, status.firmware ? `Firmware ${status.firmware}` : null].filter(Boolean).join(' · ') || 'Patch'}
        </span>
      </div>
      <div className="device-side">
        {phase === 'live' ? <Badge tone="success">Connected</Badge> : phase === 'paused' ? <Badge tone="warning">Paused</Badge> : <Badge tone="neutral">Ended</Badge>}
        {(status.sensors ?? status.signals).length > 0 && <SignalBadges types={status.sensors ?? status.signals} />}
      </div>
    </div>
  );
}

/* What happened to this viewer's recording request, in words. */
function RecordNote({ answer, name, recording, onClose }: {
  answer: RecordAnswer | 'sending' | 'no-answer' | 'failed'; name: string; recording: boolean; onClose: () => void;
}) {
  switch (answer) {
    case 'sending':
    case 'asked':
      return <Alert kind="info">{`Asking ${name} on their phone… Nothing records unless they tap Start.`}</Alert>;
    case 'started':
      return recording
        ? <Alert kind="success" onDismiss={onClose}>{`${name} started the recording. You can stop it here; it’s saved on their phone and shared with you once backed up.`}</Alert>
        : <Alert kind="info" onDismiss={onClose}>The recording has ended.</Alert>;
    case 'stopped':
      return <Alert kind="success" onDismiss={onClose}>{`Recording stopped. It’s saved on ${name}’s phone and appears under Sessions once it’s backed up.`}</Alert>;
    case 'declined':
      return <Alert kind="info" onDismiss={onClose}>{`${name} didn’t start a recording this time.`}</Alert>;
    case 'recording':
      return <Alert kind="info" onDismiss={onClose}>Their phone is already recording.</Alert>;
    case 'unavailable':
      return <Alert kind="warning" onDismiss={onClose}>Their phone can’t start a recording right now: the sensor isn’t connected, or no signals are chosen to record.</Alert>;
    case 'no-answer':
      return <Alert kind="info" onDismiss={onClose}>{`No answer from ${name}’s phone.`}</Alert>;
    default:
      return <Alert kind="error" onDismiss={onClose}>The request couldn’t be sent right now. Try again in a moment.</Alert>;
  }
}

function summary(phase: LivePhase, connection: Connection, feed: LiveFeed, name: string, endsAt: number | null): string {
  if (connection === 'revoked') return `${name} no longer shares with you, so live view has stopped.`;
  if (phase === 'waiting') {
    return connection === 'unavailable'
      ? 'Live view isn’t available right now. Reload the page to try again.'
      : `When ${name} switches on “Live view for setup” in the WearWise app, their readings appear here as they happen. Nothing is stored.`;
  }
  if (phase === 'paused') {
    return `No readings from ${name}’s phone right now. Live view pauses while WearWise isn’t open on their phone and picks up again when they open it${endsAt ? ` (it stays on until ${formatClock(endsAt)})` : ''}.`;
  }
  if (phase === 'live') {
    const device = feed.status?.device;
    return `Live from their patch${device ? ` (named “${device}” on their phone)` : ''}${endsAt ? `, until ${formatClock(endsAt)}` : ''}. Nothing is stored.`;
  }
  return feed.stoppedByViewer
    ? `You stopped live view. ${name}’s phone stopped sending to you; it starts again only when they switch live view on.`
    : 'Live view has ended. The last ECG strip stays here until you leave the page.';
}

/* What to say over the ECG paper instead of a trace, or null to draw the trace.
   `hasSignal`: a recent strip while live; any strip once it has ended (it stays). */
function ecgHint(feed: LiveFeed, phase: LivePhase, shared: number[], name: string, hasSignal: boolean): string | null {
  if (!shared.includes(SensorType.Ecg)) return `ECG isn’t part of what ${name} shares with you.`;
  if (phase === 'waiting') return `Waiting for ${name} to switch on live view.`;
  if (phase === 'paused') return 'Paused — waiting for their phone.';
  /* Ended: keep the last strip, unless it was only the flat line of loose electrodes. */
  if (phase === 'ended') return hasSignal && !feed.leadsOff.get(SensorType.Ecg) ? null : 'Live view has ended.';
  if (feed.leadsOff.get(SensorType.Ecg)) return 'Electrodes not attached — all three pads need to be on the skin.';
  if (feed.status?.sensors && !feed.status.sensors.includes(SensorType.Ecg)) return 'Their patch has no ECG.';
  if (feed.status && !feed.status.signals.includes(SensorType.Ecg) && !hasSignal) return 'No ECG from their patch.';
  return hasSignal ? null : 'Waiting for the ECG signal…';
}

/* A sound and a browser notification for a fall that needs someone, as for alerts
   (AlertsProvider): no names or readings, since a notification can show on a shared or
   locked screen. */
function alarm(f: LiveFall, prefs: { sound: boolean; notify: string }): void {
  if (prefs.sound) playChime('fall');
  if (prefs.notify !== 'on' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(f.state === 'raised' ? 'WearWise: Fall alarm raised' : 'WearWise: Fall detected', {
    body: 'During live view, for a participant who shares with you. Open WearWise to see who.',
    tag: `live-fall-${f.at}`, icon: '/favicon.svg', requireInteraction: true,
  });
  n.onclick = () => { window.focus(); n.close(); };
}

function FallBanner({ fall, name, at, onClose }: { fall: LiveFall; name: string; at: number; onClose: () => void }) {
  const when = formatClock(at);
  const impact = `impact ${fall.impactG.toFixed(1)} g`;
  switch (fall.state) {
    case 'detected':
      return (
        <Alert kind="error" title={`Fall detected at ${when}`} onDismiss={onClose}>
          {`The alarm on ${name}’s phone is counting down (${impact}). They can answer “I’m OK”; if nobody does, the alarm is raised.`}
        </Alert>
      );
    case 'raised':
      return (
        <Alert kind="error" title={`Fall at ${when}: nobody answered`} onDismiss={onClose}>
          {`The alarm on ${name}’s phone is raised (${impact}). Check on them.`}
        </Alert>
      );
    case 'ok':
      return <Alert kind="success" title={`Fall at ${when}: they’re OK`} onDismiss={onClose}>{`${name} tapped “I’m OK” (${impact}).`}</Alert>;
    default:
      return <Alert kind="info" title={`Fall at ${when}: alarm closed`} onDismiss={onClose}>{`The raised alarm was closed on ${name}’s phone.`}</Alert>;
  }
}

/** The ECG strip on ECG paper: one large square = 0.2 s, five small squares each, square
 *  both ways, as on the phone. The trace autoscales (the patch isn't calibrated in mV). */
function EcgCard({ feed, running, hint }: { feed: LiveFeed; running: boolean; hint: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const palette = usePalette();
  const showTrace = hint == null;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let frame = 0;
    let lo = 0, hi = 1, scaled = false;
    const draw = () => {
      const ctx = fitCanvas(el);
      if (!ctx) return;
      const w = el.clientWidth, h = el.clientHeight;
      const major = w / (ECG_WINDOW_MS / 200);
      const minor = major / 5;
      for (const [every, alpha, width] of [[1, 0.18, 0.5], [5, 0.38, 1]] as const) {
        ctx.strokeStyle = palette.wwDataHeart;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i * minor <= w + 0.5; i++) if (i % every === 0 && (every === 5 || i % 5 !== 0)) { ctx.moveTo(i * minor, 0); ctx.lineTo(i * minor, h); }
        for (let i = 0; h - i * minor >= -0.5; i++) if (i % every === 0 && (every === 5 || i % 5 !== 0)) { ctx.moveTo(0, h - i * minor); ctx.lineTo(w, h - i * minor); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const buf = feed.buffers.get(SensorType.Ecg);
      const end = running ? feed.phoneNow(Date.now()) - DRAW_LAG_MS : (buf?.latest?.t ?? 0);
      const { t, v } = showTrace && buf ? buf.range(end - ECG_WINDOW_MS, end) : { t: [], v: [] };
      if (v.length > 1) {
        let min = Infinity, max = -Infinity;
        for (const x of v) { if (x < min) min = x; if (x > max) max = x; }
        const pad = (max - min) * 0.15 || Math.abs(max) * 0.05 || 1;
        const k = scaled ? 0.1 : 1;   // ease the scale so the trace doesn't jump with every beat
        lo += k * (min - pad - lo); hi += k * (max + pad - hi); scaled = true;
        ctx.strokeStyle = palette.textHeading;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < v.length; i++) {
          const x = ((t[i]! - (end - ECG_WINDOW_MS)) / ECG_WINDOW_MS) * w;
          const y = h - ((v[i]! - lo) / (hi - lo || 1)) * h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      if (running) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [feed, running, palette, showTrace]);

  return (
    <div className="card live-panel">
      <div className="live-head">
        <span style={{ color: 'var(--ww-data-ecg)' }}><Icon name="activity" size={16} /></span>
        <span className="live-name">ECG</span>
        {running && showTrace && <span className="live-dot live-dot-ecg" aria-hidden />}
        <span className="micro">3 s</span>
      </div>
      <div className="ecg-paper">
        <canvas ref={canvas} role="img" aria-label="ECG, live strip of the last 3 seconds" />
        {hint && <p className="ecg-hint">{hint}</p>}
      </div>
    </div>
  );
}

function VitalTile({ sensor, value, sub, verdict, hint, on, onToggle }: {
  sensor: number; value: string; sub: string | null; verdict: VitalStatus | null; hint: string | null; on: boolean; onToggle: () => void;
}) {
  const meta = signalMeta(sensor);
  const hasValue = value !== '—';
  const movement = sensor === SensorType.Accelerometer;
  return (
    <button type="button" className="vital-tile" aria-pressed={on} onClick={onToggle}
      style={{ ['--tile' as string]: `var(${cssVarName(meta.token)})` }}
      aria-label={`${meta.label}: ${hasValue ? `${value}${movement ? '' : ` ${meta.unit}`}` : 'no reading'}${verdict ? `, ${STATUS_LABEL[verdict]}` : ''}. ${on ? 'Hide' : 'Show'} graph.`}>
      <span className="vital-top">
        <span className="vital-icon"><Icon name={ICON[sensor] ?? 'activity'} size={14} /></span>
        <span className="overline">{TILE_NAME[sensor] ?? meta.label}</span>
        <span className={`vital-chevron${on ? ' open' : ''}`}><Icon name="chevron-down" size={14} /></span>
      </span>
      <span className={`vital-value num${movement && hasValue ? ' small-value' : ''}`}>
        {value}{!movement && hasValue && <span className="vital-unit">{meta.unit}</span>}
      </span>
      {verdict ? (
        <Badge tone={verdict === 'normal' ? 'success' : 'warning'}>{STATUS_LABEL[verdict]}</Badge>
      ) : (
        <span className="vital-sub">{sub ?? hint ?? ' '}</span>
      )}
    </button>
  );
}

/** A reading's graph: its own time window and fixed scale, gaps where there was no value. */
function FocusGraph({ feed, sensor, running, quiet, onClose }: {
  feed: LiveFeed; sensor: number; running: boolean; quiet: boolean; onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const palette = usePalette();
  const meta = signalMeta(sensor);
  const g = GRAPH[sensor]!;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let frame = 0;
    const draw = () => {
      const ctx = fitCanvas(el);
      if (!ctx) return;
      const w = el.clientWidth, h = el.clientHeight;
      const [lo, hi] = g.range;
      const y = (v: number) => h - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - 8) - 4;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      for (const tick of g.ticks) {
        ctx.strokeStyle = palette.borderDefault;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(0, Math.round(y(tick)) + 0.5); ctx.lineTo(w, Math.round(y(tick)) + 0.5); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = palette.textMuted;
        /* Above its line, or below it when there is no room (the top tick). */
        const above = y(tick) > 14;
        ctx.textBaseline = above ? 'bottom' : 'top';
        ctx.fillText(String(tick), w - 2, y(tick) + (above ? -2 : 2));
      }
      const buf = feed.buffers.get(sensor);
      const end = running ? feed.phoneNow(Date.now()) - DRAW_LAG_MS : (buf?.latest?.t ?? 0);
      const { t, v } = buf ? buf.range(end - g.windowMs, end) : { t: [], v: [] };
      ctx.strokeStyle = palette[meta.token];
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < v.length; i++) {
        const x = ((t[i]! - (end - g.windowMs)) / g.windowMs) * w;
        /* A gap (finger lifted, no reading) breaks the line rather than bridging it. */
        if (i === 0 || t[i]! - t[i - 1]! > STALE_MS) ctx.moveTo(x, y(v[i]!)); else ctx.lineTo(x, y(v[i]!));
      }
      ctx.stroke();
      if (running) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [feed, sensor, running, palette, meta.token, g]);

  return (
    <div className="card live-panel">
      <div className="live-head">
        <span style={{ color: `var(${cssVarName(meta.token)})` }}><Icon name={ICON[sensor] ?? 'activity'} size={16} /></span>
        <span className="live-name">{g.title}</span>
        <span className="micro">last {g.windowMs / 1000} s, {meta.unit}</span>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label={`Hide ${meta.label} graph`}><Icon name="x" size={14} /></button>
      </div>
      <canvas ref={canvas} className="focus-canvas" role="img" aria-label={`${meta.label}, live graph of the last ${g.windowMs / 1000} seconds`} />
      {quiet && <p className="small muted">{running ? 'No reading right now.' : 'Not live.'}</p>}
    </div>
  );
}

/** Sizes a canvas to its box at the screen's pixel ratio and clears it. */
function fitCanvas(el: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = el.clientWidth, h = el.clientHeight;
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}
