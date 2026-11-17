import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type EasingFunction,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MOTION, staggerDelay, type PressScale } from './motion-tokens';

export { MOTION, parseCubicBezier, staggerDelay, type PressScale } from './motion-tokens';

/**
 * The native-ui-v2 motion layer (docs/guidelines/mobile-design-identity.md §7).
 *
 * EVERY entrance and EVERY press in the v2 identity animates, and every value comes from
 * `tokens.motion` — a view never spells a duration, an easing or a spring of its own. These
 * are BEHAVIOUR helpers, not components: no contract entry and no playbook page; the
 * components that wear them (`Card`, `Button`, the tab bar, …) are where motion is shown.
 *
 * Built on React Native's own `Animated` with the native driver, like `Skeleton` and
 * `Dialog`, so `@umkmall/ui` takes no Reanimated peer. The native driver animates transform
 * and opacity only — which is the identity's rule anyway (never animate layout).
 */

const bezier = ([a, b, c, d]: readonly [number, number, number, number]): EasingFunction => Easing.bezier(a, b, c, d);

/** The token easings as `Animated` easing functions, built once. */
export const EASING = { standard: bezier(MOTION.easing.standard), exit: bezier(MOTION.easing.exit) } as const;

/**
 * Whether the OS asks for reduced motion. Starts `false` and corrects itself once the OS
 * answers — the same subscription `Skeleton` uses. Under it, entrances become a short
 * plain fade and springs a ≤120 ms timing (identity §7.3 rule 5).
 */
export const useReducedMotion = (): boolean => {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduce(on));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
};

/**
 * The press scale itself, shared by `PressableScale` and `PressableScaleHost` so the two
 * cannot drift: one value, sprung to `motion.scale.press.*` on press-in with `spring.press` and
 * back to 1 on release; a ≤120 ms timing under reduced motion; no movement at all while
 * `disabled`.
 */
const usePressScale = (scale: PressScale, disabled: boolean | null | undefined) => {
  const value = React.useRef(new Animated.Value(1)).current;
  const reduce = useReducedMotion();
  /* The press animation in flight. A new press stops it before starting its own, and UNMOUNT stops
     it: a spring left running on a view that is gone keeps scheduling native-driver work against a
     dead node (in Jest it fires after the environment is torn down and fails the suite). */
  const running = React.useRef<Animated.CompositeAnimation | null>(null);
  React.useEffect(() => () => running.current?.stop(), []);

  const to = (target: number) => {
    running.current?.stop();
    running.current = reduce
      ? Animated.timing(value, { toValue: target, duration: MOTION.duration.press, useNativeDriver: true })
      : Animated.spring(value, { toValue: target, ...MOTION.spring.press, useNativeDriver: true });
    running.current.start();
  };

  return {
    pressIn: () => {
      if (!disabled) to(MOTION.scale[scale]);
    },
    pressOut: () => to(1),
    transform: { transform: [{ scale: value }] },
  };
};

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  /** Which press depth: `default` for buttons, chips and rows, `card` for large surfaces
   *  (a big surface moving 3% reads as a jump), `icon` for icon buttons and tab items. */
  scale?: PressScale;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Press feedback for every tappable in the identity: shrinks to `motion.scale.press.*` on
 * press-in and springs back on release. A DISABLED control does not animate — the press
 * would promise an action that is not coming.
 *
 * The scale lives on an inner `Animated.View` so the `Pressable` hit area never shrinks
 * under the finger.
 */
export const PressableScale = ({
  scale = 'default',
  style,
  children,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) => {
  const press = usePressScale(scale, disabled);

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        press.pressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.pressOut();
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, press.transform]}>{children}</Animated.View>
    </Pressable>
  );
};

PressableScale.displayName = 'PressableScale';

/** What a `PressableScaleHost` hands its style and children callbacks. */
export interface PressScaleState {
  pressed: boolean;
}

