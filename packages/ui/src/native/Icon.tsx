import type { StyleProp, ViewStyle } from 'react-native';
import { contract } from '../contract';
import { ICON_REGISTRY, type IconName } from './icon-registry';
import { ICON_COLOR_VALUES, measure, type TextColor } from './theme';

export type { IconName };
export { ICON_NAMES, ICON_REGISTRY, PORTED_ICON_NAMES } from './icon-registry';

type Axes = typeof contract.Icon.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * The same five steps as the web (`h-3` … `h-8`), read off the measurement ladder. Unlike
 * the web there is a DEFAULT: an SVG on native has no `className` to size it through, so an
 * unsized icon would render at lucide's own 24, which matches nothing in the app.
 *
 * KEYED OFF THE CONTRACT, unlike the web sibling, which still spells its five steps as a
 * local `SIZES` object and derives `IconSize` from `keyof typeof`. Both platforms happened
 * to publish the same five words, which is the coincidence this file no longer relies on —
 * the web half is UMK-900's direction (code → contract) and is left to it.
 */
const SIZES = {
  xs: measure['0-75'],
  sm: measure['1'],
  md: measure['1-25'],
  lg: measure['1-5'],
  xl: measure['2'],
} as const satisfies Record<Of<'size'>, number>;

export type IconSize = Of<'size'>;
export type IconColor = TextColor;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** Resolved against the `Icon` token group. */
  color?: IconColor;
  /**
   * A resolved token VALUE, overriding `color`. The native stand-in for the web's
   * `currentColor` inheritance, and it exists for exactly one reason.
   *
   * On the web an SVG takes its colour from whatever text utility the parent wears, so a
   * surface whose palette sits outside the icon ramp — `Alert`'s callout treatments, whose
   * borders are `#087660` and `#ac6f08` against the icon ramp's `#0ea06e` and `#f59e0b` —
   * colours its glyph for free. There is no inheritance here: `color` is a closed vocabulary
   * and those two values are not in it, so without this channel a treated alert would draw
   * the right border beside a glyph in the wrong green.
   *
   * PASS A TOKEN, never a literal. It is typed `string` because the callout group is not the
   * icon group and cannot be spelled as an `IconColor`; that is the divergence, not a licence
   * to write hex at a call site.
   */
  tint?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * Decorative by default, matching the web: zero of the ~96 lucide call sites carry a
   * label, and the wrapping control does the announcing. Passing one opts the glyph INTO the
   * accessibility tree as an image.
   */
  accessibilityLabel?: string;
}

/**
 * One component for every icon in the design system, on `lucide-react-native`.
 *
 * The prop surface is narrower than the web's on purpose. The web `Icon` passes `className`
 * through because every one of its call sites sizes and colours that way; there is no
 * `className` here, so `size` and `color` — optional conveniences on the web — are the whole
 * API. `strokeWidth` survives because the web's stop button needs it, and a native composer
 * will too.
 */
export const Icon = ({
  name,
  size = 'md',
  color = 'primary',
  tint,
  strokeWidth,
  style,
  accessibilityLabel,
}: IconProps) => {
  const Glyph = ICON_REGISTRY[name];

  /**
   * `undefined` is an unknown name — the union catches it for TS callers, this is for a name
   * arriving from JSON or a cast. `null` is a KNOWN name whose house artwork has not been
   * ported yet. Both throw, and they throw different messages, because "you typo'd it" and
   * "port the glyph" are different fixes.
   */
  if (Glyph === undefined) throw new Error(`Icon: unknown name '${name}'`);
  if (Glyph === null) {
    throw new Error(
      `Icon: '${name}' is house artwork that has not been ported to native yet. ` +
        `Port the glyph with react-native-svg and register it in native/icon-registry.ts (UMK-952).`,
    );
  }

  const decorative = !accessibilityLabel;

  return (
    <Glyph
      size={SIZES[size]}
      color={tint ?? ICON_COLOR_VALUES[color]}
      strokeWidth={strokeWidth}
      style={style}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={accessibilityLabel}
      /* Both platforms, because each reads a different prop: iOS `accessibilityElementsHidden`,
         Android `importantForAccessibility`. Setting one leaves the glyph announced as an
         unlabelled image on the other. */
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    />
  );
};

Icon.displayName = 'Icon';
