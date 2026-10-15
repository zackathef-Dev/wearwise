import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { layout, type Palette } from '@wearwise/design-tokens';
import {
  countInWindow, envelopeExtent, minMaxEnvelope, pointsExtent, pointsInWindow, type Envelope, type Points,
} from '../data/downsample';
import type { SampleSeries } from '../data/series';
import type { SignalMeta } from '../data/signals';
import { formatClock, formatElapsed } from '../data/format';
import { timeAxis, valueAxis, type ValueAxis } from './scale';
import type { TimeWindow } from './window';

/* One signal over the shared time window, drawn on canvas.
 *
 * Form: a single-series line on one value axis (the chart title names the series,
 * so there is no legend box). Marks follow the dataviz spec: a 2px line in the
 * signal's data colour, hairline solid grid in a one-step-off-surface grey, text in
 * text tokens (never the data colour), falls as hairline markers in the reserved
 * status colours with a word beside them.
 *
 * Density: when the window holds more samples than the plot has device pixels,
 * each pixel column shows the min-max span of its samples (downsample.ts), joined
 * to its neighbour so the trace stays continuous; a column with no samples is left
 * empty, so a real gap in the recording reads as a gap. Zoomed in past one sample
 * per pixel, the actual samples are drawn as a line, with dots once they are far
 * enough apart to see.
 *
 * Interaction: the crosshair (shared across every chart on the page) snaps to a
 * time, and a tooltip gives the value there. Drag across the plot to zoom every
 * chart to that span; double-click for the whole session. Keyboard: arrows move
 * the readout, + and − zoom, [ and ] pan, 0 resets.
 */

export interface FallMarker { id: string; t: number; status: string; impactG: number }

interface Props {
  series: SampleSeries;
  meta: SignalMeta;
  palette: Palette;
  view: TimeWindow;
  hoverT: number | null;
  falls: FallMarker[];
  sessionStartMs: number | null;
  onHover: (t: number | null) => void;
  onZoom: (w: TimeWindow) => void;
  onZoomBy: (factor: number, center: number) => void;
  onPan: (fraction: number) => void;
  onReset: () => void;
}

const PAD = { left: 62, right: 14, top: 22, bottom: 26 };
const HEIGHT = 240; // includes the x-axis band, so the card never needs its own scroll
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const FONT = layout.fontCore;

type Render =
  | { mode: 'points'; points: Points; axis: ValueAxis }
  | { mode: 'envelope'; env: Envelope; axis: ValueAxis }
  | { mode: 'empty' };

interface Readout { lo: number; hi: number; t: number; exact: boolean }

const dprNow = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);

