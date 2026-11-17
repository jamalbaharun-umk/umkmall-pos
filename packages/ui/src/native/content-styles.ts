import type { ViewStyle } from 'react-native';
import { measure, shadowStyle, tokens, type TextColor, type TextRole, type TextWeight } from './theme';

/**
 * The style tables the content components share — the native reading of
 * `primitives/content-classes.ts`, value for value, against the same tokens.
 *
 * The type-step rule used throughout: a web class naming the DESKTOP scale maps to the
 * mobile role at the same pixel size (`paragraph-desktop` 16 → `h6`, `body-lg-desktop`
 * 14 → `paragraph`), and a class naming the mobile scale keeps its role.
 */

interface Step {
  paddingHorizontal: number;
  paddingVertical: number;
  role: TextRole;
}

/** A badge: a non-interactive pill. */
export const BADGE_BASE = {
  flexDirection: 'row',
  alignSelf: 'flex-start',
  alignItems: 'center',
  gap: tokens.spacing['4xs'],
  borderRadius: tokens.radius.full,
} as const satisfies ViewStyle;

export const BADGE_WEIGHT: TextWeight = 'medium';

/**
 * `bestseller` IS THE ODD ONE, AND IT IS NOT AN INCONSISTENCY: the other five are 10% tints
 * of their function, it is the SOLID success surface, which is why its text inverts.
 */
export const BADGE_COLOR = {
  primary: { bg: tokens.surface.weak.brand, ink: 'brand' },
  warning: { bg: tokens.surface.weak.warning, ink: 'warning' },
  success: { bg: tokens.surface.weak.success, ink: 'success' },
  danger: { bg: tokens.surface.weak.error, ink: 'error' },
  light: { bg: tokens.surface.weak.neutral, ink: 'primary' },
  bestseller: { bg: tokens.surface.default.success, ink: 'invert' },
  /**
   * `gradient` is a SWEEP, painted from `BADGE_GRADIENT` below (UMK-1128). `bg` here is that
   * sweep's first stop, kept only so every row stays one shape — `Badge` never paints it for this
   * colour. Until UMK-1128 it WAS the treatment: the badge degraded to a flat brand fill, because
   * React Native draws no gradient without a native module.
   */
  gradient: { bg: tokens.surface.default.brand, ink: 'invert' },
} as const satisfies Record<string, { bg: string; ink: TextColor }>;

/**
 * THE `gradient` BADGE'S TWO STOPS — the SAME two the web reads (UMK-1128).
 *
 * The web's `BADGE_COLOR.gradient` is `BRAND_GRADIENT`, which is `bg-gradient-to-r
 * from-default-brand to-hover-brand` (`utils/gradient-classes.ts`): the brand surface into its
 * own hover shade, left to right. Both are read from the TOKENS by the same names rather than
 * written as the hexes they resolve to, so a retint moves both platforms at once. (The token tree
 * also publishes `surface.gradient.brand` with the same two values today; the web does not read
 * it, so neither does this — a second route to the same pair is how the two drift.)
 */
export const BADGE_GRADIENT = {
  from: tokens.surface.default.brand,
  to: tokens.surface.hover.brand,
  direction: 'toRight',
} as const;

/** Four published steps; there is no `large` between the top step and `medium`. */
export const BADGE_SIZE = {
  xlarge: { paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing['2xs'], role: 'paragraph' },
  medium: { paddingHorizontal: tokens.spacing.xs, paddingVertical: tokens.spacing['3xs'], role: 'bodyLg' },
  small: { paddingHorizontal: tokens.spacing['2xs'], paddingVertical: tokens.spacing['5xs'], role: 'bodyMd' },
  micro: { paddingHorizontal: tokens.spacing['3xs'], paddingVertical: tokens.spacing['5xs'], role: 'bodySm' },
  /** UMK-1548: ours. 14px, bold (`BADGE_COMPACT_WEIGHT`), 6 / 10 and 4 / 12 padding. */
  compact: { paddingHorizontal: tokens.spacing.xs, paddingVertical: tokens.spacing['3xs'], role: 'paragraph' },
  compactTight: { paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing['4xs'], role: 'paragraph' },
} as const satisfies Record<string, Step>;

