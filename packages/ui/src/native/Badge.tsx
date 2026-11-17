import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { BADGE_BASE, BADGE_COLOR, BADGE_COMPACT_WEIGHT, BADGE_GRADIENT, BADGE_SIZE, BADGE_WEIGHT } from './content-styles';
import { GradientFill } from './gradient';
import { Text } from './Text';

type Axes = typeof contract.Badge.axes;

export type BadgeColor = Axes['color'][number];
export type BadgeSize = Axes['size'][number];

const COLOR = BADGE_COLOR satisfies Record<BadgeColor, unknown>;
const SIZE = BADGE_SIZE satisfies Record<BadgeSize, unknown>;

export interface BadgeProps {
  color?: BadgeColor;
  size?: BadgeSize;
  /** Figma's `Show Icon Left` / `Show Icon Right` slots. Decorative — the label carries meaning. */
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A label. NOT a control: it takes no handler, and that is the point. A badge that accepts
 * a press is a button nobody can reach with assistive technology — those are Chips.
 */
export const Badge = ({ color = 'primary', size = 'medium', iconLeft, iconRight, children, style }: BadgeProps) => {
  const { bg, ink } = COLOR[color];
  const { role, ...padding } = SIZE[size];
  const content = (
    <>
      {iconLeft ? <View accessibilityElementsHidden>{iconLeft}</View> : null}
      {typeof children === 'string' ? (
        <Text variant={role} weight={size === 'compact' || size === 'compactTight' ? BADGE_COMPACT_WEIGHT : BADGE_WEIGHT} color={ink} numberOfLines={1}>
          {children}
        </Text>
      ) : (
        children
      )}
      {iconRight ? <View accessibilityElementsHidden>{iconRight}</View> : null}
    </>
  );
  /* The one colour that is a SWEEP rather than a fill: the web's `BRAND_GRADIENT`, left to
     right, read from the same two tokens (`BADGE_GRADIENT`). Same box, same padding. */
  if (color === 'gradient') {
    return (
      <GradientFill from={BADGE_GRADIENT.from} to={BADGE_GRADIENT.to} direction={BADGE_GRADIENT.direction} style={[BADGE_BASE, padding, style]}>
        {content}
      </GradientFill>
    );
  }
  return <View style={[BADGE_BASE, padding, { backgroundColor: bg }, style]}>{content}</View>;
};

Badge.displayName = 'Badge';
