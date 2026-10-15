import React from 'react';
import { View, LayoutAnimation, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming, type LayoutAnimation as EnterAnimation, type SharedValue,
} from 'react-native-reanimated';
import { motion } from '@wearwise/design-tokens';
import { Icon } from '@/shared/icons/Icon';
import { ringFrame, revealShift } from '@/shared/motion-math';

/* The few ways the app moves, so every screen moves the same way.
 *
 * Rules every primitive here follows:
 *  - It explains a state change (linking, linked, data arriving, opened) and is still
 *    otherwise. Loops run only while a process is genuinely in progress and stop
 *    when it ends — or when the component unmounts (useSharedValue cancels its
 *    animation then).
 *  - UI thread only: Reanimated shared values driving transform / opacity. No
 *    per-frame React renders, no layout per frame.
 *  - Reduced motion: nothing moves, but the state still changes at once — colour,
 *    glyph and words carry it. Read with useReducedMotion(), a synchronous constant,
 *    so there is no first-frame flash while an async check resolves.
 */

export const EASE_OUT = Easing.bezier(...motion.easeOut);
export const EASE_IN_OUT = Easing.bezier(...motion.easeInOut);

/* ~1.2 s a breath: calm, but quicker than an idle pulse so it reads as "working". */
const BREATH_HALF_MS = 600;
/* The connected heartbeat — the same beat the splash pings out of the logo. */
const BEAT_MS = 750;
/* Searching ripple: one ring every RIPPLE_MS / RIPPLE_RINGS. */
const RIPPLE_MS = 1800;
const RIPPLE_RINGS = 2;

/* ---- Breathe: opacity (and optionally scale) breathing while `active` ---- */
export function Breathe({ active, dim = 0.35, shrink = 1, style, children }: {
  active: boolean;
  dim?: number;      // opacity at the bottom of a breath
  shrink?: number;   // scale at the bottom of a breath (1 = no scaling)
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0); // 0 = at rest, 1 = bottom of a breath
  React.useEffect(() => {
    if (!active || reduced) return;
    p.set(withRepeat(withTiming(1, { duration: BREATH_HALF_MS, easing: EASE_IN_OUT }), -1, true));
    /* Done linking: settle back to rest rather than freezing mid-breath. */
    return () => p.set(withTiming(0, { duration: motion.durFast, easing: EASE_OUT }));
  }, [active, reduced, p]);
  const anim = useAnimatedStyle(() => {
    const k = p.get();
    return { opacity: 1 - k * (1 - dim), transform: [{ scale: 1 - k * (1 - shrink) }] };
  });
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/* ---- Halo: rings out of a box ----
 * `beat`: ONE ring when it turns true (just connected) — never on mount, never loops.
 * `searching`: rings keep rippling out while true (scanning), and fade away when it
 *   ends. The rings sit behind `children`, the same size, scaled from the centre. */
export function Halo({ size, color, beat = false, searching = false, spread = 2, ringWidth = 2, style, children }: {
  size: number;
  color: string;
  beat?: boolean;
  searching?: boolean;
  spread?: number;    // ring scale at the end of its run
  ringWidth?: number; // 0 = a filled disc (reads better than an outline on a tiny dot)
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const b = useSharedValue(0);
  const was = React.useRef(beat);
  React.useEffect(() => {
    const rising = beat && !was.current;
    was.current = beat;
    if (!rising || reduced) return;
    b.set(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: BEAT_MS, easing: EASE_OUT })));
  }, [beat, reduced, b]);

  const ring: ViewStyle = {
    position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: size / 2,
    ...(ringWidth > 0 ? { borderWidth: ringWidth, borderColor: color } : { backgroundColor: color }),
  };
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {searching && !reduced && (
        <Animated.View pointerEvents="none" exiting={RIPPLE_OUT} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}>
          {Array.from({ length: RIPPLE_RINGS }, (_, i) => (
            <RippleRing key={i} delay={(i * RIPPLE_MS) / RIPPLE_RINGS} ring={ring} spread={spread} />
          ))}
        </Animated.View>
      )}
      {!reduced && <BeatRing progress={b} ring={ring} spread={spread} />}
      {children}
    </View>
  );
}

const RIPPLE_OUT = FadeOut.duration(motion.durBase);

function BeatRing({ progress, ring, spread }: { progress: SharedValue<number>; ring: ViewStyle; spread: number }) {
  const anim = useAnimatedStyle(() => {
    const f = ringFrame(progress.get(), spread, 0.6);
    return { opacity: f.opacity, transform: [{ scale: f.scale }] };
  });
  return <Animated.View pointerEvents="none" style={[ring, anim]} />;
}

