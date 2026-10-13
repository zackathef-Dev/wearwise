import React from 'react';
import { View, Text } from 'react-native';
import { Canvas, Path, Skia, LinearGradient, vec, Circle, DashPathEffect, usePathValue, type SkPath } from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue } from 'react-native-reanimated';
import { useTheme } from '@/shared/theme/ThemeProvider';

/* Thin-line sensor trace on Skia — the RN counterpart of the design system's
 * SignalChart (brand guide §20: 2px line, faint gridlines, no axis boxes, current
 * value at the head of the trace).
 *
 * The waveform is built ON THE UI THREAD, not in React. The JS thread's only job
 * per frame is to copy the sample array into a shared value; `usePathValue` then
 * rebuilds the line/area path inside a worklet on the UI thread and Skia redraws
 * there. The path rebuilds only when the sample array changes (i.e. on new data),
 * so the trace slides smoothly at packet cadence — no per-frame animation to fight
 * with, which is what kept it glitch-free. `usePathValue` reuses one native path.
 *
 * NO SIGNAL is drawn, not left blank: wherever there is no reading — a finger lifted,
 * the patch off, the link down — the trace drops to a DOTTED line along zero (the
 * bottom of the axis when zero is below it) and climbs back when readings return. So
 * the line never just breaks off, and a gap reads as "no signal", never as a value.
 * In time mode a gap is any stretch longer than `gapMs` without a sample; in index
 * mode (`noSignal`) the whole trace is the dotted baseline.
 *
 * Omit `min`/`max` to autoscale to the visible data (waveforms fill the height); pass
 * them to pin the range (scalars don't jump as values wander).
 */

export interface SignalTraceProps {
  data: readonly number[];
  color: string;
  height?: number;
  /* Fixed range keeps the trace from re-scaling as values wander; omit to autoscale. */
  min?: number;
  max?: number;
  fill?: boolean;
  gridlines?: number;
  /* TIME MODE (optional): arrival time (ms) per sample, plus the window end and span.
     When supplied, samples are placed on a real time axis — the trace advances as
     `nowMs` moves. Used for gappy low-rate streams (HR/SpO₂/temperature), whose samples
     are NOT evenly spaced. Omit for continuous streams, where sample index is already
     proportional to time. */
  timestamps?: readonly number[];
  nowMs?: number;
  windowMs?: number;
  /* Time mode: no sample for longer than this = no signal (dotted baseline). */
  gapMs?: number;
  /* Index mode: the stream has no signal right now — draw the dotted baseline. */
  noSignal?: boolean;
  /* Value-axis ticks (in the signal's own units). When given with a fixed min/max, the
     gridlines are drawn AT these values and labelled, so the reader can see where a
     reading sits in its physiological range instead of guessing from a bare line. */
  ticks?: readonly number[];
}

const PAD = 6;

