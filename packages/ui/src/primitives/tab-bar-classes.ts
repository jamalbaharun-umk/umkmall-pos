/**
 * The web tab bar's class tables, in one place (UMK-1757).
 *
 * Same siting rule as `sidebar-classes.ts`: component chrome, not a general mapping, and not in
 * `contract/`, which may not name a Tailwind class at all. Both guards read this file as data:
 * `tab-bar.purge.test.ts` derives its required list from the whole module, and
 * `tab-bar.stories.test.tsx` reads the tables rather than retyping them.
 *
 * THE VALUES ARE THE NATIVE BAR'S (`native/nav-styles.ts`, Figma "Teman AI v2"): a 56 high row
 * of equal cells, a 20 glyph over a 12/18 semibold label, navy when inactive and brand when
 * active, with a 2 brand line on the top edge of the active item. Two differences, both recorded
 * on the contract entry: the edge is a top border, because the token build publishes no upward
 * shadow utility for the web, and the line does not slide between items.
 *
 * MOBILE ONLY. The bar is hidden from the breakpoint up, where the sidebar is the navigation; the
 * one breakpoint is the package's.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a
 * class named in a comment is emitted whether or not anything still uses it.
 */

import { FOCUS_RING } from '../utils';

/**
 * The bar. The bottom safe area is padding under the row, so the row keeps its full height above
 * the home indicator. The inset is an arbitrary value, which the purge guard cannot falsify, so
 * the behaviour guard pins it on the element instead.
 */
export const TAB_BAR =
  'flex w-full shrink-0 border-t border-default-primary bg-default-primary pb-[env(safe-area-inset-bottom)] md:hidden';

/** One item: an equal share of the row, the whole share the target. */
export const TAB_BAR_ITEM = `relative flex h-14 min-w-0 flex-1 cursor-pointer select-none flex-col items-center justify-start gap-0.5 pt-2 outline-none focus-visible:ring-inset ${FOCUS_RING.control}`;

/** Ink per state. The glyph takes the label's colour through `currentColor`. */
export const TAB_BAR_ITEM_INK = {
  inactive: 'text-default-primary',
  active: 'text-default-brand',
} as const;

/** The 20 glyph. */
export const TAB_BAR_ICON = 'h-5 w-5 shrink-0';

/** The label: the mobile body-large step, semibold, one line. */
export const TAB_BAR_LABEL = 'max-w-full truncate text-ds-body-lg-mobile font-semibold';

/** The brand line on the top edge of the active item: 2 high, the item's full width. */
export const TAB_BAR_INDICATOR = 'absolute inset-x-0 top-0 h-0.5 bg-default-brand';
