import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { LIST_BULLET, LIST_BULLET_ITEM, LIST_DIRECTION } from './content-styles';

export type ListDirection = keyof typeof LIST_DIRECTION;

export interface ListProps extends Omit<ViewProps, 'style'> {
  /** `vertical` stacks, `horizontal` wraps, `bullet` stacks with a drawn marker. A layout choice, not a contract axis. */
  direction?: ListDirection;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A stack of items, optionally bulleted. `bullet` draws its own dot: the a2ui renderer this
 * covers authors bold-prefixed prose inside each item, and a text marker sits at the wrong
 * baseline against it.
 */
export const List = ({ direction = 'vertical', children, style, ...props }: ListProps) => (
  <View style={[LIST_DIRECTION[direction], style]} {...props}>
    {direction === 'bullet'
      ? React.Children.map(children, (child) => (
          <View style={LIST_BULLET_ITEM}>
            <View accessibilityElementsHidden style={LIST_BULLET} />
            <View style={{ flex: 1, minWidth: 0 }}>{child}</View>
          </View>
        ))
      : children}
  </View>
);

List.displayName = 'List';
