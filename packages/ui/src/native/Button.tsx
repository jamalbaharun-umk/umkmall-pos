import React from 'react';
import {
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { contract } from '../contract';
import { ButtonInkFade, ButtonStateFade, useButtonStateFade } from './button-state-fade';
import { PressableScaleHost } from './motion';
import { Spinner } from './Spinner';
import { Text } from './Text';
import { BUTTON_TREATMENT, buttonPaint } from './button-styles';
import { measure, tokens, type TextRole } from './theme';

type Axes = typeof contract.Button.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * Figma's General set is `Type` x `Colors` x `Size` x `State`. `Type` decides the SHAPE
 * (filled / outlined / bare) and `Colors` decides the HUE; the cross-product lives in
 * `button-styles.ts`, one cell per pair with its rest, pressed and disabled paint — the same
 * split the web component makes, and checked against the web's classes by
 * `__tests__/button-paint.test.ts`.
 *
 * `pressed` stands where the web has `hover`: touch has no hover, and Figma's `State` axis
 * moves COLOUR, not geometry, so the pressed paint is the published hover ramp.
 */
/**
 * The web scale is `px-10 py-4 text-lg` … `px-4 py-1.5 text-xs` — Tailwind's rem ladder,
 * which the pipeline publishes as `measurement`. The type step is the mobile role at the
 * same pixel size: 18 → h5, 16 → h6, 14 → paragraph, 12 → bodyLg.
 */
const SIZE = {
  large: { paddingHorizontal: measure['2-5'], paddingVertical: measure['1'], role: 'h5' },
  medium: { paddingHorizontal: measure['2'], paddingVertical: measure['0-75'], role: 'h6' },
  small: { paddingHorizontal: measure['1-5'], paddingVertical: measure['0-625'], role: 'paragraph' },
  micro: { paddingHorizontal: measure['1'], paddingVertical: measure['0-375'], role: 'bodyLg' },
  /* UMK-1548: ours, no Figma rung. 12px semibold, 6 / 12. */
  compact: { paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing['3xs'], role: 'bodyLg' },
} satisfies Record<Of<'size'>, { paddingHorizontal: number; paddingVertical: number; role: TextRole }>;

const WIDTH = {
  auto: { alignSelf: 'flex-start' },
  full: { alignSelf: 'stretch' },
} satisfies Record<Of<'width'>, ViewStyle>;

/** What a function child is handed: the ink the cell paints in this state, and its type step. */
export interface ButtonContentState {
  ink: string;
  role: TextRole;
}

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children' | 'disabled'> {
  type?: Of<'type'>;
  color?: Of<'color'>;
  size?: Of<'size'>;
  width?: Of<'width'>;
  /**
   * A string is set in the button's own type step, in the cell's ink. A FUNCTION receives that
   * ink and the type step for the current state, so a label with a glyph beside it can paint both
   * the way the web's `currentColor` does — `Icon`'s `tint` takes the resolved value. Anything
   * else is rendered as given, and paints nothing from the cell.
   */
  children: React.ReactNode | ((state: ButtonContentState) => React.ReactNode);
  /** Optional action handler (alias for onPress), mirroring the web's `action`. */
  action?: () => void;
  disabled?: boolean;
  /** Disables the button and shows a spinner beside the label. Additive; see contract divergence 3. */
  isLoading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The web `Button`, drawn by React Native. Same axes, same variant names, same defaults —
 * including `width: 'full'`, which is what a stacked mobile form wants anyway.
 *
 * The ring on an outlined button is a real border rather than a `ring-*` box-shadow, and
 * it is subtracted from the padding so the three types line up to the pixel side by side.
 *
 * A disabled or loading button takes its cell's DISABLED paint — fill, stroke and ink — and
 * no opacity fade (UMK-1091).
 *
 * PRESS MOTION (native-ui-v2, identity doc §7.2): the button shrinks to
 * `motion.scale.press.default` and springs back, ON TOP OF its pressed paint, which is
 * unchanged. It goes through `PressableScaleHost` rather than `PressableScale` because the paint
 * lives on the pressable itself; a disabled or loading button does not move.
 *
 * STATE MOTION (UMK-1485): becoming disabled or enabled (or starting / stopping to load)
 * CROSSFADES the fill and stroke over `motion.duration.fast` instead of swapping them — zero-config,
 * every button in the app. The pressable takes its new paint at once, so what a test or a screen
 * reader reads is always the current state; the OLD paint is drawn on a decorative layer between the
 * fill and the label and fades off it, then unmounts (`button-state-fade.tsx`, kept out of this file
 * so its no-fade guard still reads it whole). Where the label's ink moves too (outlined and text
 * cells), the old-ink label fades off on the same opacity. Under Reduce Motion the fade is the
 * shorter `duration.press`.
 * The rest paint is still the cell's own disabled paint, never an opacity (UMK-1091): the fade is
 * only the transition between two paints.
 */
export const Button = ({
  type = 'primary',
  color = 'primary',
  size = 'medium',
  width = 'full',
  children,
  action,
  onPress,
  disabled,
  isLoading,
  style,
  ...props
}: ButtonProps) => {
  const treatment = BUTTON_TREATMENT[type][color];
  const { role, ...padding } = SIZE[size];
  const borderWidth = treatment.strokeWidth;
  const inert = Boolean(disabled || isLoading);
  const fade = useButtonStateFade(inert, (wasInert) => buttonPaint(treatment, { pressed: false, inert: wasInert }));

  const handlePress = (e: GestureResponderEvent) => {
    action?.();
    onPress?.(e);
  };

  return (
    <PressableScaleHost
      scale="default"
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: Boolean(isLoading) }}
      disabled={inert}
      onPress={handlePress}
      style={({ pressed }) => {
        const paint = buttonPaint(treatment, { pressed, inert });
        return [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: tokens.spacing['2xs'],
            borderRadius: tokens.radius.full,
            borderWidth,
            borderColor: paint.borderColor,
            backgroundColor: paint.backgroundColor,
            paddingHorizontal: padding.paddingHorizontal - borderWidth,
            paddingVertical: padding.paddingVertical - borderWidth,
          },
          WIDTH[width],
          style,
        ];
      }}
      {...props}
    >
      {({ pressed }) => {
        const { ink } = buttonPaint(treatment, { pressed, inert });
        return (
          <>
            {/* FIRST: the fading fill sits under everything else in the button, the spinner and the
                label included (pinned by button-state-fade.test.tsx). */}
            <ButtonStateFade fade={fade} borderWidth={borderWidth} />
            {/* Decorative (`label=""`): the busy state above already tells assistive technology,
                and a spoken "Memuat..." would be concatenated into the button's own name. The
                spinner takes a colour that reads on its cell rather than always white, or it
                vanishes on an outlined button. */}
            {isLoading && <Spinner size="sm" variant={treatment.spinner} label="" />}
            {typeof children === 'string' ? (
              <ButtonInkFade
                fade={fade}
                ink={ink}
                render={(labelInk) => (
                  <Text
                    variant={role}
                    weight={size === 'compact' ? 'semibold' : 'bold'}
                    /* The ink moves per state (hover and disable inks are their own ramp), so it is a
                       resolved hex rather than a `TextColor` word, which names the default step only. */
                    style={{ color: labelInk }}
                  >
                    {children}
                  </Text>
                )}
              />
            ) : typeof children === 'function' ? (
              <ButtonInkFade fade={fade} ink={ink} render={(labelInk) => children({ ink: labelInk, role })} />
            ) : (
              children
            )}
          </>
        );
      }}
    </PressableScaleHost>
  );
};

Button.displayName = 'Button';
