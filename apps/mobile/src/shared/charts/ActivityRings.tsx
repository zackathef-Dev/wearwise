import React from 'react';
import { View, AccessibilityInfo } from 'react-native';
import { Canvas, Path, Skia, SweepGradient, vec } from '@shopify/react-native-skia';

/* Apple-activity-ring hero, on Skia.
 *
 * Concentric rings sweep from 12 o'clock to their value on mount. The sweep is a
 * self-contained one-shot RAF producing a plain 0..1 number per ring — deliberately
 * NOT a reanimated SharedValue bound into Skia, which fires a "state update before
 * mount" warning on first render under Skia 2 + Reanimated 4. A one-shot ~850 ms
 * tween on the JS thread is imperceptible here and keeps the component dependency-
 * free. Reduced-motion draws the rings filled at once.
 *
 * Each ring value is a 0..1 fraction of its goal; over-goal clamps the arc but
 * keeps the ring "complete". The centre is free content (children).
 */

export interface Ring {
  value: number;        // 0..1 (values >1 render as a full ring)
  color: string;
  color2?: string;      // optional gradient end; defaults to color
  colorEnd?: string;    // web-mockup alias for color2
  trackColor?: string;  // defaults to color (dim wash of its own hue)
  label: string;        // accessibility only
}

interface Props {
  rings: Ring[];        // outer → inner
  size?: number;
  strokeWidth?: number;
  thickness?: number;   // web-mockup alias for strokeWidth
  gap?: number;
  children?: React.ReactNode;
  accessibilityLabel?: string;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function ActivityRings({ rings, size = 220, strokeWidth, thickness, gap = 6, children, accessibilityLabel }: Props) {
  const stroke = strokeWidth ?? thickness ?? 18;
  const cx = size / 2, cy = size / 2;
  const targets = rings.map((r) => Math.max(0, Math.min(r.value, 1)));
  const targetsKey = targets.join(','); // stable primitive dep for the sweep effect

  const [progress, setProgress] = React.useState(0); // 0..1 global tween
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { if (mounted) setReduced(r); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  React.useEffect(() => {
    /* One-shot sweep. Progress is only ever set inside the rAF callback (never
       synchronously in the effect body); reduced-motion just uses a 0 ms duration
       so it lands filled on the first frame. Re-runs when the targets change. */
    let raf = 0; const start = Date.now(); const DURATION = reduced ? 0 : 900;
    const tick = () => {
      const t = DURATION === 0 ? 1 : Math.min(1, (Date.now() - start) / DURATION);
      setProgress(easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, targetsKey]);

  const paths = React.useMemo(
    () => rings.map((_, i) => {
      const radius = size / 2 - stroke / 2 - i * (stroke + gap);
      return Skia.PathBuilder.Make()
        .addArc({ x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 }, -90, 360)
        .detach();
    }),
    // paths are pure geometry: only the ring COUNT matters, not the ring values
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rings.length, size, stroke, gap, cx, cy],
  );

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? rings.map((r) => `${r.label} ${Math.round(Math.min(r.value, 1) * 100)}%`).join(', ')}
    >
      <Canvas style={{ width: size, height: size, position: 'absolute' }}>
        {rings.map((ring, i) => {
          /* Slight per-ring stagger for the cascade feel. */
          const staggered = Math.max(0, Math.min(1, (progress - i * 0.12) / (1 - i * 0.12)));
          const end = targets[i]! * (reduced ? 1 : staggered);
          return (
            <React.Fragment key={i}>
              <Path path={paths[i]!} style="stroke" strokeWidth={stroke} strokeCap="round" color={ring.trackColor ?? ring.color} opacity={0.22} />
              <Path path={paths[i]!} style="stroke" strokeWidth={stroke} strokeCap="round" start={0} end={end} color={ring.color}>
                <SweepGradient c={vec(cx, cy)} colors={[ring.color, ring.color2 ?? ring.colorEnd ?? ring.color]} />
              </Path>
            </React.Fragment>
          );
        })}
      </Canvas>
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}
