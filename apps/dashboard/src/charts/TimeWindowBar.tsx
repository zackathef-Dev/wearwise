import { Button } from '../components/ui';
import { formatElapsed, formatSpan } from '../data/format';
import { isWhole, panWindow, zoomWindow, type TimeWindow } from './window';

/* The one control row above the charts: it scopes every chart on the page, so a
   reader zooms once and every signal follows. */
export function TimeWindowBar({ view, domain, onChange }: {
  view: TimeWindow; domain: TimeWindow; onChange: (w: TimeWindow) => void;
}) {
  const whole = isWhole(view, domain);
  const full = domain.end - domain.start;
  const span = view.end - view.start;
  const decimals = span < 5 ? 2 : span < 60 ? 1 : 0;
  const atStart = view.start <= domain.start + 1e-9;
  const atEnd = view.end >= domain.end - 1e-9;

  return (
    <div className="window-bar" role="toolbar" aria-label="Time window for all charts">
      <div className="window-label">
        <span className="small muted">{whole ? 'Showing the whole session' : 'Showing'}</span>
        <strong>
          {formatElapsed(view.start, decimals)} – {formatElapsed(view.end, decimals)}
          <span className="muted" style={{ fontWeight: 400 }}> · {formatSpan(span)}{whole ? '' : ` of ${formatSpan(full)}`}</span>
        </strong>
      </div>
      <div className="window-track hide-sm" aria-hidden title="Where this window sits in the session">
        <span style={{ left: `${((view.start - domain.start) / full) * 100}%`, width: `${(span / full) * 100}%` }} />
      </div>
      <Button size="sm" icon="chevron-left" disabled={atStart} onClick={() => onChange(panWindow(view, -0.5, domain))} aria-label="Earlier">
        <span className="hide-md">Earlier</span>
      </Button>
      <Button size="sm" icon="chevron-right" disabled={atEnd} onClick={() => onChange(panWindow(view, 0.5, domain))} aria-label="Later">
        <span className="hide-md">Later</span>
      </Button>
      <Button size="sm" icon="zoom-in" onClick={() => onChange(zoomWindow(view, 0.5, domain))} aria-label="Zoom in">
        <span className="hide-md">Zoom in</span>
      </Button>
      <Button size="sm" icon="zoom-out" disabled={whole} onClick={() => onChange(zoomWindow(view, 2, domain))} aria-label="Zoom out">
        <span className="hide-md">Zoom out</span>
      </Button>
      <Button size="sm" icon="expand" disabled={whole} onClick={() => onChange(domain)}>Whole session</Button>
    </div>
  );
}