/** The two `compact` badge rungs go bold where every other badge is medium. */
export const BADGE_COMPACT_WEIGHT: TextWeight = 'bold';

/** A chip: interactive, so a border and a pressed treatment. */
export const CHIP_BASE = {
  flexDirection: 'row',
  alignSelf: 'flex-start',
  alignItems: 'center',
  gap: tokens.spacing['4xs'],
  borderRadius: tokens.radius.full,
  borderWidth: 1,
} as const satisfies ViewStyle;

export const CHIP_WEIGHT: TextWeight = 'bold';

/** The `compact` size only: regular idle, semibold selected. */
export const CHIP_COMPACT_WEIGHT = { default: 'regular', active: 'semibold' } as const satisfies Record<string, TextWeight>;

/** The `compact` size, idle only: the n40 border (`border.default.invert`) in place of the hairline; selected keeps its brand border. */
export const CHIP_COMPACT_IDLE_BORDER = tokens.border.default.invert;

/** Idle and selected must stay visibly different at every size. `pressed` stands where the web has `hover`. */
export const CHIP_STATE = {
  default: {
    border: tokens.border.default.primary,
    bg: tokens.surface.default.primary,
    ink: 'primary',
    pressedBorder: tokens.border.default.brand,
    pressedInk: 'brand',
  },
  active: {
    border: tokens.border.default.brand,
    bg: tokens.surface.weak.brand,
    ink: 'brand',
    pressedBorder: tokens.border.default.brand,
    pressedInk: 'brand',
  },
} as const satisfies Record<string, { border: string; bg: string; ink: TextColor; pressedBorder: string; pressedInk: TextColor }>;

/** The six published steps. `huge` sits above the top badge step. */
export const CHIP_SIZE = {
  huge: { paddingHorizontal: tokens.spacing['2xl'], paddingVertical: tokens.spacing.sm, role: 'h6' },
  xlarge: { paddingHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing.xs, role: 'paragraph' },
  large: { paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing['2xs'], role: 'paragraph' },
  medium: { paddingHorizontal: tokens.spacing.xs, paddingVertical: tokens.spacing['2xs'], role: 'bodyLg' },
  small: { paddingHorizontal: tokens.spacing['2xs'], paddingVertical: tokens.spacing['3xs'], role: 'bodyMd' },
  micro: { paddingHorizontal: tokens.spacing['3xs'], paddingVertical: tokens.spacing['5xs'], role: 'bodySm' },
  /** UMK-1548: 14px text, 6 / 16 padding; its weight follows the state (`CHIP_COMPACT_WEIGHT`). */
  compact: { paddingHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing['3xs'], role: 'paragraph' },
} as const satisfies Record<string, Step>;

/** A card: a container. Radius is shared; the surface is the axis below. */
export const CARD_BASE = { borderRadius: tokens.radius['2xl'] } as const satisfies ViewStyle;

/**
 * The ONE card edge on native (UMK-1603, UMK-1516 D1 "white solid surfaces as in Figma, no glass"):
 * 1 px of `border.default.primary` — the stroke the Sosial Media and Pengaturan Perangkat cards draw,
 * and the tab header's scrolled hairline. Every solid white card wears it (`Card variant="outlined"`,
 * the outlined `ListGroup` and `IconButton`, the `FeatureTile` grid, the balance `CoinChip`, the
 * floating `ChatDrawer` panel), so the app has one card edge rather than one per component.
 */
export const CARD_EDGE = { borderWidth: tokens.borderWidth.sm, borderColor: tokens.border.default.primary } as const satisfies ViewStyle;

/**
 * HOW THE CARD IS SEPARATED FROM THE PAGE — three genuinely different answers, all live in
 * the app. `plain` is deliberately empty: "no chrome" is the absence of style, not a style.
 */
export const CARD_VARIANT = {
  elevated: { backgroundColor: tokens.surface.default.primary, ...shadowStyle(tokens.shadow.card) },
  /* The solid white card with the one card edge — also native-ui-v2's card on the white page,
     since the glass card was deleted (UMK-1603). */
  outlined: { backgroundColor: tokens.surface.default.primary, ...CARD_EDGE },
  plain: {},
} as const satisfies Record<string, ViewStyle>;

