import React from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { measure, tokens } from './theme';

type Axes = typeof contract.Spinner.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** `h-4` … `h-16` on the web, as the measurement ladder. */
const SIZE = {
  sm: measure['1'],
  md: measure['2'],
  lg: measure['3'],
  xl: measure['4'],
} as const satisfies Record<Of<'size'>, number>;

/**
 * The web's `primary | white | gray` are Tailwind palette words; here each resolves to the
 * `Icon` token that renders the same thing. The variant NAMES are kept so a screen port
 * does not have to translate them.
 */
const COLOR = {
  primary: tokens.icon.default.brand,
  white: tokens.icon.default.invert,
  gray: tokens.icon.default.secondary,
/**
 * `gradient` DEGRADES TO ITS FIRST STOP HERE, deliberately and visibly.
 *
 * React Native draws no gradient without a native module, and pulling one in is a rebuild and
 * a device reinstall — the same call `native/index.ts` already recorded for the date picker.
 * The vocabulary stays shared because the contract is one list for both platforms; what
 * differs is the fidelity, and a flat brand fill is the honest reading of a brand sweep rather
 * than an approximation of a second colour nobody asked for. When a screen needs the real
 * thing, it arrives with the module, not by widening this map.
 */
  gradient: tokens.icon.default.brand,
} as const satisfies Record<Of<'variant'>, string>;

/*
 * TIED TO THE CONTRACT, not to the tables above. These read `keyof typeof COLOR` and
 * `keyof typeof SIZE` until now, which is the shape that lets the two platforms drift:
 * the values happened to match the web's, and nothing said so. Now a vocabulary change in
 * `contract.Spinner` reddens the `satisfies` on whichever table has not followed it —
 * the same link the web sibling already has, and every other native component but this one.
 */
export type SpinnerVariant = Of<'variant'>;
export type SpinnerSize = Of<'size'>;

export interface SpinnerProps {
  variant?: SpinnerVariant;
  size?: SpinnerSize;
  /**
   * What assistive technology hears. An empty string makes the spinner decorative — which
   * is what `Button` passes, because its own busy state already says it, and "Loading...
   * Kirim" is what the label would otherwise concatenate into.
   */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A rotating ring, drawn rather than `ActivityIndicator`.
 *
 * The platform indicator takes two sizes on iOS and only its own palette by default, so a
 * four-step size axis and a token colour cannot be expressed through it. A View with two
 * coloured edges rotating on the native driver is what the web draws too (`border-t` and
 * `border-r` on a transparent ring), so the two surfaces show the same shape.
 */
export const Spinner = ({ variant = 'primary', size = 'md', label = 'Memuat...', style }: SpinnerProps) => {
  const spin = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const px = SIZE[size];
  const decorative = label === '';

  return (
    <Animated.View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'progressbar'}
      accessibilityLabel={decorative ? undefined : label}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[
        {
          width: px,
          height: px,
          borderRadius: tokens.radius.full,
          borderWidth: 2,
          borderColor: 'transparent',
          borderTopColor: COLOR[variant],
          borderRightColor: COLOR[variant],
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        },
        style,
      ]}
    />
  );
};

Spinner.displayName = 'Spinner';
