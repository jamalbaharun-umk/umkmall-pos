import type { TextStyle, ViewStyle } from 'react-native';
import { CARD_EDGE } from './content-styles';
import { measure, shadowStyle, tokens, type TextRole, type TextWeight } from './theme';

/**
 * The style tables for the native-ui-v2 identity cards: `FeatureTile`, `PhotoCard` and
 * `CoinChip` (docs/guidelines/mobile-design-identity.md §2.3, §4.2, §4.3, §4.7).
 *
 * PURE: type-only `react-native` imports, so vitest can load it (`react-native`'s entry is
 * Flow). The numbers the components need to be testable — the coin formatter, the cover
 * geometry, the tone table — live here for that reason.
 *
 * Every colour is a token. Four LAYOUT dimensions the identity doc specifies have no rung on
 * the measurement ladder (`IDENTITY_LAYOUT` below); they are named once here, with the section
 * that specifies them, rather than typed into a view. They are candidates for the identity
 * overlay (§2.4), not values this file invented.
 */

/* ------------------------------------------------------------------------------------------ */
/* Layout dimensions with no token                                                            */
/* ------------------------------------------------------------------------------------------ */

/**
 * The identity doc's own numbers where the measurement ladder has no rung. Each is quoted
 * from the section named, and each is a candidate for `_overlay-identity-v2.tokens.json`.
 * Values the canvas draws at a near-token size (a 26 card radius, an 18 corner, a 14 padding)
 * SNAP to the token instead (§6) and are not here.
 */
export const IDENTITY_LAYOUT = {
  /** §4.2: a grid tile's min-height, so a 2-column row of tiles lines up. */
  featureTileGridMinHeight: 150,
  /** §4.2: the selected tile's border width. `borderWidth` publishes 1 and 2 only. */
  featureTileSelectedBorder: 1.5,
  /** §4.3: the photo card's height. */
  photoCardHeight: 200,
  /** §4.3: the title column's max width, so the title never runs over the art on the right. */
  photoCardTitleMaxWidth: 170,
} as const;

/**
 * §7.2 "Select / toggle": the check circle scales in FROM 0.6. `motion.scale` publishes only
 * the three PRESS depths, so this one starting scale has no token; named once, here.
 */
export const CHECK_SCALE_FROM = 0.6;

/** A disabled card or chip dims to the published 60% opacity step. */
export const DISABLED_OPACITY = tokens.opacity['60'] / 100;

/* ------------------------------------------------------------------------------------------ */
/* Coin numbers                                                                               */
/* ------------------------------------------------------------------------------------------ */

/**
 * Indonesian number style: thousands grouped with a dot (`2.813`), so a decimal uses a comma
 * (`0,5`). Two fraction digits at most, never padded.
 *
 * A MIRROR, NOT AN IMPORT. The app's `formatCredits` (`apps/mobile/src/temanai/credit.ts`, itself
 * a hand-mirror of the web's `apps/main-website/lib/format-credits.ts`) is the same formatter, but
 * this package cannot import app code. So it is restated here with the same options and the same
 * `null` rule, and pinned to the same outputs by `identity-cards.test.ts`. Hermes ships `id-ID`.
 */
const COIN_NUMBER = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

/** `null` is UNLIMITED (a manual grant) and renders `∞`, never a number nobody can act on. */
export const formatCoins = (coins: number | null): string => (coins === null ? '∞' : COIN_NUMBER.format(coins));

/**
 * One frame of a count-up, rounded so an intermediate frame never shows more precision than
 * either end: counting between two whole numbers draws only whole numbers, never `1.234,57`.
 */
export const countUpFrame = (from: number, to: number, progress: number): number => {
  const raw = from + (to - from) * progress;
  return Number.isInteger(from) && Number.isInteger(to) ? Math.round(raw) : Math.round(raw * 100) / 100;
};

/* ------------------------------------------------------------------------------------------ */
/* FeatureTile                                                                                */
/* ------------------------------------------------------------------------------------------ */

/**
 * §2.3: seven tones, each a pale surface and a strong glyph (`neutral` since UMK-1887). Keyed off the TOKEN groups, so the
 * contract's `tone` axis, `surface.tile.*` and `icon.tile.*` are one vocabulary; the component
 * pins this table to the contract axis with `satisfies`, and `identity-cards.test.ts` pins the
 * axis to both token groups.
 */
export const FEATURE_TILE_TONE = {
  blue: { surface: tokens.surface.tile.blue, glyph: tokens.icon.tile.blue },
  yellow: { surface: tokens.surface.tile.yellow, glyph: tokens.icon.tile.yellow },
  red: { surface: tokens.surface.tile.red, glyph: tokens.icon.tile.red },
  green: { surface: tokens.surface.tile.green, glyph: tokens.icon.tile.green },
  purple: { surface: tokens.surface.tile.purple, glyph: tokens.icon.tile.purple },
  orange: { surface: tokens.surface.tile.orange, glyph: tokens.icon.tile.orange },
  neutral: { surface: tokens.surface.tile.neutral, glyph: tokens.icon.tile.neutral },
} as const satisfies Record<keyof typeof tokens.surface.tile, { surface: string; glyph: string }>;

