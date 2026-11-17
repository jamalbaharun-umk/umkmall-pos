import React from 'react';
import { View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { CARD_BASE, CARD_PADDING, CARD_VARIANT } from './content-styles';
import { PressableScale } from './motion';

type Axes = typeof contract.Card.axes;

export type CardPadding = Axes['padding'][number];
export type CardVariant = Axes['variant'][number];

const VARIANT = CARD_VARIANT satisfies Record<CardVariant, ViewStyle>;
const PADDING = CARD_PADDING satisfies Record<CardPadding, ViewStyle>;

export interface CardProps extends Omit<ViewProps, 'style'> {
  /**
   * A shadow (`elevated`), a border (`outlined` — the white fill with the one 1 px
   * `border.default.primary` edge, which is also native-ui-v2's card on the white page), or nothing
   * (`plain`, for a surface that supplies its own chrome).
   */
  variant?: CardVariant;
  padding?: CardPadding;
  /**
   * Makes the whole card the control. A pressable card presses with
   * `PressableScale scale="card"` (identity §4, §7.2): a large surface moving 3% reads as a
   * jump, so it takes the shallower card depth. Absent, the card is a plain `View` and takes
   * no touch at all.
   */
  onPress?: PressableProps['onPress'];
  /** Only meaningful with `onPress`: a disabled card does not press and does not animate. */
  disabled?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A container. `elevated` stays the default so the two web call sites render what they did. */
export const Card = ({ variant = 'elevated', padding = 'medium', onPress, disabled, children, style, ...props }: CardProps) => {
  const box = [CARD_BASE, VARIANT[variant], PADDING[padding], style];

  if (onPress) {
    return (
      <PressableScale
        {...props}
        scale="card"
        accessibilityRole={props.accessibilityRole ?? 'button'}
        accessibilityState={{ ...props.accessibilityState, disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        style={box}
      >
        {children}
      </PressableScale>
    );
  }

  return (
    <View style={box} {...props}>
      {children}
    </View>
  );
};

Card.displayName = 'Card';
