import React from 'react';
import { Text as RNText, StyleSheet, type StyleProp, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import {
  resolveTextStyle,
  TEXT_COLOR_VALUES,
  type TextColor,
  type TextRole,
  type TextWeight,
  type WeightFor,
} from './theme';
import { scaleTextStyle, useTextScale } from './text-scale';

export type { TextRole, WeightFor };

export interface TextProps<R extends TextRole = 'paragraph'>
  extends Omit<RNTextProps, 'style' | 'children'> {
  /**
   * Which step of the scale to render. Named `variant` to match the web component exactly —
   * a native `Text` whose prop is `role` where web says `variant` turns every screen port
   * into a translation exercise and makes design review compare two vocabularies.
   */
  variant?: R;
  /**
   * Constrained to the weights `R` publishes, same as web. Offering `medium` on `display`
   * would read a token that does not exist; here that is worse than on the web, because
   * `undefined` sizes silently fall back to React Native's default rather than to nothing.
   */
  weight?: WeightFor<R>;
  color?: TextColor;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

/**
 * The Ensyra type scale, rendered by React Native.
 *
 * Everything about HOW a step becomes a style lives in `resolveTextStyle` — the mobile
 * half of the scale, the copied lineHeight, the family-instead-of-weight rule for Android —
 * so this component is only the prop surface over it. `TextField` reads the same resolver
 * for its `TextInput`, which is the point of it being shared.
 */
export const Text = <R extends TextRole = 'paragraph'>({
  variant,
  weight,
  color = 'primary',
  style,
  children,
  ...props
}: TextProps<R>) => {
  const role = (variant ?? 'paragraph') as TextRole;
  const resolvedWeight = (weight ?? 'regular') as TextWeight;
  const scale = useTextScale();

  /* The reader's size (UMK-1832) applies to the FINAL style, so a caller's own `fontSize` (the chat
     markdown's 16 / 28.8, a badge's 12) follows the setting as the token sizes do. At 1, no flatten. */
  const composed: StyleProp<TextStyle> = [resolveTextStyle(role, resolvedWeight), { color: TEXT_COLOR_VALUES[color] }, style];

  return (
    <RNText
      style={scale === 1 ? composed : scaleTextStyle(StyleSheet.flatten(composed), scale)}
      {...props}
    >
      {children}
    </RNText>
  );
};
