import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Palette } from '@wearwise/design-tokens';
import { SignalChart, type FallMarker } from '../charts/SignalChart';
import { isWhole, type TimeWindow } from '../charts/window';
import { Button, ErrorState } from '../components/ui';
import { api } from '../data/client';
import { ContainerError, unpackChannelChunks } from '../data/chunk-container';
import { csvBlob, downloadBlob, estimateCsvBytes, fileSlug } from '../data/csv';
import { minMaxEnvelope } from '../data/downsample';
import { formatBytes, formatCount, formatElapsed, formatRate } from '../data/format';
import { buildSeries, type SampleSeries } from '../data/series';
import type { SignalMeta } from '../data/signals';
import type { ChannelRow } from '../data/types';

/* One shared signal of a session: downloads its container from Storage, verifies
 * every chunk's CRC, decodes it, and charts it on the page's shared time window.
 *
 * The decoded samples live only in this component's state: leaving the page drops
 * them. Nothing is cached, stored or logged. A big channel (a long ECG) waits for
 * a click before downloading, so opening a session never pulls hundreds of MB.
 */

const AUTO_LOAD_BYTES = 24 * 1024 * 1024;
const LARGE_CSV_BYTES = 250 * 1024 * 1024;

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; series: SampleSeries }
  | { state: 'error'; message: string };

interface Props {
  channel: ChannelRow;
  meta: SignalMeta;
  originUs: bigint | null;
  palette: Palette;
  view: TimeWindow;
  domain: TimeWindow;
  hoverT: number | null;
  falls: FallMarker[];
  sessionStartMs: number | null;
  fileStem: string;
  onHover: (t: number | null) => void;
  onView: (w: TimeWindow | ((w: TimeWindow) => TimeWindow)) => void;
  onZoomBy: (factor: number, center: number) => void;
  onPan: (fraction: number) => void;
}

