import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { lightColors, motion } from '@wearwise/design-tokens';

/* Startup logo reveal, drawn over the app while it boots.
 *
 * The W in the WearWise logo is a pulse trace ending in a node, so the reveal
 * tells that story with the logo exactly as shipped (the PNG is never redrawn):
 *   1. trace — a soft edge sweeps left → right across the logo, like an ECG being
 *      drawn, while it fades in and scales 0.85 → 1.0;
 *   2. beat — as the sweep passes the node, one soft teal ring pings out of it;
 *   3. hold, then the logo eases forward (1.0 → 1.05) as the splash dissolves.
 * Everything runs on the UI thread (Reanimated) — transforms and opacity only.
 *
 * The native splash is the same navy with a transparent image (app.config.ts), so
 * swapping it for this view is invisible. The app mounts and routes underneath;
 * this view leaves once the caller says the first real screen is ready, and gives
 * up waiting after maxWait so nobody is ever stuck on it.
 *
 * Plays once per JS start (a cold launch): returning from the background or
 * navigating never remounts it, and `hasPlayed()` guards a remounted root.
 */

/* ---- timing (ms) — the knobs to adjust ---- */
export const SPLASH_TIMING = {
  reveal: 700,     // trace sweep + fade in + scale 0.85 → 1
  beatDelay: 300,  // from the start of the reveal: the sweep reaches the node here
  beat: 750,       // ring grows and fades
  hold: 450,       // after the reveal: logo complete, still
  exit: 420,       // logo eases forward while the splash fades into the app
  /* Reduced motion: no sweep, beat or scaling — a short fade in and out. */
  reducedReveal: motion.durBase,
  reducedHold: 300,
  reducedExit: motion.durBase,
  /* The reveal waits for the first screen to mount underneath (so the two don't
     compete for frames), but never longer than this after the splash is up. */
  mountGrace: 450,
  /* If the logo never reports it has loaded, go ahead after this long anyway. */
  noLoad: 1500,
  /* Safety net from mount: finish even if the app never reports ready. */
  maxWait: 4000,
} as const;

const START_SCALE = 0.85;
const EXIT_SCALE = 1.05;
const NAVY = lightColors.wwNavy; // the native splash background (app.config.ts)
const TEAL = lightColors.wwTeal;
const LOGO = require('@/assets/brand/wearwise-logo-white.png');
/* Measured from the asset itself (660 × 180): its proportions and the node dot. */
const LOGO_W = 660;
const LOGO_H = 180;
const NODE = { x: 144.8, y: 65.1, r: 19.5 };

let played = false;
export const hasPlayed = (): boolean => played;