/** §4.2: the 44 pt icon tile, radius `lg`, holding a 22 pt glyph. */
export const FEATURE_TILE_ICON_BOX = {
  width: measure['2-75'],
  height: measure['2-75'],
  borderRadius: tokens.radius.lg,
  alignItems: 'center',
  justifyContent: 'center',
} as const satisfies ViewStyle;

export const FEATURE_TILE_GLYPH_SIZE = measure['1-375'];

/**
 * The two layouts. `grid` is the solid card (§4.1, UMK-1603: a white fill and the one `CARD_EDGE`,
 * as `Card variant="outlined"` draws them; padding snaps the canvas's 14 to `spacing.md`, §4); `row`
 * is the Alat sheet row — solid sheet behind it, so no fill of its own, and a transparent border of
 * the SELECTED width so selecting a row never shifts its content.
 */
export const FEATURE_TILE_LAYOUT = {
  grid: {
    minHeight: IDENTITY_LAYOUT.featureTileGridMinHeight,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
    borderRadius: tokens.radius['2xl'],
    backgroundColor: tokens.surface.default.primary,
    ...CARD_EDGE,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: measure['3-5'],
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing['2xs'],
    gap: tokens.spacing.sm,
    borderRadius: tokens.radius.xl,
    borderWidth: IDENTITY_LAYOUT.featureTileSelectedBorder,
    borderColor: 'transparent',
  },
  /* The TemanAI home's category tile (Figma Teman AI Page 15256-71436, UMK-1743): no card at all, the
     toned square fills the column and the name sits under it. Radius and border are here only for the
     selected overlay, which reads them. */
  stack: {
    alignItems: 'stretch',
    gap: tokens.spacing.sm,
    borderRadius: tokens.radius.lg,
    borderWidth: tokens.borderWidth.none,
  },
} as const satisfies Record<string, ViewStyle>;

/** The `stack` layout's square: the column's width, radius `lg`, the glyph at 36 pt (Figma's "Chips" frame). */
export const FEATURE_TILE_STACK_BOX = {
  width: '100%',
  aspectRatio: 1,
  borderRadius: tokens.radius.lg,
  alignItems: 'center',
  justifyContent: 'center',
} as const satisfies ViewStyle;

export const FEATURE_TILE_STACK_GLYPH_SIZE = measure['2-25'];

/**
 * §4.2 selected: the brand border and the weak-brand fill. Drawn as an OVERLAY whose opacity
 * crossfades (§7.2 "border and fill crossfade `duration.fast`"), because the native driver
 * animates opacity and never colour — and §7.3 rule 2 forbids animating anything else.
 */
export const FEATURE_TILE_SELECTED = {
  borderWidth: IDENTITY_LAYOUT.featureTileSelectedBorder,
  borderColor: tokens.border.default.brand,
  backgroundColor: tokens.surface.weak.brand,
} as const satisfies ViewStyle;

/** §4.2: the 22 pt check circle, filled brand, with a white mark. */
export const FEATURE_TILE_CHECK = {
  width: measure['1-375'],
  height: measure['1-375'],
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.surface.default.brand,
  alignItems: 'center',
  justifyContent: 'center',
} as const satisfies ViewStyle;

export const FEATURE_TILE_CHECK_MARK_SIZE = measure['0-75'];

/** §4.2: title 15 SemiBold → the nearest mobile step (`paragraph`, 14); purpose 12 → `bodyLg`. */
export const FEATURE_TILE_TEXT = {
  title: { role: 'paragraph', weight: 'semibold' },
  description: { role: 'bodyLg', weight: 'regular' },
} as const satisfies Record<string, { role: TextRole; weight: TextWeight }>;

/** §2.2: secondary text is `text.default.muted`, NOT `text.default.secondary` (about 2.6:1 on the white page). */
export const MUTED_TEXT = { color: tokens.text.default.muted } as const satisfies TextStyle;

/* ------------------------------------------------------------------------------------------ */
/* PhotoCard                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * §4.3. The SHADOW sits on the outer box and the CLIP on the inner one: iOS draws no shadow
 * outside an `overflow: hidden` view, so one box cannot do both. The outer carries a fill too,
 * because Android's elevation shadow needs one to cast from.
 */
export const PHOTO_CARD_FRAME = {
  borderRadius: tokens.radius['2xl'],
  backgroundColor: tokens.surface.default.primary,
  ...shadowStyle(tokens.shadow.card),
} as const satisfies ViewStyle;

export const PHOTO_CARD_CLIP = {
  height: IDENTITY_LAYOUT.photoCardHeight,
  borderRadius: tokens.radius['2xl'],
  overflow: 'hidden',
  padding: tokens.spacing.lg,
  justifyContent: 'space-between',
} as const satisfies ViewStyle;

