import type { ViewStyle } from 'react-native';
import { measure, shadowStyle, tokens } from './theme';

/**
 * The style tables the two overlays share — the native reading of
 * `primitives/overlay-classes.ts`. NO FIGMA SET EXISTS for either component; the values
 * are the ones the web migrated call sites render, expressed in tokens where a token exists.
 */

/**
 * The scrim. The web uses `bg-black/40`; the design publishes `Surface/Popup Background`
 * for exactly this, so the native scrim reads the token the web will migrate to.
 */
export const OVERLAY_SCRIM = {
  ...({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const),
  backgroundColor: tokens.surface.default.overlay,
} as const satisfies ViewStyle;

/** The panel, minus its size and its presentation. */
export const DIALOG_PANEL = {
  backgroundColor: tokens.surface.default.primary,
  ...shadowStyle(tokens.shadow['10Pct']),
} as const satisfies ViewStyle;

/**
 * Presentation. A phone has no `md` breakpoint, so the native `Dialog` is ALWAYS the bottom
 * sheet — there is no centred card here (UMK-1075). The web keeps both forms and switches by
 * width; native carries only this one, and a destructive confirmation that must not be swiped
 * away is a LOCKED sheet (`dismissible={false}`), not a different shape.
 *
 * `maxHeight` is the sheet's whole top safe-area answer and the bound its content shrinks
 * against — `overlay-safe-area.test.tsx` and `overlay-scroll.test.tsx` both pin it.
 *
 * NO SIZE LADDER. The web's `maxWidth` steps belonged to the centred card; a bottom sheet spans
 * the width by definition, and `small` (384) against a 393 dp phone once rendered 9 dp short and
 * left-aligned. So the native `Dialog` has no `size` prop at all (UMK-1075).
 */
export const DIALOG_PRESENTATION = {
  sheet: {
    alignSelf: 'stretch',
    borderTopLeftRadius: tokens.radius['2xl'],
    borderTopRightRadius: tokens.radius['2xl'],
    maxHeight: '88%',
  },
} as const satisfies Record<string, ViewStyle>;

/**
 * The native-ui-v2 sheet (identity doc §5.3), layered over `DIALOG_PRESENTATION.sheet` when a
 * `Dialog` is drawn with `identity` — `Menu` always is. Same fill and the same 88% cap; the
 * top corners move to the sheets-and-sidebar radius (the canvas's 28 snaps to `radius.3xl`) and
 * the shadow to `shadow.float`, the one the identity reserves for panels over content.
 */
export const DIALOG_IDENTITY_SHEET = {
  borderTopLeftRadius: tokens.radius['3xl'],
  borderTopRightRadius: tokens.radius['3xl'],
  ...shadowStyle(tokens.shadow.float),
} as const satisfies ViewStyle;

/**
 * The identity sheet's header row (§5.3): the title at 18 Bold and an optional trailing node —
 * the coin chip, on Alat. Sits inside `DIALOG_TITLE`, so it shares the body's left edge.
 */
export const MENU_HEADER = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: tokens.spacing.sm,
} as const satisfies ViewStyle;

/** The drag handle: the ONLY grab area for the sheet gesture. */
export const DIALOG_HANDLE = {
  alignItems: 'center',
  paddingTop: tokens.spacing.sm,
  paddingBottom: tokens.spacing['4xs'],
} as const satisfies ViewStyle;

export const DIALOG_HANDLE_BAR = {
  height: tokens.spacing['4xs'],
  width: measure['2-5'],
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.surface.default.secondary,
} as const satisfies ViewStyle;

/* The mobile page margin, as the sheet's body uses — one left edge for heading and content. */
export const DIALOG_TITLE = {
  paddingHorizontal: tokens.margin.mobile,
  paddingTop: tokens.spacing.md,
} as const satisfies ViewStyle;

/**
 * The title's right edge when the close X is drawn. The X is absolute — 48 wide, 4 from the
 * right — so it covers 52 of the row, and the title's own 32 let a long heading run under it.
 * 56 clears the X with the same 4 of air it keeps from the edge.
 */
export const DIALOG_TITLE_BESIDE_CLOSE = {
  paddingRight: measure['3'] + tokens.spacing['4xs'] * 2,
} as const satisfies ViewStyle;

/** The close affordance, when one is asked for: 48 square, the platform minimum target. */
export const DIALOG_CLOSE = {
  position: 'absolute',
  top: tokens.spacing['4xs'],
  right: tokens.spacing['4xs'],
  width: measure['3'],
  height: measure['3'],
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.full,
} as const satisfies ViewStyle;

/** A menu row. Pressed carries the same treatment the web gives hover AND keyboard highlight. */
export const MENU_ITEM = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing.xs,
  borderRadius: tokens.radius.full,
  paddingHorizontal: tokens.spacing.md,
  paddingVertical: tokens.spacing.xs,
  minHeight: measure['3'],
} as const satisfies ViewStyle;

export const MENU_ITEM_PRESSED = { backgroundColor: tokens.surface.hoverNeutral } as const satisfies ViewStyle;

export const MENU_ITEM_CHECKED = { backgroundColor: tokens.surface.weak.brand } as const satisfies ViewStyle;

