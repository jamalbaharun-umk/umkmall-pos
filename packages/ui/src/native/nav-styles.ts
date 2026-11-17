import type { ViewStyle } from 'react-native';
import { CARD_EDGE } from './content-styles';
import { measure, shadowStyle, tokens, withAlpha } from './theme';

/**
 * The native-ui-v2 navigation chrome: `TabBar`, `IconButton` and `ChatDrawer`'s `floating`
 * panel (docs/guidelines/mobile-design-identity.md §5.1, §5.2). Native-only — the web does not
 * follow this identity — so there is no `*-classes.ts` twin to mirror.
 *
 * Every colour is a token. The measurements that are OFF the ladder are named rather than
 * inlined, because the design specifies them and the ladder has no step: the tab bar's height
 * (56) and the floating panel's width (316). Moving either onto a published step is a one-line
 * change. This file imports React Native TYPES only, so vitest can load the tab indicator's math
 * below (`__tests__/tab-indicator.test.ts`).
 */

/** §5.2: the floating sidebar is 316 wide on a 390 phone, clamped to the window on a narrower one. */
export const FLOATING_DRAWER_WIDTH = 316;

/* ---------------------------------------------------------------------------------------- *
 * TabBar (§5.1, the flat bar of Figma "Teman AI v2", UMK-1604)
 * ---------------------------------------------------------------------------------------- */

/** The bar's height above the bottom safe area: Figma's 56. Off the ladder, so named. */
export const TAB_BAR_HEIGHT = 56;

/**
 * The white bar on the bottom edge, full width, edged by the UPWARD `shadow.nav`. Positioned by the
 * bar itself so `Tabs`' `tabBar` slot can return it as is; the bottom safe area is padding added at
 * render, so the bar's own 56 always sits above it.
 */
export const TAB_BAR = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: tokens.surface.default.primary,
  ...shadowStyle(tokens.shadow.nav),
} as const satisfies ViewStyle;

/** The four items in a row, each an equal share of the width. The indicator rides its top edge. */
export const TAB_BAR_ROW = {
  flexDirection: 'row',
  height: TAB_BAR_HEIGHT,
} as const satisfies ViewStyle;

/** One item's share of the row. The pressable inside fills it, so the whole share is the target. */
export const TAB_BAR_CELL = { flex: 1 } as const satisfies ViewStyle;