function fmtValue(v: number, decimals: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Decimals for the elapsed-time readout, by how far in the window is zoomed. */
const timeDecimals = (span: number): number => (span < 5 ? 3 : span < 60 ? 2 : span < 600 ? 1 : 0);

export function SignalChart(props: Props) {
  const { series, meta, palette, view, hoverT, falls, sessionStartMs, onHover, onZoom, onZoomBy, onPan, onReset } = props;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [fontsTick, setFontsTick] = useState(0);
  const [selection, setSelection] = useState<{ a: number; b: number } | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const drag = useRef<{ x0: number } | null>(null);

  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) setFontsTick((n) => n + 1); });
    return () => { alive = false; };
  }, []);

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const columns = Math.max(1, Math.round(plotW * dprNow()));
  const span = view.end - view.start;

  /* The expensive part: only when the data, the window or the pixel width change. */
  const render = useMemo<Render>(() => {
    if (width === 0) return { mode: 'empty' };
    const n = countInWindow(series, view.start, view.end);
    if (n <= columns) {
      const points = pointsInWindow(series, view.start, view.end, columns * 2 + 8);
      if (points && points.t.length) {
        const ext = pointsExtent(points, view.start, view.end) ?? pointsExtent(points, -Infinity, Infinity);
        if (ext) return { mode: 'points', points, axis: valueAxis(ext[0], ext[1], series.scale) };
      }
      if (n === 0) return { mode: 'empty' };
    }
    const env = minMaxEnvelope(series, view.start, view.end, columns);
    const ext = envelopeExtent(env);
    return ext ? { mode: 'envelope', env, axis: valueAxis(ext[0], ext[1], series.scale) } : { mode: 'empty' };
  }, [series, view.start, view.end, columns, width]);

  const xOf = (t: number) => PAD.left + ((t - view.start) / span) * plotW;

  /* ------------------------------------------------------------------ draw ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = dprNow();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const baseY = PAD.top + PLOT_H;

    /* Value axis: hairline gridlines, labels in the secondary text colour. */
    ctx.font = `500 11px ${FONT}`;
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.surfaceTrack;
    ctx.fillStyle = palette.textSecondary;
    let yOf = (_v: number) => baseY;
    if (render.mode !== 'empty') {
      const { axis } = render;
      yOf = (v: number) => PAD.top + PLOT_H - ((v - axis.lo) / (axis.hi - axis.lo)) * PLOT_H;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const tick of axis.ticks) {
        const y = Math.round(yOf(tick)) + 0.5;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
        ctx.fillText(fmtValue(tick, axis.decimals), PAD.left - 8, y);
      }
    }
    /* Time axis: baseline + clock-step labels. */
    ctx.beginPath(); ctx.moveTo(PAD.left, baseY + 0.5); ctx.lineTo(PAD.left + plotW, baseY + 0.5); ctx.stroke();
    const tAxis = timeAxis(view.start, view.end, Math.max(2, Math.floor(plotW / 96)));
    ctx.textBaseline = 'alphabetic';
    for (const t of tAxis.ticks) {
      const x = xOf(t);
      ctx.textAlign = x - PAD.left < 24 ? 'left' : PAD.left + plotW - x < 24 ? 'right' : 'center';
      ctx.fillText(formatElapsed(t, tAxis.decimals), x, baseY + 17);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, baseY); ctx.lineTo(Math.round(x) + 0.5, baseY + 4); ctx.stroke();
    }

    /* Data, clipped to the plot. */
    const color = palette[meta.token];
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top - 1, plotW, PLOT_H + 2);
    ctx.clip();
    if (render.mode === 'envelope') {
      const { env } = render;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = color;
      const left = Math.round(PAD.left * dpr);
      const colW = Math.max(1, Math.round(1.5 * dpr));
      const minH = 2 * dpr;
      let prevTop = NaN;
      let prevBot = NaN;
      for (let b = 0; b < env.buckets; b++) {
        const lo = env.min[b]!;
        if (Number.isNaN(lo)) { prevTop = NaN; prevBot = NaN; continue; }
        const rawTop = yOf(env.max[b]!) * dpr;
        const rawBot = yOf(lo) * dpr;
        let top = rawTop;
        let bot = rawBot;
        /* Join to the previous column: the signal passed continuously between them. */
        if (!Number.isNaN(prevTop)) {
          if (top > prevBot) top = prevBot;
          if (bot < prevTop) bot = prevTop;
        }
        if (bot - top < minH) { const c = (top + bot) / 2; top = c - minH / 2; bot = c + minH / 2; }
        ctx.fillRect(left + b - (colW >> 1), top, colW, bot - top);
        prevTop = rawTop;
        prevBot = rawBot;
      }
    } else if (render.mode === 'points') {
      const { points } = render;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < points.t.length; i++) {
        const x = xOf(points.t[i]!);
        const y = yOf(points.v[i]!);
        if (points.breakBefore[i]) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      /* Samples far enough apart to see get a dot (r 4, 2px surface ring); a lone
         sample between gaps always does, or it would be invisible. */
      const n = points.t.length;
      const spacing = n > 1 ? plotW / Math.max(1, countInWindow(series, view.start, view.end)) : Infinity;
      for (let i = 0; i < n; i++) {
        const lone = points.breakBefore[i] === 1 && (i + 1 >= n || points.breakBefore[i + 1] === 1);
        if (!lone && spacing < 14) continue;
        const x = xOf(points.t[i]!);
        const y = yOf(points.v[i]!);
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = palette.surfaceCard; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      }
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* Falls: a hairline in the reserved status colour, a marker, and the word. */
    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let lastLabelX = -Infinity;
    for (const f of [...falls].sort((a, b) => a.t - b.t)) {
      if (f.t < view.start || f.t > view.end) continue;
      const x = Math.round(xOf(f.t)) + 0.5;
      const c = f.status === 'emergency' ? palette.stateFailed : palette.stateOffline;
      ctx.strokeStyle = c;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD.top - 4); ctx.lineTo(x, baseY); ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(x - 5, PAD.top - 13); ctx.lineTo(x + 5, PAD.top - 13); ctx.lineTo(x, PAD.top - 5); ctx.closePath(); ctx.fill();
      if (x - lastLabelX > 44) {
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText('Fall', x + 8, PAD.top - 10);
        lastLabelX = x;
      }
    }
  }, [render, width, palette, falls, view.start, view.end, span, plotW, meta.token, fontsTick, series]);

  /* ------------------------------------------------------------- readout ---- */
  const readoutAt = (t: number): Readout | null => {
    if (render.mode === 'envelope') {
      const { env } = render;
      const b = Math.min(env.buckets - 1, Math.max(0, Math.floor(((t - view.start) / span) * env.buckets)));
      const lo = env.min[b]!;
      return Number.isNaN(lo) ? null : { lo, hi: env.max[b]!, t, exact: false };
    }
    if (render.mode === 'points') {
      const { t: ts, v } = render.points;
      let a = 0;
      let z = ts.length - 1;
      while (z - a > 1) { const m = (a + z) >> 1; if (ts[m]! < t) a = m; else z = m; }
      const i = Math.abs(ts[a]! - t) <= Math.abs(ts[z]! - t) ? a : z;
      const tolerance = Math.max(series.nominalDt * 1.5, span / plotW * 8);
      if (Math.abs(ts[i]! - t) > tolerance) return null;
      return { lo: v[i]!, hi: v[i]!, t: ts[i]!, exact: true };
    }
    return null;
  };

  const inView = hoverT != null && hoverT >= view.start && hoverT <= view.end;
  const readout = inView ? readoutAt(hoverT!) : null;
  const crossX = inView ? xOf(readout?.exact ? readout.t : hoverT!) : null;
  const tipLeft = crossX != null && crossX + 200 > width;
  const readoutText = (r: Readout | null, t: number) => {
    const when = formatElapsed(t, timeDecimals(span));
    if (!r) return `${when}: no samples here`;
    const value = r.lo === r.hi ? fmtValue(r.lo, meta.digits + 1) : `${fmtValue(r.lo, meta.digits + 1)} to ${fmtValue(r.hi, meta.digits + 1)}`;
    return `${when}: ${value} ${meta.unit}`;
  };

  /* --------------------------------------------------------------- pointer ---- */
  const localX = (clientX: number) => clientX - (surfaceRef.current?.getBoundingClientRect().left ?? 0);
  const clampX = (x: number) => Math.min(PAD.left + plotW, Math.max(PAD.left, x));
  const tOfX = (x: number) => view.start + ((clampX(x) - PAD.left) / plotW) * span;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const x = localX(e.clientX);
    if (x < PAD.left || x > PAD.left + plotW) return;
    drag.current = { x0: x };
    setSelection({ a: x, b: x });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const x = localX(e.clientX);
    setKeyboard(false);
    if (drag.current) setSelection({ a: drag.current.x0, b: clampX(x) });
    if (x >= PAD.left - 4 && x <= PAD.left + plotW + 4) onHover(tOfX(x)); else if (!drag.current) onHover(null);
  };
  const endDrag = (commit: boolean) => {
    const sel = selection;
    drag.current = null;
    setSelection(null);
    if (commit && sel && Math.abs(sel.b - sel.a) >= 6) {
      onZoom({ start: tOfX(Math.min(sel.a, sel.b)), end: tOfX(Math.max(sel.a, sel.b)) });
    }
  };

  /* -------------------------------------------------------------- keyboard ---- */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const center = hoverT ?? (view.start + view.end) / 2;
    const step = span / (e.shiftKey ? 10 : 100);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': onHover(Math.max(view.start, center - step)); break;
      case 'ArrowRight': onHover(Math.min(view.end, center + step)); break;
      case '+': case '=': onZoomBy(0.5, center); break;
      case '-': case '_': onZoomBy(2, center); break;
      case '[': onPan(-0.5); break;
      case ']': onPan(0.5); break;
      case '0': case 'Home': onReset(); break;
      case 'Escape': onHover(null); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); setKeyboard(true); }
  };

  const sw = { '--swatch': palette[meta.token] } as CSSProperties;
  const hintId = `hint-${meta.csv}`;

  return (
    <div
      ref={surfaceRef}
      className="chart-surface"
      tabIndex={0}
      role="group"
      aria-roledescription="chart"
      aria-label={`${meta.label} in ${meta.unit}, from ${formatElapsed(view.start)} to ${formatElapsed(view.end)} into the session`}
      aria-describedby={hintId}
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onPointerLeave={() => { if (!drag.current) onHover(null); }}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        /* Only a keyboard focus starts the readout; a mouse click focuses too. */
        if (!e.currentTarget.matches(':focus-visible')) return;
        if (hoverT == null) onHover((view.start + view.end) / 2);
        setKeyboard(true);
      }}
      onBlur={() => { setKeyboard(false); onHover(null); }}
    >
      <canvas ref={canvasRef} aria-hidden />
      <span id={hintId} className="visually-hidden">
        Arrow keys move the readout, plus and minus zoom, square brackets move earlier or later, zero shows the whole session.
      </span>

      {render.mode === 'empty' && width > 0 && (
        <div className="chart-overlay" style={{ top: PAD.top, bottom: PAD.bottom, left: PAD.left, right: PAD.right }}>
          <span className="small muted">No samples in this part of the session</span>
        </div>
      )}

      {selection && Math.abs(selection.b - selection.a) > 0 && (
        <div
          aria-hidden
          style={{
            position: 'absolute', top: PAD.top, height: PLOT_H, left: Math.min(selection.a, selection.b),
            width: Math.abs(selection.b - selection.a), pointerEvents: 'none',
            background: 'color-mix(in srgb, var(--action-primary) 14%, transparent)',
            borderLeft: '1px solid var(--action-primary)', borderRight: '1px solid var(--action-primary)',
          }}
        />
      )}

      {crossX != null && !selection && (
        <>
          <div className="crosshair" style={{ left: Math.round(crossX), top: PAD.top, bottom: PAD.bottom }} aria-hidden />
          {readout?.exact && render.mode === 'points' && (
            <span
              aria-hidden
              style={{
                position: 'absolute', width: 10, height: 10, borderRadius: '50%', pointerEvents: 'none',
                left: crossX - 5,
                top: PAD.top + PLOT_H - ((readout.lo - render.axis.lo) / (render.axis.hi - render.axis.lo)) * PLOT_H - 5,
                background: palette[meta.token], boxShadow: `0 0 0 2px ${palette.surfaceCard}`,
              }}
            />
          )}
          <div
            className="chart-tip" aria-hidden
            style={{ left: tipLeft ? crossX - 12 : crossX + 12, top: PAD.top, transform: tipLeft ? 'translateX(-100%)' : undefined }}
          >
            {readout ? (
              <span className="tip-value">
                {readout.lo === readout.hi
                  ? fmtValue(readout.lo, meta.digits + 1)
                  : `${fmtValue(readout.lo, meta.digits + 1)} – ${fmtValue(readout.hi, meta.digits + 1)}`}{' '}
                <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{meta.unit}</span>
              </span>
            ) : <span className="tip-value muted" style={{ fontSize: 12 }}>No samples here</span>}
            <span className="tip-time"><span className="tip-key" style={sw} />{meta.short}{readout && readout.lo !== readout.hi ? ', range in this pixel' : ''}</span>
            <span className="tip-time">
              {formatElapsed(readout?.exact ? readout.t : hoverT!, timeDecimals(span))} into session
              {sessionStartMs != null && <> · ≈ {formatClock(sessionStartMs + (readout?.exact ? readout.t : hoverT!) * 1000)}</>}
            </span>
          </div>
        </>
      )}

      {keyboard && hoverT != null && (
        <span className="visually-hidden" aria-live="polite">{readoutText(readout, hoverT)}</span>
      )}
    </div>
  );
}