/** The padding ladder, spelled out. Mobile takes the web's below-`sm` value at each step. */
export const CARD_PADDING = {
  none: { padding: tokens.spacing.null },
  small: { padding: tokens.spacing.md },
  medium: { padding: tokens.spacing.lg },
  large: { padding: tokens.spacing['2xl'] },
} as const satisfies Record<string, ViewStyle>;

/** Which way the rule runs. A vertical divider takes its height from the row it sits in. */
export const DIVIDER_ORIENTATION = {
  horizontal: { marginVertical: tokens.spacing.md, alignSelf: 'stretch' },
  vertical: { marginHorizontal: tokens.spacing['4xs'], alignSelf: 'stretch' },
} as const satisfies Record<string, ViewStyle>;

export const DIVIDER_RULE = {
  horizontal: { borderTopWidth: 1, borderColor: tokens.border.default.primary, alignSelf: 'stretch' },
  vertical: { borderLeftWidth: 1, borderColor: tokens.border.default.primary, flex: 1 },
} as const satisfies Record<string, ViewStyle>;

export const DIVIDER_VARIANT = {
  default: { borderStyle: 'solid' },
  dashed: { borderStyle: 'dashed' },
} as const satisfies Record<string, ViewStyle>;

/** The centred label punches the rule with the SAME surface token as the page beneath it. */
export const DIVIDER_LABEL = {
  backgroundColor: tokens.surface.default.primary,
  paddingHorizontal: tokens.spacing.md,
} as const satisfies ViewStyle;

/** A TAB IS UNDERLINED, NOT A PILL — read off the published set (185:1050). */
export const TAB_LIST = { flexDirection: 'row', alignItems: 'stretch' } as const satisfies ViewStyle;

export const TAB_TRIGGER = {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: tokens.spacing.sm,
} as const satisfies ViewStyle;

/** The BORDER WIDTH is part of the state: 2 on the active tab, 1 on the idle one. */
export const TAB_STATE = {
  default: { borderBottomWidth: 1, borderColor: tokens.border.default.primary, ink: 'secondary', weight: 'regular' },
  active: { borderBottomWidth: 2, borderColor: tokens.border.default.brand, ink: 'brand', weight: 'semibold' },
} as const satisfies Record<string, { borderBottomWidth: number; borderColor: string; ink: TextColor; weight: TextWeight }>;

/**
 * The two published steps: 44 and 36 tall. `h6-desktop` is 18 → mobile `h5`. `xsmall` (UMK-960) is
 * ours, as on the web: `text-ds-paragraph-mobile` (14), no side padding so the labels share the
 * width, and no height floor of its own — the web's step has none.
 */
export const TAB_SIZE = {
  large: { paddingHorizontal: tokens.spacing['2xl'], paddingVertical: tokens.spacing['2xs'], minHeight: measure['2-75'], role: 'h5' },
  small: { paddingHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing['3xs'], minHeight: measure['2-25'], role: 'h6' },
  xsmall: { paddingHorizontal: 0, paddingVertical: tokens.spacing.xs, role: 'paragraph' },
} as const satisfies Record<string, Step & { minHeight?: number }>;

/** Figma's `Show Notif` is a COUNT BADGE, not a dot. */
export const TAB_NOTIF = {
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.surface.weak.error,
  alignItems: 'center',
  justifyContent: 'center',
} as const satisfies ViewStyle;

export const TAB_NOTIF_SIZE = {
  large: { paddingHorizontal: tokens.spacing.xs, paddingVertical: tokens.spacing['4xs'], role: 'bodyMd' },
  small: { paddingHorizontal: tokens.spacing['2xs'], paddingVertical: tokens.spacing['4xs'], role: 'bodySm' },
  xsmall: { paddingHorizontal: tokens.spacing['2xs'], paddingVertical: tokens.spacing['4xs'], role: 'bodySm' },
} as const satisfies Record<string, Step>;

export const TAB_NOTIF_STATE = { default: 'primary', active: 'brand' } as const satisfies Record<string, TextColor>;