/** A destructive row while pressed — the weak error surface, the web's highlighted treatment for the same row. Its ink is the label's. */
export const MENU_ITEM_DANGER_PRESSED = { backgroundColor: tokens.surface.weak.error } as const satisfies ViewStyle;

/**
 * The rule between groups — the web's `MENU_SEPARATOR`, per variant for the web's reason: a
 * pill row's ends are round, so its rule is inset to where the row's text starts; a boxed
 * panel's rule runs edge to edge.
 */
export const MENU_SEPARATOR = {
  pill: {
    marginHorizontal: tokens.spacing.md,
    marginVertical: tokens.spacing['4xs'],
    borderTopWidth: 1,
    borderTopColor: tokens.border.default.primary,
  },
  boxed: {
    marginVertical: tokens.spacing['4xs'],
    borderTopWidth: 1,
    borderTopColor: tokens.border.default.primary,
  },
} as const satisfies Record<string, ViewStyle>;

export const MENU_CONTENT = {
  paddingHorizontal: tokens.spacing['2xs'],
  paddingVertical: tokens.spacing['4xs'],
  gap: tokens.spacing['4xs'],
} as const satisfies ViewStyle;

/**
 * The `variant` axis, as the two things it actually changes on a sheet.
 *
 * `pill` IS THE EXISTING DRAW, expressed as an empty override rather than a copy of
 * `MENU_CONTENT`/`MENU_ITEM`. The web spells both of its arms out in full because class
 * ORDER is load-bearing there and `pill` has to emit byte-for-byte as before; native styles
 * are objects with no such ordering, so the same guarantee is better kept by having nothing
 * to diverge from — `pill` adds no key and the base tables are untouched.
 *
 * `boxed` is the settings popover's card: rows flush against each other inside a bordered
 * panel, and a squarer corner on the row. The web's `px-3`/`gap-3` differences are its own
 * spacing ladder and land on the nearest tokens here.
 *
 * NEITHER VALUE HAS A DESIGN SOURCE — there is no published Figma set for `Menu` at all — so
 * neither is the correct one and neither is a drift from the other. Do not reconcile them.
 */
export const MENU_VARIANT_CONTENT = {
  pill: {},
  boxed: {
    gap: 0,
    borderWidth: 1,
    borderColor: tokens.border.default.primary,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing['3xs'],
  },
} as const satisfies Record<string, ViewStyle>;

/**
 * `Menu`'s `flushRows` (UMK-1890): the Final Design's sheet rows (Chat Bar, frames 15395:14179 and
 * 15395:13956), square and spanning the sheet's whole width, with 16 on every side and 12 between
 * icon and label. Edge to edge means stepping back out over the `Dialog` body's side margin — on
 * the SCROLLER, not the rows' container: a `ScrollView` clips to its own bounds, so an overhang
 * inside it is cut off and the checked row's tint stops 16 short of each edge.
 */
export const MENU_FLUSH_SCROLL = {
  marginHorizontal: -tokens.margin.mobile,
} as const satisfies ViewStyle;

export const MENU_FLUSH_CONTENT = {
  paddingHorizontal: 0,
} as const satisfies ViewStyle;

export const MENU_FLUSH_ITEM = {
  borderRadius: 0,
  gap: tokens.spacing.sm,
  /* Longhands, not `padding`: `MENU_ITEM`'s own longhands sit earlier in the row's style array, and
     in React Native a longhand beats the shorthand whatever the order. */
  paddingHorizontal: tokens.spacing.md,
  paddingVertical: tokens.spacing.md,
} as const satisfies ViewStyle;

export const MENU_VARIANT_ITEM = {
  pill: {},
  boxed: {
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.sm,
  },
} as const satisfies Record<string, ViewStyle>;

/**
 * THE LIGHTBOX — the native reading of `lightbox-classes.ts`.
 *
 * Its scrim is DARKER than the dialog's and that is the component's own decision, not a
 * drift: the web writes `bg-black/90` here against `bg-black/40` there, because a viewer's
 * job is to remove everything but the image. Native follows with the same 90% over the token
 * black, rather than reusing `OVERLAY_SCRIM`.
 */
export const LIGHTBOX_SCRIM = {
  ...({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const),
  backgroundColor: tokens.surface.default.invert,
  opacity: 0.9,
} as const satisfies ViewStyle;

/** Full-bleed at every width — no size ladder, because there is one way this exists. */
export const LIGHTBOX_PANEL = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  padding: tokens.spacing['2xl'],
} as const satisfies ViewStyle;

/** Contained rather than cropped: a viewer that crops answers a question nobody asked. */
export const LIGHTBOX_IMAGE = {
  width: '100%',
  height: '100%',
  borderRadius: tokens.radius.md,
} as const satisfies ViewStyle;

export const LIGHTBOX_ACTIONS = {
  position: 'absolute',
  left: tokens.spacing.md,
  top: tokens.spacing.md,
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

export const LIGHTBOX_ACTION = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing['4xs'],
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.surface.default.primary,
  paddingHorizontal: tokens.spacing.sm,
  paddingVertical: tokens.spacing['3xs'],
} as const satisfies ViewStyle;

export const LIGHTBOX_CLOSE = {
  position: 'absolute',
  right: tokens.spacing.md,
  top: tokens.spacing.md,
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.surface.default.primary,
  padding: tokens.spacing['2xs'],
} as const satisfies ViewStyle;
