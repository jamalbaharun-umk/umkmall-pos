import React from 'react';
import { View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { CHIP_BASE, CHIP_COMPACT_IDLE_BORDER, CHIP_COMPACT_WEIGHT, CHIP_SIZE, CHIP_STATE, CHIP_WEIGHT } from './content-styles';
import { PressableScaleHost } from './motion';
import { Text } from './Text';

type Axes = typeof contract.Chip.axes;

export type ChipState = Axes['state'][number];
export type ChipSize = Axes['size'][number];

const STATE = CHIP_STATE satisfies Record<ChipState, unknown>;
const SIZE = CHIP_SIZE satisfies Record<ChipSize, unknown>;

export interface ChipProps extends Omit<PressableProps, 'style' | 'children'> {
  /**
   * Selection state, not a treatment. NO DEFAULT, deliberately: omitting it says "this chip
   * is an action, not a toggle" and suppresses the selected semantics entirely; passing it
   * opts into toggle semantics. A chip announcing a selection nobody made is worse than one
   * that announces nothing.
   */
  state?: ChipState;
  size?: ChipSize;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * An interactive pill — the counterpart to `Badge`, and the split between them is the
 * point: a badge labels, a chip is pressed.
 *
 * PRESS MOTION (native-ui-v2, identity doc §4.7): `motion.scale.press.default` on top of the
 * pressed border and ink, which are unchanged — through `PressableScaleHost`, because the paint
 * lives on the pressable. A disabled chip does not move.
 */
export const Chip = ({ state, size = 'medium', iconLeft, iconRight, children, disabled, style, ...props }: ChipProps) => {
  const treatment = STATE[state ?? 'default'];
  const { role, ...padding } = SIZE[size];

  return (
    <PressableScaleHost
      {...props}
      scale="default"
      accessibilityRole="button"
      accessibilityState={{
        disabled: Boolean(disabled),
        ...(state === undefined ? {} : { selected: state === 'active' }),
      }}
      disabled={disabled}
      style={({ pressed }) => [
        CHIP_BASE,
        padding,
        {
          backgroundColor: treatment.bg,
          borderColor: pressed && !disabled ? treatment.pressedBorder : size === 'compact' && (state ?? 'default') === 'default' ? CHIP_COMPACT_IDLE_BORDER : treatment.border,
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {iconLeft ? <View accessibilityElementsHidden>{iconLeft}</View> : null}
          {typeof children === 'string' ? (
            <Text
              variant={role}
              weight={size === 'compact' ? CHIP_COMPACT_WEIGHT[state ?? 'default'] : CHIP_WEIGHT}
              color={pressed && !disabled ? treatment.pressedInk : treatment.ink}
              numberOfLines={1}
            >
              {children}
            </Text>
          ) : (
            children
          )}
          {iconRight ? <View accessibilityElementsHidden>{iconRight}</View> : null}
        </>
      )}
    </PressableScaleHost>
  );
};

Chip.displayName = 'Chip';
