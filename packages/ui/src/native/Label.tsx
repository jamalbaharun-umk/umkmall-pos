import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { contract } from '../contract';
import { RequiredMark } from './field-support';
import { Text } from './Text';
import { tokens, type TextColor, type TextRole } from './theme';

type Axes = typeof contract.Label.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** The web's `text-red-600` / `text-green-600` palette words, as the semantic tokens that render them. */
const VARIANT = {
  default: 'primary',
  error: 'error',
  success: 'success',
} satisfies Record<Of<'variant'>, TextColor>;

/** `text-xs` / `text-sm` / `text-base`: 12, 14, 16 — bodyLg, paragraph, h6 on the mobile scale. */
const SIZE = {
  sm: 'bodyLg',
  md: 'paragraph',
  lg: 'h6',
} satisfies Record<Of<'size'>, TextRole>;

export interface LabelProps {
  variant?: Of<'variant'>;
  size?: Of<'size'>;
  required?: boolean;
  /** The `nativeID` a control's `accessibilityLabelledBy` points at. */
  nativeID?: string;
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

/**
 * A standalone form label — the legacy web component, mirrored so a screen port has it.
 *
 * Every slice-2 control owns its own label (the recorded divergence), so this is for the
 * one case that has none: a label over a group of controls, or over something that is not a
 * control at all. Slice 6 owns reconciling it on the web; when that lands, this follows.
 */
export const Label = ({ variant = 'default', size = 'md', required, nativeID, children, style }: LabelProps) => (
  <Text nativeID={nativeID} variant={SIZE[size]} weight="semibold" color={VARIANT[variant]} style={[{ marginBottom: tokens.spacing['2xs'] }, style]}>
    {children}
    {required && <RequiredMark />}
  </Text>
);

Label.displayName = 'Label';