export function ChannelPanel(p: Props) {
  const { channel, meta, originUs } = p;
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [exporting, setExporting] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const alive = useRef(true);
  const request = useRef(0);
  const containerBytes = channel.sampleCount * 2;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const fetchSeries = useCallback(async () => {
    if (!api) return;
    const mine = ++request.current; // only the latest request may set state
    setLoad({ state: 'loading' });
    try {
      const bytes = await api.downloadChannel(channel.storagePath);
      const chunks = unpackChannelChunks(bytes);
      const series = buildSeries(chunks, {
        sensorType: channel.sensorType,
        sampleRateHz: channel.sampleRateHz,
        originUs: originUs ?? chunks[0]?.startedAtUs ?? 0n,
      });
      if (alive.current && mine === request.current) setLoad({ state: 'ready', series });
    } catch (e) {
      if (!alive.current || mine !== request.current) return;
      setLoad({
        state: 'error',
        message: e instanceof ContainerError
          ? 'The recording file failed its integrity check, so it isn’t shown. The upload may have been damaged; the participant’s phone still holds the original.'
          : e instanceof Error ? e.message : 'The recording could not be loaded.',
      });
    }
  }, [channel.storagePath, channel.sensorType, channel.sampleRateHz, originUs]);

  useEffect(() => {
    if (channel.sampleCount > 0 && containerBytes <= AUTO_LOAD_BYTES) void fetchSeries();
  }, [fetchSeries, channel.sampleCount, containerBytes]);

  const series = load.state === 'ready' ? load.series : null;
  const zoomed = !isWhole(p.view, p.domain);

  const exportCsv = async (windowOnly: boolean) => {
    if (!series) return;
    if (!windowOnly && estimateCsvBytes(channel.sampleCount) > LARGE_CSV_BYTES
      && !window.confirm(`This export is about ${formatBytes(estimateCsvBytes(channel.sampleCount))}. Building it may take a while and use a lot of memory. Continue?`)) {
      return;
    }
    setExporting(true);
    /* Let the button repaint as busy before the (synchronous) build starts. */
    await new Promise((r) => setTimeout(r, 30));
    try {
      const blob = csvBlob(series, { valueHeader: meta.csv, ...(windowOnly ? { tStart: p.view.start, tEnd: p.view.end } : {}) });
      const suffix = windowOnly ? `_${fileSlug(formatElapsed(p.view.start))}-${fileSlug(formatElapsed(p.view.end))}` : '';
      downloadBlob(blob, `${p.fileStem}_${meta.csv}${suffix}.csv`);
    } finally {
      setExporting(false);
    }
  };

  const tableRows = useMemo(() => {
    if (!tableOpen || !series) return [];
    const n = 24;
    const env = minMaxEnvelope(series, p.view.start, p.view.end, n);
    const step = (p.view.end - p.view.start) / n;
    const dec = step < 1 ? 2 : 0;
    return Array.from({ length: n }, (_, i) => ({
      from: formatElapsed(p.view.start + i * step, dec),
      to: formatElapsed(p.view.start + (i + 1) * step, dec),
      min: env.min[i]!, max: env.max[i]!,
    }));
  }, [tableOpen, series, p.view.start, p.view.end]);

  const key = { '--swatch': p.palette[meta.token] } as CSSProperties;

  return (
    <section className="card chart-card" aria-labelledby={`ch-${channel.id}`}>
      <div className="chart-head">
        <div className="titles">
          <h3 id={`ch-${channel.id}`}>
            <span className="chart-key" style={key} aria-hidden />{meta.label}{' '}
            <span className="muted" style={{ fontWeight: 400 }}>({meta.short !== meta.label ? `${meta.short}, ` : ''}{meta.unit})</span>
          </h3>
          <span className="small muted">{meta.about} · {formatRate(channel.sampleRateHz)} · {formatCount(channel.sampleCount)} samples</span>
        </div>
        <div className="row">
          {zoomed && (
            <Button size="sm" variant="ghost" icon="download" disabled={!series || exporting} onClick={() => void exportCsv(true)}>
              Visible window
            </Button>
          )}
          <Button size="sm" icon="download" disabled={!series} busy={exporting} onClick={() => void exportCsv(false)}>
            Download CSV
          </Button>
        </div>
      </div>

      {channel.sampleCount === 0 ? (
        <div className="state compact"><span>No samples were recorded for this signal.</span></div>
      ) : load.state === 'error' ? (
        <ErrorState title="This signal couldn’t be shown" message={load.message} onRetry={() => void fetchSeries()} />
      ) : series ? (
        <SignalChart
          series={series} meta={meta} palette={p.palette} view={p.view} hoverT={p.hoverT} falls={p.falls}
          sessionStartMs={p.sessionStartMs} onHover={p.onHover} onZoom={(w) => p.onView(w)}
          onZoomBy={p.onZoomBy} onPan={p.onPan} onReset={() => p.onView(p.domain)}
        />
      ) : (
        <div className="chart-surface">
          <div className="chart-overlay">
            {load.state === 'loading' ? (
              <span className="loading-row" role="status"><span className="spinner" aria-hidden />Downloading and checking the recording…</span>
            ) : (
              <div className="state compact">
                <span>This signal is large (about {formatBytes(containerBytes)} to download).</span>
                <Button icon="download" onClick={() => void fetchSeries()}>Load chart</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {series && (
        <div className="chart-foot">
          <details onToggle={(e) => setTableOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Table view of this window</summary>
            {tableOpen && (
              <div className="table-wrap">
                <table className="data compact">
                  <caption className="visually-hidden">{meta.label}, lowest and highest value in each slice of the visible window</caption>
                  <thead>
                    <tr><th scope="col">From</th><th scope="col">To</th><th scope="col" className="num">Lowest ({meta.unit})</th><th scope="col" className="num">Highest ({meta.unit})</th></tr>
                  </thead>
                  <tbody>
                    {tableRows.map((r) => (
                      <tr key={r.from}>
                        <td className="num" style={{ textAlign: 'left' }}>{r.from}</td>
                        <td className="num" style={{ textAlign: 'left' }}>{r.to}</td>
                        <td className="num">{Number.isNaN(r.min) ? '—' : r.min.toFixed(meta.digits + 1)}</td>
                        <td className="num">{Number.isNaN(r.max) ? '—' : r.max.toFixed(meta.digits + 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