export function SignalTrace({ data, color, height = 140, min, max, fill = true, gridlines = 3,
                             timestamps, nowMs, windowMs, gapMs, noSignal, ticks }: SignalTraceProps) {
  const { colors } = useTheme();
  const [width, setWidth] = React.useState(0);

  const timeAxis = !!timestamps && nowMs != null && windowMs != null && windowMs > 0;
  const timed = timeAxis && timestamps!.length === data.length;

  /* Props → shared values. `points` changes when new data arrives; `cfg` on resize,
     range, or the slow time tick. Deliberately NOT driven by a per-frame clock: an
     animation loop fighting burst-arriving data is what made an earlier version glitch
     and cut the line mid-path. Redraws happen on data or on the caller's ~2 Hz tick. */
  const points = useSharedValue<number[]>([]);
  const times = useSharedValue<number[]>([]);
  const cfg = useSharedValue({ w: 0, h: height, lo: min ?? 0, hi: max ?? 1, auto: min == null || max == null,
    timed: false, now: 0, win: 1, gap: 0, quiet: false });

  React.useEffect(() => { points.value = data as number[]; }, [data, points]);
  React.useEffect(() => { times.value = (timed ? timestamps : []) as number[]; }, [timed, timestamps, times]);
  React.useEffect(() => {
    cfg.value = { w: width, h: height, lo: min ?? 0, hi: max ?? 1, auto: min == null || max == null,
      timed, now: nowMs ?? 0, win: windowMs ?? 1, gap: gapMs ?? 0, quiet: !!noSignal };
  }, [width, height, min, max, timed, nowMs, windowMs, gapMs, noSignal, cfg]);

  /* Solid line: the readings. In time mode it is split wherever a gap is longer than
     `gap`, so it never draws a straight bridge across a stretch with no signal. */
  const linePath = usePathValue((path) => {
    'worklet';
    const d = points.value; const c = cfg.value; const t = times.value;
    if (!c.w || c.quiet || d.length < 1) return;
    let lo = c.lo, hi = c.hi;
    if (c.auto) { lo = d[0]!; hi = d[0]!; for (let i = 1; i < d.length; i++) { const v = d[i]!; if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = (hi - lo) || 1;
    const yOf = (v: number) => c.h - PAD - ((v - lo) / span) * (c.h - PAD * 2);
    if (c.timed && t.length === d.length) {
      /* x from real time: right edge = now, left edge = now − window. Samples older
         than the window are skipped, so the line scrolls off as time passes. */
      const pxPerMs = c.w / c.win;
      let started = false; let prevT = 0;
      for (let i = 0; i < d.length; i++) {
        const x = c.w - (c.now - t[i]!) * pxPerMs;
        if (x < 0) continue;
        const broken = c.gap > 0 && started && t[i]! - prevT > c.gap;
        if (!started || broken) { path.moveTo(x, yOf(d[i]!)); started = true; } else path.lineTo(x, yOf(d[i]!));
        prevT = t[i]!;
      }
      return;
    }
    if (d.length < 2) return;
    const stepX = c.w / (d.length - 1);
    path.moveTo(0, yOf(d[0]!));
    for (let i = 1; i < d.length; i++) path.lineTo(i * stepX, yOf(d[i]!));
  });

  /* Fill under each solid segment only — never under a no-signal stretch. */
  const areaPath = usePathValue((path) => {
    'worklet';
    const d = points.value; const c = cfg.value; const t = times.value;
    if (!c.w || c.quiet || d.length < 2) return;
    let lo = c.lo, hi = c.hi;
    if (c.auto) { lo = d[0]!; hi = d[0]!; for (let i = 1; i < d.length; i++) { const v = d[i]!; if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = (hi - lo) || 1;
    const yOf = (v: number) => c.h - PAD - ((v - lo) / span) * (c.h - PAD * 2);
    if (c.timed && t.length === d.length) {
      const pxPerMs = c.w / c.win;
      let open = false, firstX = 0, lastX = 0, prevT = 0;
      for (let i = 0; i < d.length; i++) {
        const x = c.w - (c.now - t[i]!) * pxPerMs;
        if (x < 0) continue;
        const broken = c.gap > 0 && open && t[i]! - prevT > c.gap;
        if (broken) { path.lineTo(lastX, c.h); path.lineTo(firstX, c.h); path.close(); open = false; }
        if (!open) { path.moveTo(x, yOf(d[i]!)); open = true; firstX = x; } else path.lineTo(x, yOf(d[i]!));
        lastX = x; prevT = t[i]!;
      }
      if (open) { path.lineTo(lastX, c.h); path.lineTo(firstX, c.h); path.close(); }
      return;
    }
    const stepX = c.w / (d.length - 1);
    path.moveTo(0, yOf(d[0]!));
    for (let i = 1; i < d.length; i++) path.lineTo(i * stepX, yOf(d[i]!));
    path.lineTo(c.w, c.h); path.lineTo(0, c.h); path.close();
  });

  /* Dotted no-signal line: along zero (the axis bottom when zero is below the range),
     with dotted drops from the last reading and climbs to the next, so the trace is one
     continuous line from edge to edge. */
  const gapPath = usePathValue((path) => {
    'worklet';
    const d = points.value; const c = cfg.value; const t = times.value;
    if (!c.w) return;
    let lo = c.lo, hi = c.hi;
    if (c.auto && d.length) { lo = d[0]!; hi = d[0]!; for (let i = 1; i < d.length; i++) { const v = d[i]!; if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = (hi - lo) || 1;
    const yOf = (v: number) => c.h - PAD - ((v - lo) / span) * (c.h - PAD * 2);
    const zero = 0 < lo ? lo : 0 > hi ? hi : 0;
    const base = yOf(zero);
    if (c.quiet || (!c.timed && d.length < 2)) { path.moveTo(0, base); path.lineTo(c.w, base); return; }
    if (!c.timed || c.gap <= 0) return;
    const pxPerMs = c.w / c.win;
    const winStart = c.now - c.win;
    let prevT = winStart, prevX = 0, prevY = base, any = false;
    for (let i = 0; i < d.length; i++) {
      if (t[i]! < winStart) continue;
      const x = c.w - (c.now - t[i]!) * pxPerMs, y = yOf(d[i]!);
      if (t[i]! - prevT > c.gap) {
        /* drop from the previous reading (or start at the left edge), run along zero,
           climb to this reading */
        path.moveTo(prevX, any ? prevY : base);
        if (any) path.lineTo(prevX, base);
        path.lineTo(x, base);
        path.lineTo(x, y);
      }
      prevT = t[i]!; prevX = x; prevY = y; any = true;
    }
    if (c.now - prevT > c.gap) {               /* nothing recently: down and along to now */
      path.moveTo(prevX, any ? prevY : base);
      if (any) path.lineTo(prevX, base);
      path.lineTo(c.w, base);
    }
  });

  /* Head marker, also on the UI thread. Hidden while there is no signal; in time mode
     it rides the newest sample's real x position otherwise. */
  const headY = useDerivedValue(() => {
    'worklet';
    const d = points.value; const c = cfg.value;
    if (!c.w || c.quiet || d.length < 2) return -10;
    let lo = c.lo, hi = c.hi;
    if (c.auto) { lo = d[0]!; hi = d[0]!; for (let i = 1; i < d.length; i++) { const v = d[i]!; if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = (hi - lo) || 1;
    return c.h - PAD - ((d[d.length - 1]! - lo) / span) * (c.h - PAD * 2);
  });
  const headX = useDerivedValue(() => {
    'worklet';
    const d = points.value; const c = cfg.value; const t = times.value;
    if (!c.w || c.quiet || d.length < 2) return -10;
    if (c.timed && t.length === d.length) {
      if (c.gap > 0 && c.now - t[t.length - 1]! > c.gap) return -10;
      const x = c.w - (c.now - t[t.length - 1]!) * (c.w / c.win);
      return x < 0 ? -10 : x;
    }
    return c.w;
  });

  /* Pixel y for a value on a FIXED axis (same mapping the worklets use). */
  const yOfValue = React.useCallback((v: number) => {
    const lo = min ?? 0, hi = max ?? 1;
    const span = (hi - lo) || 1;
    return height - PAD - ((v - lo) / span) * (height - PAD * 2);
  }, [min, max, height]);

  /* Labelled ticks only make sense on a fixed axis — an autoscaled one would relabel
     itself every frame. Falls back to evenly spaced unlabelled gridlines. */
  const labelled = !!ticks && ticks.length > 0 && min != null && max != null;

  /* Gridlines are static (size only) — built once. */
  const gridPaths = React.useMemo(() => {
    if (!width) return [] as SkPath[];
    if (labelled) {
      return ticks!.map((v) => {
        const gy = yOfValue(v);
        return Skia.PathBuilder.Make().moveTo(0, gy).lineTo(width, gy).detach();
      });
    }
    return Array.from({ length: gridlines }).map((_, i) => {
      const gy = (height / (gridlines + 1)) * (i + 1);
      return Skia.PathBuilder.Make().moveTo(0, gy).lineTo(width, gy).detach();
    });
  }, [width, height, gridlines, labelled, ticks, yOfValue]);

  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Canvas style={{ width, height }}>
          {gridPaths.map((g, i) => (
            <Path key={i} path={g} color={colors.borderDefault} style="stroke" strokeWidth={1} />
          ))}
          {fill && (
            <Path path={areaPath}>
              <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[withAlpha(color, 0.18), withAlpha(color, 0)]} />
            </Path>
          )}
          <Path path={gapPath} color={withAlpha(color, 0.6)} style="stroke" strokeWidth={1.5} strokeCap="round">
            <DashPathEffect intervals={[2, 5]} />
          </Path>
          <Path path={linePath} color={color} style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" />
          <Circle cx={headX} cy={headY} r={3.5} color={color} />
        </Canvas>
      )}
      {/* Axis labels as RN text rather than Skia glyphs: no font asset to load, and it
          keeps the worklet path (the hot one) untouched. */}
      {width > 0 && labelled && ticks!.map((v) => {
        const y = yOfValue(v);
        if (y < 0 || y > height) return null;
        return (
          <Text key={v} allowFontScaling={false}
            style={{ position: 'absolute', left: 2, top: Math.min(height - 12, Math.max(0, y - 6)),
              fontSize: 9, lineHeight: 12, color: colors.textMuted }}>
            {v}
          </Text>
        );
      })}
    </View>
  );
}

/* Tokens are #RRGGBB; Skia wants a colour string with alpha. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})`;
}
