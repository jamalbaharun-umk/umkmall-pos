import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { DIVIDER_LABEL, DIVIDER_ORIENTATION, DIVIDER_RULE, DIVIDER_VARIANT } from './content-styles';
import { Text } from './Text';

type Axes = typeof contract.Divider.axes;

export type DividerVariant = Axes['variant'][number];
export type DividerOrientation = Axes['orientation'][number];

const VARIANT = DIVIDER_VARIANT satisfies Record<DividerVariant, ViewStyle>;
const ORIENTATION = DIVIDER_ORIENTATION satisfies Record<DividerOrientation, ViewStyle>;

export interface DividerProps extends Omit<ViewProps, 'style'> {
  variant?: DividerVariant;
  /** A `vertical` divider separates items inside a row and takes its height from that row. */
  orientation?: DividerOrientation;
  /** An optional label, centred on the rule. Horizontal only. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A rule, with an optional centred label. A LABEL IS HORIZONTAL-ONLY, and passing one on a
 * vertical divider is ignored rather than stacked — the design has no such form.
 */
export const Divider = ({ variant = 'default', orientation = 'horizontal', children, style, ...props }: DividerProps) => {
  const rule = [DIVIDER_RULE[orientation], VARIANT[variant]];
  const labelled = orientation === 'horizontal' && !!children;

  return (
    <View
      {...props}
      accessibilityRole="none"
      style={[ORIENTATION[orientation], labelled && { alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {labelled ? (
        <>
          <View accessibilityElementsHidden style={[{ position: 'absolute', left: 0, right: 0 }, ...rule]} />
          <View style={DIVIDER_LABEL}>
            {typeof children === 'string' ? (
              <Text variant="paragraph" color="secondary">
                {children}
              </Text>
            ) : (
              children
            )}
          </View>
        </>
      ) : (
        <View style={rule} />
      )}
    </View>
  );
};

Divider.displayName = 'Divider';