/* Mounted only while searching; its loop dies with it. */
function RippleRing({ delay, ring, spread }: { delay: number; ring: ViewStyle; spread: number }) {
  const k = useSharedValue(0);
  React.useEffect(() => {
    k.set(withDelay(delay, withRepeat(withTiming(1, { duration: RIPPLE_MS, easing: EASE_OUT }), -1, false)));
  }, [delay, k]);
  const anim = useAnimatedStyle(() => {
    const f = ringFrame(k.get(), spread, 0.45);
    return { opacity: f.opacity, transform: [{ scale: f.scale }] };
  });
  return <Animated.View style={[ring, anim]} />;
}

/* ---- Spin: turns its content while mounted (a loader glyph during real work) ----
 * Mount it only for the duration of the work, so it never stops at a stray angle. */
export function Spin({ period = 1000, children }: { period?: number; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const r = useSharedValue(0);
  React.useEffect(() => {
    if (reduced) return;
    r.set(withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false));
  }, [reduced, period, r]);
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.get() * 360}deg` }] }));
  return <Animated.View style={anim}>{children}</Animated.View>;
}

/* ---- Disclosure: a chevron that turns right → down, instead of swapping glyphs ---- */
export function Disclosure({ open, size = 16, color }: { open: boolean; size?: number; color?: string }) {
  const reduced = useReducedMotion();
  const a = useSharedValue(open ? 1 : 0);
  React.useEffect(() => {
    const to = open ? 1 : 0;
    a.set(reduced ? to : withTiming(to, { duration: motion.durBase, easing: EASE_IN_OUT }));
  }, [open, reduced, a]);
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${a.get() * 90}deg` }] }));
  return <Animated.View style={anim}><Icon name="chevron-right" size={size} color={color} /></Animated.View>;
}

/* ---- DrawIn: a chart draws itself left → right when new data lands ----
 * Plays each time `playKey` changes to something non-null (a new data set), never on
 * a plain re-render. Pure transforms on a wrapper (see revealShift), so the chart's
 * own render path is untouched. Width lives in a shared value: a relayout must not
 * replay the reveal. */
export function DrawIn({ playKey, style, children }: { playKey: unknown; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const width = useSharedValue(0);
  const p = useSharedValue(1); // 1 = fully drawn
  React.useEffect(() => {
    if (reduced || playKey == null) return;
    p.set(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: motion.durReveal, easing: EASE_OUT })));
  }, [playKey, reduced, p]);
  const clip = useAnimatedStyle(() => ({ transform: [{ translateX: -revealShift(width.get(), p.get()) }] }));
  const content = useAnimatedStyle(() => ({ transform: [{ translateX: revealShift(width.get(), p.get()) }] }));
  if (reduced) return <View style={style}>{children}</View>;
  return (
    <Animated.View style={[{ overflow: 'hidden' }, style, clip]} onLayout={(e) => width.set(e.nativeEvent.layout.width)}>
      <Animated.View style={content}>{children}</Animated.View>
    </Animated.View>
  );
}

/* ---- Expand / collapse in place ----
 * Content that opens and pushes everything below it (Collapsible, a tile's graph) uses
 * the native layout animation: it runs natively (no JS per frame) and glides every
 * sibling below together — per-view transitions would leave some jumping and others
 * gliding. Call the returned function right before the state change. Under reduced
 * motion it does nothing and the content simply appears. */
const EXPAND = LayoutAnimation.create(motion.durBase, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);
export function useExpandAnimation(): () => void {
  const reduced = useReducedMotion();
  return React.useCallback(() => { if (!reduced) LayoutAnimation.configureNext(EXPAND); }, [reduced]);
}

/* ---- popIn: entering animation — fade + a small scale-up, once, on mount ----
 * For a value or a status that has just appeared or changed: key the wrapper by the
 * value so a change remounts it. Callers pass `undefined` under reduced motion. */
export function popIn(from = 0.9, duration: number = motion.durEnter): () => EnterAnimation {
  return () => {
    'worklet';
    const cfg = { duration, easing: EASE_OUT };
    return {
      initialValues: { opacity: 0, transform: [{ scale: from }] },
      animations: { opacity: withTiming(1, cfg), transform: [{ scale: withTiming(1, cfg) }] },
    };
  };
}