/** What an item draws: the 20 pt glyph 8 from the top, the label 2 under it (Figma: y 8 and 30). */
export const TAB_BAR_ITEM = {
  height: TAB_BAR_HEIGHT,
  alignItems: 'center',
  paddingTop: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

/** Figma's 20 pt glyph: Iconsax outline inactive, its filled twin active (no stroke weight to set). */
export const TAB_BAR_ICON_SIZE = measure['1-25'];

export const TAB_BAR_ICON = {
  width: TAB_BAR_ICON_SIZE,
  height: TAB_BAR_ICON_SIZE,
  marginBottom: tokens.spacing['5xs'],
} as const satisfies ViewStyle;

/** The second face of a glyph or label, laid exactly over the first so the two can crossfade
 *  (colour does not animate on the native driver). */
export const TAB_BAR_LAYER = {
  ...({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const),
  alignItems: 'center',
} as const satisfies ViewStyle;

/** The brand line on the top edge of the active item: 2 pt, one item wide (its width is set at
 *  render), moved and stretched by transforms only. */
export const TAB_BAR_INDICATOR = {
  position: 'absolute',
  top: 0,
  left: 0,
  height: tokens.borderWidth.md,
  backgroundColor: tokens.surface.default.brand,
} as const satisfies ViewStyle;

/** Inactive: navy, the text colour. Active: brand (Figma). */
export const TAB_BAR_INK = {
  inactive: tokens.text.default.primary,
  active: tokens.text.default.brand,
} as const;

/** Where the indicator rests under item `index` of a row whose items are `itemWidth` wide. */
export const tabIndicatorEdges = (index: number, itemWidth: number) => ({ left: index * itemWidth, right: (index + 1) * itemWidth });

/** The two operations the indicator's transform is built from: numbers here and in its test,
 *  `Animated.add` / `Animated.multiply` in `TabBar`, so the formula tested is the formula drawn. */
export interface IndicatorArith<T> {
  add(a: T, b: T | number): T;
  scale(a: T, k: number): T;
}

/**
 * The indicator is ONE view, `itemWidth` wide at x 0, whose two edges are animated separately (the
 * leading edge first, so it stretches as it travels). React Native scales about a view's CENTRE, so
 * a left/right pair becomes `scaleX = (right − left) / itemWidth` and a `translateX` that puts the
 * scaled centre at the pair's midpoint: `(left + right) / 2 − itemWidth / 2`. Transform order is
 * `[translateX, scaleX]`. No `transformOrigin`, so the web renderer draws it the same.
 */
export const tabIndicatorTransform = <T>(ops: IndicatorArith<T>, left: T, right: T, itemWidth: number) => ({
  translateX: ops.add(ops.scale(ops.add(left, right), 0.5), -itemWidth / 2),
  scaleX: ops.scale(ops.add(right, ops.scale(left, -1)), itemWidth > 0 ? 1 / itemWidth : 0),
});

/* ---------------------------------------------------------------------------------------- *
 * IconButton
 * ---------------------------------------------------------------------------------------- */

/** 44 × 44, round — the identity's minimum target (§1.1, §8). */
export const ICON_BUTTON = {
  width: measure['2-75'],
  height: measure['2-75'],
  borderRadius: tokens.radius.full,
  alignItems: 'center',
  justifyContent: 'center',
} as const satisfies ViewStyle;

/**
 * The three treatments. `outlined` is the default container (§4.1: since UMK-1603 the solid card's
 * look as a disc — a white fill with the one card edge, `CARD_EDGE`), `solid` the one brand action an
 * area may carry (§1.3), `plain` a bare glyph that still takes a full 44 target.
 */
export const ICON_BUTTON_VARIANT = {
  outlined: {
    backgroundColor: tokens.surface.default.primary,
    ...CARD_EDGE,
  },
  solid: { backgroundColor: tokens.surface.default.brand },
  plain: {},
} as const satisfies Record<string, ViewStyle>;

/**
 * The plain variant's press highlight (UMK-1602 "Icon button"): a round disc of the primary ink at 8%,
 * filling the 44 target under the glyph. Its OPACITY animates (0 at rest, 1 pressed), never its colour.
 */
export const ICON_BUTTON_PRESS_INK = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  borderRadius: tokens.radius.full,
  backgroundColor: withAlpha(tokens.text.default.primary, 8),
} as const satisfies ViewStyle;

/** A disabled solid button drops to the disabled brand fill; outlined and plain keep their fill. */
export const ICON_BUTTON_DISABLED_SOLID = {
  backgroundColor: tokens.surface.disable.brand,
} as const satisfies ViewStyle;

/* ---------------------------------------------------------------------------------------- *
 * ChatDrawer variant="floating" (§5.2)
 * ---------------------------------------------------------------------------------------- */

/** The scrim. The same token the sheet scrim reads (`OVERLAY_SCRIM`). */
export const FLOATING_DRAWER_SCRIM = {
  ...({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const),
  backgroundColor: tokens.surface.default.overlay,
} as const satisfies ViewStyle;

/**
 * The panel: inset 12 from the left, from the top safe area + 8 down to 24 above the bottom
 * (both insets added at render), `radius.3xl`, the one card edge (`CARD_EDGE`, UMK-1603), and
 * `shadow.float`. NO `overflow: hidden` here — on iOS it would clip the shadow; the content view
 * inside clips instead. The solid white fill is that content view's own (`FLOATING_DRAWER_CONTENT`),
 * so it takes the panel's radius.
 */
export const FLOATING_DRAWER_INSET = {
  left: tokens.spacing.sm,
  top: tokens.spacing['2xs'],
  bottom: tokens.spacing.xl,
} as const;

export const FLOATING_DRAWER_PANEL = {
  position: 'absolute',
  ...FLOATING_DRAWER_INSET,
  width: FLOATING_DRAWER_WIDTH,
  borderRadius: tokens.radius['3xl'],
  ...CARD_EDGE,
  ...shadowStyle(tokens.shadow.float),
} as const satisfies ViewStyle;

/** The clipped content column inside the panel, and the panel's solid white fill (UMK-1603). */
export const FLOATING_DRAWER_CONTENT = {
  flex: 1,
  backgroundColor: tokens.surface.default.primary,
  borderRadius: tokens.radius['3xl'],
  overflow: 'hidden',
} as const satisfies ViewStyle;
