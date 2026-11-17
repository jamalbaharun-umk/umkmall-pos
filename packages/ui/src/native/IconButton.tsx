import React from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { Icon, type IconName, type IconSize } from './Icon';
import { EASING, MOTION, PressableScale, type PressableScaleProps } from './motion';
import { ICON_BUTTON, ICON_BUTTON_DISABLED_SOLID, ICON_BUTTON_PRESS_INK, ICON_BUTTON_VARIANT } from './nav-styles';

type Axes = typeof contract.IconButton.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type IconButtonVariant = Of<'variant'>;

export interface IconButtonProps extends Omit<PressableScaleProps, 'scale' | 'style' | 'children' | 'accessibilityLabel'> {
  icon: IconName;
  /**
   * REQUIRED: an icon-only control has no text for a screen reader to fall back on (identity
   * doc §8). Use the surface's existing copy ("Open menu", "Tutup").
   */
  accessibilityLabel: string;
  /** `outlined` (default; a white disc with the one card edge, UMK-1603), `solid` for the area's one brand action, `plain` bare. */
  variant?: IconButtonVariant;
  /** The glyph's step on the icon ladder. The TARGET stays 44 × 44 whatever this is. */
  iconSize?: IconSize;
  style?: StyleProp<ViewStyle>;
}

/**
 * A round, icon-only control (native-ui-v2, docs/guidelines/mobile-design-identity.md): the
 * tab header's hamburger, the room header's back button, a sheet's close.
 *
 * 44 × 44 always — the identity's minimum target — and the visual IS the target, so there is
 * no hit-slop arithmetic to drift. Presses through `PressableScale` at the `icon` depth; a
 * disabled button does not animate (the helper's rule): `outlined` and `plain` draw the glyph in
 * the disabled ink, `solid` drops its fill to the disabled brand and keeps the white glyph.
 *
 * A `plain` button has no container to darken, so on press-in it lights a round 8% ink disc under
 * the glyph and dims it on release, over `duration.press` (UMK-1602 "Icon button"). `PressableScale`
 * keeps no pressed state, so the disc follows this button's own `onPressIn`/`onPressOut` — the
 * caller's handlers still run — and `testOnly_pressed` holds it lit for a playbook specimen.
 */
export const IconButton = ({
  icon,
  accessibilityLabel,
  variant = 'outlined',
  iconSize = 'md',
  disabled,
  style,
  onPressIn,
  onPressOut,
  testOnly_pressed,
  ...props
}: IconButtonProps) => {
  const inked = variant === 'plain';
  const [ink] = React.useState(() => new Animated.Value(testOnly_pressed ? 1 : 0));
  const light = (toValue: number) => {
    /* A button disabled while held still dims on release; only the press-in is refused. */
    if (!inked || (disabled && toValue > 0)) return;
    Animated.timing(ink, { toValue, duration: MOTION.duration.press, easing: EASING.standard, useNativeDriver: true }).start();
  };
  return (
    <PressableScale
      {...props}
      testOnly_pressed={testOnly_pressed}
      onPressIn={(e) => {
        light(1);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        light(0);
        onPressOut?.(e);
      }}
      scale="icon"
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={[ICON_BUTTON, ICON_BUTTON_VARIANT[variant], disabled && variant === 'solid' && ICON_BUTTON_DISABLED_SOLID, style]}
    >
      {inked ? <Animated.View testID="icon-button-press-ink" pointerEvents="none" style={[ICON_BUTTON_PRESS_INK, { opacity: ink }]} /> : null}
      <Icon name={icon} size={iconSize} color={variant === 'solid' ? 'invert' : disabled ? 'disable' : 'primary'} />
    </PressableScale>
  );
};

IconButton.displayName = 'IconButton';