export function AnimatedSplashScreen({ appReady, onFinished }: {
  /** true once the first real screen is mounted and routed */
  appReady: boolean;
  onFinished: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const logoWidth = Math.min(240, Math.round(width * 0.6));
  const logoHeight = Math.round((logoWidth * LOGO_H) / LOGO_W);
  const k = logoWidth / LOGO_W;
  const node = { x: NODE.x * k, y: NODE.y * k, d: NODE.r * 2 * k };
  const feather = Math.round(logoWidth * 0.22); // soft edge of the trace

  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(reduceMotion ? 1 : START_SCALE);
  const sweep = useSharedValue(reduceMotion ? 1 : 0);   // 0 = logo hidden, 1 = fully revealed
  const beat = useSharedValue(0);
  const splashOpacity = useSharedValue(1);

  const [laidOut, setLaidOut] = React.useState(false);
  const [logoLoaded, setLogoLoaded] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);
  const [timedOut, setTimedOut] = React.useState(false);
  const [graceOver, setGraceOver] = React.useState(false);
  const finished = React.useRef(false);
  const revealStarted = React.useRef(false);
  const holdTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reveal = reduceMotion ? SPLASH_TIMING.reducedReveal : SPLASH_TIMING.reveal;
  const hold = reduceMotion ? SPLASH_TIMING.reducedHold : SPLASH_TIMING.hold;
  const exit = reduceMotion ? SPLASH_TIMING.reducedExit : SPLASH_TIMING.exit;

  const onLayout = React.useCallback(() => { if (!laidOut) setLaidOut(true); }, [laidOut]);

  React.useEffect(() => {
    const cap = setTimeout(() => setTimedOut(true), SPLASH_TIMING.maxWait);
    /* If the image never reports loading, carry on rather than hold the splash.
       Kept long: going early is exactly what showed black on a slow Android start —
       the native splash went before this view had been drawn. */
    const noLoad = setTimeout(() => setLogoLoaded(true), SPLASH_TIMING.noLoad);
    const grace = setTimeout(() => setGraceOver(true), SPLASH_TIMING.mountGrace);
    return () => { clearTimeout(cap); clearTimeout(noLoad); clearTimeout(grace); };
  }, []);

  /* Reveal once the view is up AND the logo is decoded, so the whole sequence is
     seen; the hold is timed from here, not from mount. (onLayout alone fires before
     Android has drawn this view, which is why the hide above waits for the image.)
     It also waits for the first screen to finish mounting underneath (appReady),
     or mountGrace at most: that mount is the heaviest work of startup, and an
     animation sharing frames with it stutters. */
  /* The native splash goes as soon as this view is provably on screen (its logo
     loaded) — not later at the reveal, which may still be waiting for the app. */
  React.useEffect(() => {
    if (laidOut && logoLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [laidOut, logoLoaded]);

  React.useEffect(() => {
    if (!laidOut || !logoLoaded || !(appReady || graceOver) || revealStarted.current) return;
    revealStarted.current = true;
    const easeOut = Easing.bezier(...motion.easeOut);
    /* .set(): Reanimated's React-Compiler-safe write. */
    logoOpacity.set(withTiming(1, { duration: reveal, easing: easeOut }));
    if (!reduceMotion) {
      logoScale.set(withTiming(1, { duration: reveal, easing: easeOut }));
      sweep.set(withTiming(1, { duration: reveal, easing: Easing.bezier(...motion.easeInOut) }));
      beat.set(withDelay(SPLASH_TIMING.beatDelay, withTiming(1, { duration: SPLASH_TIMING.beat, easing: easeOut })));
    }
    holdTimer.current = setTimeout(() => setRevealed(true), reveal + hold);
  }, [laidOut, logoLoaded, appReady, graceOver, logoOpacity, logoScale, sweep, beat, reduceMotion, reveal, hold]);

  React.useEffect(() => () => clearTimeout(holdTimer.current), []);

  /* Exit once the logo has had its moment AND the app is ready (or we gave up). */
  React.useEffect(() => {
    if (finished.current || !((revealed && appReady) || timedOut)) return;
    finished.current = true;
    const easeInOut = Easing.bezier(...motion.easeInOut);
    let done = false;
    const finish = () => { if (done) return; done = true; played = true; onFinished(); };
    /* Unmount when the fade has really finished on the UI thread — a JS timer of the
       same length could fire first and cut the dissolve short. The timer stays only
       as a fallback in case the completion callback never arrives. */
    splashOpacity.set(withTiming(0, { duration: exit, easing: easeInOut }, (complete) => {
      if (complete) scheduleOnRN(finish);
    }));
    if (!reduceMotion) logoScale.set(withTiming(EXIT_SCALE, { duration: exit, easing: easeInOut }));
    const fallback = setTimeout(finish, exit + 400);
    return () => clearTimeout(fallback);
  }, [revealed, appReady, timedOut, exit, onFinished, splashOpacity, logoScale, reduceMotion]);

  const splashStyle = useAnimatedStyle(() => ({ opacity: splashOpacity.value }));
  const logoStyle = useAnimatedStyle(() => ({ opacity: logoOpacity.value, transform: [{ scale: logoScale.value }] }));
  /* A navy cover with a soft left edge slides off to the right: sweep 0 → its solid
     part hides the whole logo; sweep 1 → it sits past the logo's right edge. */
  const coverStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -feather + sweep.value * (logoWidth + feather) }],
  }));
  const beatStyle = useAnimatedStyle(() => ({
    opacity: beat.value === 0 ? 0 : 0.6 * (1 - beat.value),
    transform: [{ scale: 1 + beat.value * 2.4 }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.splash, splashStyle]} onLayout={onLayout}
      pointerEvents="none" accessibilityRole="image" accessibilityLabel="WearWise">
      <StatusBar style="light" />
      <View style={styles.center}>
        <Animated.View style={[{ width: logoWidth, height: logoHeight }, logoStyle]}>
          {/* the beat: one ring from the node, under the logo so the dot stays crisp */}
          <Animated.View style={[styles.ring, {
            left: node.x - node.d / 2, top: node.y - node.d / 2, width: node.d, height: node.d, borderRadius: node.d / 2,
          }, beatStyle]} />
          <Animated.Image source={LOGO} resizeMode="contain" accessibilityIgnoresInvertColors
            onLoad={() => setLogoLoaded(true)} style={{ width: logoWidth, height: logoHeight }} />
          {!reduceMotion && (
            <View style={[StyleSheet.absoluteFill, styles.clip]}>
              <Animated.View style={[styles.cover, { width: logoWidth + feather }, coverStyle]}>
                <Canvas style={{ width: feather, height: logoHeight }}>
                  <Rect x={0} y={0} width={feather} height={logoHeight}>
                    <LinearGradient start={vec(0, 0)} end={vec(feather, 0)} colors={[`${NAVY}00`, NAVY]} />
                  </Rect>
                </Canvas>
                <View style={{ flex: 1, backgroundColor: NAVY }} />
              </Animated.View>
            </View>
          )}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  splash: { backgroundColor: NAVY, zIndex: 1000, elevation: 1000 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 2, borderColor: TEAL },
  clip: { overflow: 'hidden' },
  cover: { position: 'absolute', top: 0, bottom: 0, left: 0, flexDirection: 'row' },
});
