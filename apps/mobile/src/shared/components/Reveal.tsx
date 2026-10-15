import React from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { motion } from '@wearwise/design-tokens';
import { staggerDelay } from '@/shared/motion-math';
import { EASE_OUT } from './motion';

/* A small entrance wrapper: content fades and rises in when it MOUNTS, staggered by
 * `index`. Wrap list rows in it: a row that merely re-renders (a refresh that keeps its
 * key) never replays, so a list animates on its first load and for genuinely new rows
 * only. Rows at `cap` and beyond mount still — nobody should wait for rows they cannot
 * see yet.
 *
 * When the OS has Reduce Motion on, it renders a plain View with NO reanimated entering
 * animation at all — both because motion should be off, and because driving a
 * reanimated layout-entering animation while the OS is in reduced-motion mode can
 * schedule a state update before the view has mounted (a React "state update on a
 * component that hasn't mounted yet" warning).
 *
 * Reduce Motion is read with reanimated's useReducedMotion(), which is synchronous. An
 * async AccessibilityInfo check had to render a plain View first and swap the animated
 * one in afterwards — remounting the content, so it flashed before its entrance.
 */

/* Half the brand stagger: rows are small, and eight of them shouldn't take a second. */
const STEP = motion.staggerStep / 2;
const RISE = 8;

/* One builder per delay, so a re-render hands Animated.View the same object. */
const builders = new Map<number, FadeInDown>();
const enterAfter = (delay: number): FadeInDown => {
  let b = builders.get(delay);
  if (!b) {
    b = FadeInDown.duration(motion.durEnter).easing(EASE_OUT).withInitialValues({ transform: [{ translateY: RISE }] }).delay(delay);
    builders.set(delay, b);
  }
  return b;
};

export function Reveal({ children, index = 0, cap = 8, style }: {
  children: React.ReactNode; index?: number; cap?: number; style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <View style={style}>{children}</View>;
  /* Always an Animated.View (past the cap too): a row whose index later drops under the
     cap must not change element type, which would remount and replay it. */
  const delay = staggerDelay(index, STEP, cap);
  return (
    <Animated.View entering={delay == null ? undefined : enterAfter(delay)} style={style}>
      {children}
    </Animated.View>
  );
}