/** A list, per direction. */
export const LIST_DIRECTION = {
  vertical: { flexDirection: 'column', gap: tokens.spacing['4xs'] },
  horizontal: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing['2xs'] },
  bullet: { flexDirection: 'column', gap: tokens.spacing['4xs'] },
} as const satisfies Record<string, ViewStyle>;

export const LIST_BULLET_ITEM = { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.spacing['2xs'] } as const satisfies ViewStyle;

/** The dot. `marginTop` optically centres it on the first line. */
export const LIST_BULLET = {
  marginTop: tokens.spacing['2xs'],
  width: tokens.spacing['4xs'],
  height: tokens.spacing['4xs'],
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.surface.default.brand,
} as const satisfies ViewStyle;

/** A disclosure. */
export const DISCLOSURE_BASE = {
  borderRadius: tokens.radius.md,
  borderWidth: 1,
  borderColor: tokens.border.default.primary,
  backgroundColor: tokens.surface.default.primary,
} as const satisfies ViewStyle;

export const DISCLOSURE_SUMMARY = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing['2xs'],
  paddingHorizontal: tokens.spacing.sm,
  paddingVertical: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

export const DISCLOSURE_PANEL = {
  paddingHorizontal: tokens.spacing.sm,
  paddingBottom: tokens.spacing.sm,
  paddingTop: tokens.spacing['3xs'],
} as const satisfies ViewStyle;

/** An image's box. */
export const IMAGE_BASE = {
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  backgroundColor: tokens.surface.default.primary,
} as const satisfies ViewStyle;

/** Thumbnail is square, a banner is wide — and `natural` constrains no ratio at all. */
export const IMAGE_TYPE = {
  thumbnail: { aspectRatio: 1, borderRadius: tokens.radius.md },
  banner: { aspectRatio: 16 / 9, borderRadius: tokens.radius.lg },
  natural: { borderRadius: tokens.radius.md },
  /* A circle at any size (UMK-1186): 9999 rather than `radius.full`, which is 360 and stops
     being round past 720. */
  avatar: { aspectRatio: 1, borderRadius: 9999 },
} as const satisfies Record<string, ViewStyle>;

/** The three published steps, widths from the SPACING scale as on the web. */
export const IMAGE_SIZE = {
  regular: { alignSelf: 'stretch' },
  small: { width: tokens.spacing['4xl'] },
  blog: { width: tokens.spacing['5xlDesktop'] },
} as const satisfies Record<string, ViewStyle>;

/** The placeholder, dashed so an empty slot reads as empty rather than as a broken photo. */
export const IMAGE_PLACEHOLDER = {
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: tokens.border.default.primary,
} as const satisfies ViewStyle;

/**
 * THE FENCED BLOCK — the native reading of `CODE_BLOCK_*`.
 *
 * `overflow: 'hidden'` on the base is what rounds the bar's top corners, the same job
 * `overflow-hidden` does on the web: the children paint their own solid fills and would
 * otherwise square off the container's radius.
 */
export const CODE_BLOCK_BASE = {
  overflow: 'hidden',
  borderRadius: tokens.radius.md,
} as const satisfies ViewStyle;

export const CODE_BLOCK_BAR = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  backgroundColor: tokens.surface.default.invert,
} as const satisfies ViewStyle;

/** The bar's trailing group: the host's `actions`, then the copy control — the web's `CODE_BLOCK_ACTIONS`. */
export const CODE_BLOCK_ACTIONS = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

export const CODE_BLOCK_BODY = {
  backgroundColor: tokens.surface.hover.invert,
} as const satisfies ViewStyle;

/**
 * Padding and type step per size. The web's `text-ds-paragraph-mobile` and
 * `text-ds-body-lg-mobile` are already the MOBILE scale, so unlike most tables here the role
 * carries over by name rather than by pixel size.
 */
export const CODE_BLOCK_SIZE = {
  large: { paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing['2xs'], role: 'paragraph' as TextRole },
  small: { paddingHorizontal: tokens.spacing['2xs'], paddingVertical: tokens.spacing['3xs'], role: 'bodyLg' as TextRole },
} as const;