export interface PressableScaleHostProps extends Omit<PressableProps, 'style' | 'children'> {
  scale?: PressScale;
  /** The host's own style — paint included — or a function of the press, like `Pressable`'s. */
  style?: StyleProp<ViewStyle> | ((state: PressScaleState) => StyleProp<ViewStyle>);
  children?: React.ReactNode | ((state: PressScaleState) => React.ReactNode);
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * `PressableScale`'s sibling for a control whose PAINT lives on the `Pressable` itself — `Button`,
 * `Chip`, `SelectionCard`'s cards, `ListRow` (native-ui-v2, identity doc §7.2).
 *
 * WHY NOT `PressableScale`: that one scales an inner view and leaves the `Pressable` unpainted. A
 * control whose fill, border and pressed treatment sit on the `Pressable` would have to move all of
 * it onto that inner view, and the element carrying the accessibility role would stop carrying its
 * colours — which is what the app's behaviour suites read, and what a screen reader's focus outline
 * hugs. So the scale goes on the host instead, through an animated `Pressable`.
 *
 * WHY IT TRACKS `pressed` ITSELF: an animated component drops a FUNCTION style on the floor (it can
 * only flatten objects), so `Pressable`'s own `({ pressed }) => style` cannot carry the transform.
 * The press is mirrored from the same `onPressIn`/`onPressOut` `Pressable` sets its own state from,
 * and `testOnly_pressed` is honoured, so a playbook specimen held pressed still paints pressed.
 *
 * The hit area shrinks with the paint — by `motion.scale.press.*`, at most 3%, and only while a
 * finger is already down, where `Pressable`'s press-retention rect keeps the press alive anyway.
 */
export const PressableScaleHost = ({
  scale = 'default',
  style,
  children,
  disabled,
  onPressIn,
  onPressOut,
  testOnly_pressed,
  ...rest
}: PressableScaleHostProps) => {
  const press = usePressScale(scale, disabled);
  const [down, setDown] = React.useState(false);
  const state: PressScaleState = { pressed: Boolean(testOnly_pressed) || down };

  return (
    <AnimatedPressable
      {...rest}
      testOnly_pressed={testOnly_pressed}
      disabled={disabled}
      onPressIn={(e) => {
        setDown(true);
        press.pressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setDown(false);
        press.pressOut();
        onPressOut?.(e);
      }}
      style={[typeof style === 'function' ? style(state) : style, press.transform]}
    >
      {typeof children === 'function' ? children(state) : children}
    </AnimatedPressable>
  );
};

PressableScaleHost.displayName = 'PressableScaleHost';

export interface EnterProps {
  /** Extra delay before this element enters, in ms (an `EnterList` sets it per item). */
  delay?: number;
  /** How far it rises while fading in. Defaults to `motion.distance.enter`. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * An entrance: fades 0 → 1 while rising `motion.distance.enter`, over `motion.duration.base`
 * with `motion.easing.standard`. Plays ONCE per mount — never on a re-render or a refetch
 * (identity §7.3 rule 3). Under reduced motion it is a plain fade over `duration.fast`.
 */
export const Enter = ({ delay = 0, distance = MOTION.distance.enter, style, children }: EnterProps) => {
  const progress = React.useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();

  React.useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: reduce ? MOTION.duration.fast : MOTION.duration.base,
      delay: reduce ? 0 : delay,
      easing: EASING.standard,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    // Mount-only by design: the entrance must not replay when `reduce` resolves or props change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rise = reduce ? 0 : distance;
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};

Enter.displayName = 'Enter';

export interface EnterListProps {
  /** Delay before the FIRST item, e.g. to let a sheet land before its rows stagger in. */
  delay?: number;
  /** Style for each item's wrapper (a grid cell's width, a row's gap). */
  itemStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Staggers its children in: item n enters `staggerDelay(n)` after the first. Items past
 * `motion.stagger.max` enter together with the last staggered one. Renders a fragment — the
 * parent keeps its own flex/grid layout.
 */
export const EnterList = ({ delay = 0, itemStyle, children }: EnterListProps) => (
  <>
    {React.Children.toArray(children).map((child, index) => (
      <Enter key={React.isValidElement(child) && child.key != null ? child.key : index} delay={delay + staggerDelay(index)} style={itemStyle}>
        {child}
      </Enter>
    ))}
  </>
);

EnterList.displayName = 'EnterList';