export const PHOTO_CARD_TITLE_COLUMN = {
  maxWidth: IDENTITY_LAYOUT.photoCardTitleMaxWidth,
  gap: tokens.spacing['4xs'],
} as const satisfies ViewStyle;

/** §4.3: title 19 SemiBold/Bold → the nearest mobile step (`h5`, 18); description 12 → `bodyLg`. */
export const PHOTO_CARD_TEXT = {
  title: { role: 'h5', weight: 'bold' },
  description: { role: 'bodyLg', weight: 'regular' },
  cta: { role: 'paragraph', weight: 'semibold' },
  price: { role: 'bodyLg', weight: 'bold' },
} as const satisfies Record<string, { role: TextRole; weight: TextWeight }>;

/**
 * §4.3 price corner: the promo fill, rounded ONLY on its outer-bottom-left. The canvas's 18
 * snaps to `radius.xl` (§6); the card's own corner is rounded by the clip it sits in.
 */
export const PHOTO_CARD_PRICE = {
  position: 'absolute',
  top: 0,
  right: 0,
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing['4xs'],
  paddingHorizontal: tokens.spacing.sm,
  paddingVertical: tokens.spacing['3xs'],
  backgroundColor: tokens.surface.badge.promo,
  borderBottomLeftRadius: tokens.radius.xl,
} as const satisfies ViewStyle;

/** §4.3 CTA: a 40 pt brand pill, bottom-left. */
export const PHOTO_CARD_CTA = {
  alignSelf: 'flex-start',
  height: measure['2-5'],
  paddingHorizontal: tokens.spacing.lg,
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.surface.default.brand,
  alignItems: 'center',
  justifyContent: 'center',
} as const satisfies ViewStyle;

export interface Size {
  width: number;
  height: number;
}

/**
 * COVER geometry, anchored right-bottom (§4.3: journey art keeps the person on the right).
 *
 * React Native's `resizeMode="cover"` always CENTRES, which crops the person off a wide card. So
 * the image is sized here — the smallest size that covers the box at the art's own aspect ratio —
 * and pinned `right: 0, bottom: 0`; whatever overflows does so up and to the LEFT, where the
 * clip removes it and the title sits anyway.
 *
 * `undefined` when either size is unknown or degenerate; the caller then falls back to a
 * centred cover rather than drawing at a guessed size.
 */
export const coverAnchoredSize = (box: Size, image: Size): Size | undefined => {
  if (!(box.width > 0 && box.height > 0 && image.width > 0 && image.height > 0)) return undefined;
  const scale = Math.max(box.width / image.width, box.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
};

/* ------------------------------------------------------------------------------------------ */
/* CoinChip                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/**
 * §4.7: the two chips. `price` is the published chip pair; `balance` is the
 * header chip — solid white with the one card edge (`CARD_EDGE`, UMK-1603), and
 * BRAND text in `brand.b500` (§2.1: brand text on a light surface is b500 at 7.8:1, where
 * `text.default.brand` sits on the 4.5:1 floor).
 */
export const COIN_CHIP_VARIANT = {
  price: { bg: tokens.surface.chip.price, ink: tokens.text.chip.price, border: undefined },
  balance: { bg: tokens.surface.default.primary, ink: tokens.brand.b500, border: CARD_EDGE.borderColor },
} as const satisfies Record<string, { bg: string; ink: string; border: string | undefined }>;

/**
 * Heights 24 / 28 for the two inline sizes and a fixed 40 for the header chip (§4.7 "24–40 by
 * role"). `balance` does not take the size ramp: it is one size by role, and the ramp is the
 * inline chips'.
 */
export const COIN_CHIP_SIZE = {
  sm: { height: measure['1-5'], paddingHorizontal: tokens.spacing['3xs'], glyph: measure['0-75'], role: 'bodyLg' },
  md: { height: measure['1-75'], paddingHorizontal: tokens.spacing['2xs'], glyph: measure['1'], role: 'bodyLg' },
} as const satisfies Record<string, { height: number; paddingHorizontal: number; glyph: number; role: TextRole }>;

export const COIN_CHIP_BALANCE = {
  height: measure['2-5'],
  paddingHorizontal: tokens.spacing.sm,
  glyph: measure['1-25'],
  role: 'paragraph',
} as const satisfies { height: number; paddingHorizontal: number; glyph: number; role: TextRole };

export const COIN_CHIP_BASE = {
  flexDirection: 'row',
  alignSelf: 'flex-start',
  alignItems: 'center',
  gap: tokens.spacing['4xs'],
  borderRadius: tokens.radius.full,
} as const satisfies ViewStyle;

/**
 * The hit slop that brings a pressable chip to the 44 pt floor (§8: "pad the hit area, not the
 * visual"). Zero when the chip is already that tall.
 */
export const hitSlopFor = (height: number): number => Math.max(0, (measure['2-75'] - height) / 2);
