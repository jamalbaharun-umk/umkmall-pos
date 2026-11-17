import React from 'react';
import { type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * The one place this entry — and the app above it — draws a linear gradient (UMK-1128).
 *
 * React Native paints no gradient on its own, so every sweep on native goes through
 * `expo-linear-gradient`, a NATIVE MODULE: adding it changed the dev client's fingerprint and
 * needs a rebuild (`docs/features/mobile/native-design-system.md`). An optional peer of this
 * package, as `react-native-svg` is, so a web consumer never installs it.
 *
 * WHY ONE HELPER rather than `LinearGradient` at each call site: the web spells a sweep as a
 * DIRECTION CLASS plus a first stop and a last stop, and the native reading of that class — which
 * corner is `start` and which is `end` — is a translation that was going to be written once per
 * screen and get one of them backwards. It is written here, keyed by the web's direction in
 * words (`toRight` for the web sweeping left to right), so a caller names a direction and never a
 * pair of coordinates. (No web class is spelled in this file: the inline-class purge guard reads
 * class-shaped text in comments too, and a direction key is not a class.)
 *
 * Only the directions a live surface uses are listed. A new one is a row here, never an ad hoc
 * `start`/`end` pair at a call site.
 *
 * THE STOPS ARE THE CALLER'S, and they arrive as values read from `tokens` — this helper names no
 * colour of its own.
 */
const DIRECTION = {
  /** The web sweeping rightwards: left edge to right edge, vertically constant. */
  toRight: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
  /** Top edge to bottom edge, horizontally constant: the TemanAI chat bar's edge (Figma Teman AI Page "01 Chat Bar", UMK-1743). */
  toBottom: { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
} as const;

export type GradientDirection = keyof typeof DIRECTION;

export interface GradientFillProps extends Omit<ViewProps, 'style'> {
  /** The web's first stop. */
  from: string;
  /** The web's last stop. */
  to: string;
  /** The web's sweep direction, in words. */
  direction?: GradientDirection;
  /**
   * A plain view style — radius, border and padding all apply. The gradient paints the view's
   * own background, so a `backgroundColor` here is painted UNDER it and never seen.
   */
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** A `View` whose background is a two-stop linear sweep. */
export const GradientFill = ({ from, to, direction = 'toRight', style, children, ...props }: GradientFillProps) => (
  <LinearGradient {...props} colors={[from, to]} start={DIRECTION[direction].start} end={DIRECTION[direction].end} style={style}>
    {children}
  </LinearGradient>
);

GradientFill.displayName = 'GradientFill';
