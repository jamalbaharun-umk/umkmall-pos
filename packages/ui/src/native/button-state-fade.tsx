import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { ButtonPaint } from './button-styles';
import { EASING, MOTION, useReducedMotion } from './motion';
import { tokens } from './theme';

/**
 * `Button`'s state crossfade (UMK-1485): when a button becomes disabled or enabled, or starts or
 * stops loading, its OLD paint fades off a layer over the new one — the fill and stroke
 * (`ButtonStateFade`) and the label's ink (`ButtonInkFade`), on one shared opacity.
 *
 * WHY THIS IS NOT A FADE OF THE DISABLED BUTTON. `button-paint.test.ts` bans `opacity` in
 * `Button.tsx` because a disabled button must be its cell's own disabled paint, never the rest paint
 * made paler (UMK-1091). That still holds: at rest there is no layer at all, and the button wears
 * exactly one cell paint. The opacity here only carries the 180 ms between two of those paints, and
 * the layer unmounts when it ends — pinned by `apps/mobile/src/design/__tests__/button-state-fade.test.tsx`
 * ("carries no extra layer at rest", "then drops the layer").
 */

export interface ButtonStateFadeState {
  /** The paint the button had before the change, while it fades off; `null` at rest. */
  from: ButtonPaint | null;
  opacity: Animated.Value;
}

/**
 * `from` is set in the same render the state changes (React's derive-from-props pattern), so the
 * old paint is on screen in the very first frame of the new one, and cleared once the fade
 * finishes. `duration.fast` with `easing.standard`; Reduce Motion takes the shorter `duration.press`.
 */
export const useButtonStateFade = (inert: boolean, paintOf: (wasInert: boolean) => ButtonPaint): ButtonStateFadeState => {
  const [settled, setSettled] = React.useState(inert);
  const [from, setFrom] = React.useState<ButtonPaint | null>(null);
  const [opacity] = React.useState(() => new Animated.Value(0));
  const reduce = useReducedMotion();

  if (settled !== inert) {
    setSettled(inert);
    setFrom(paintOf(settled));
  }

  React.useEffect(() => {
    if (!from) return;
    opacity.setValue(1);
    const anim = reduce
      ? Animated.timing(opacity, { toValue: 0, duration: MOTION.duration.press, easing: EASING.standard, useNativeDriver: true })
      : Animated.timing(opacity, { toValue: 0, duration: MOTION.duration.fast, easing: EASING.standard, useNativeDriver: true });
    anim.start(({ finished }) => {
      if (finished) setFrom(null);
    });
    return () => anim.stop();
  }, [from, opacity, reduce]);

  return { from, opacity };
};

/**
 * The layer itself: the old fill and stroke, over the button's fill and under its label, covering
 * the stroke too (the pressable's absolute children start inside its border). Decorative: hidden
 * from assistive technology on both platforms and from touches.
 */
export const ButtonStateFade = ({ fade, borderWidth }: { fade: ButtonStateFadeState; borderWidth: number }) =>
  fade.from ? (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="button-state-fade"
      style={{
        position: 'absolute',
        top: -borderWidth,
        left: -borderWidth,
        right: -borderWidth,
        bottom: -borderWidth,
        borderRadius: tokens.radius.full,
        borderWidth,
        borderColor: fade.from.borderColor ?? 'transparent',
        backgroundColor: fade.from.backgroundColor,
        opacity: fade.opacity,
      }}
    />
  ) : null;

/**
 * The label's ink, crossfaded on the same opacity as the fill. On a filled cell the ink is the same
 * white in every state, and the label is drawn once. Where the ink moves (an outlined or text button
 * turning disabled), the label is drawn a second time in the OLD ink, laid exactly over the new one
 * and fading off it. Text cannot animate its colour on the native driver, so the crossfade is two
 * copies and an opacity. The copy is decorative: hidden from assistive technology on both platforms
 * and from touches.
 *
 * The wrapper is ALWAYS rendered and lays out like the button's own content (a centred row with the
 * same gap), so a function child that returns several nodes keeps its row while a fade runs, and the
 * label does not remount when a fade starts or ends.
 */
export const ButtonInkFade = ({
  fade,
  ink,
  render,
}: {
  fade: ButtonStateFadeState;
  ink: string;
  render: (ink: string) => React.ReactNode;
}) => (
  <View style={LABEL_ROW}>
    {render(ink)}
    {fade.from && fade.from.ink !== ink && (
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="button-ink-fade"
        style={[StyleSheet.absoluteFill, LABEL_ROW, { opacity: fade.opacity }]}
      >
        {render(fade.from.ink)}
      </Animated.View>
    )}
  </View>
);

/** `Button`'s content row: centred, `spacing.2xs` apart. */
const LABEL_ROW = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: tokens.spacing['2xs'],
} as const;
