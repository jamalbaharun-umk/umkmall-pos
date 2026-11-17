/**
 * The sidebar's class tables, in one place.
 *
 * Same siting rule as `overlay-classes.ts`, `feedback-classes.ts` and `field-classes.ts`: not
 * in `utils/`, because these are component chrome rather than a general mapping, and not in
 * `contract/`, which may not name a Tailwind class at all.
 *
 * THE BREAKPOINT IS `md`, and that is a choice rather than an inheritance. The surface this
 * shape was read off switches at `lg`; this package switches at `md` everywhere else, and one
 * package-wide breakpoint is worth more than matching one app's sidebar — a shell whose parts
 * cross over at different widths has a band where the frame and its contents disagree. The
 * divergence is recorded on the contract entry so the next reader can tell which was
 * deliberate.
 *
 * ONE ELEVATION TOKEN. The drawer and its scrim both take `z-ds-overlay`, exactly as the
 * dialog and its scrim do. They are siblings and DOM order already decides; a second value
 * would re-open the four-scale mess that token exists to have collapsed.
 *
 * NO EXIT ANIMATION — and the usual reason does NOT apply here, so do not repeat it. Radix's
 * Presence mechanism, which suspends an unmount while an exit animation is computed and
 * strands the node at a closed state, has nothing to do with this drawer: it is always mounted
 * and simply translates off-screen. It animates in only because every other surface in this
 * package does, and a shell whose parts each decided this for themselves is how the four
 * z-index scales happened.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a
 * class named in a comment is emitted whether or not any component still uses it — which props
 * the purge guard up on its own documentation.
 *
 * BOTH GUARDS READ THIS FILE AS DATA, and the purge guard now derives BOTH of its registrations
 * from the whole module rather than from a list a human kept — a new table below is picked up
 * with no edit there, and one written in a shape that guard cannot flatten fails its completeness
 * check by name rather than going quietly missing.
 */

import { FOCUS_RING } from '../utils';

/**
 * The desktop aside. Hidden below the breakpoint, where the drawer is the navigation.
 *
 * The width transition lives here rather than on the width steps so both steps get it: a
 * collapse that animates and an expand that jumps is the shape of a transition attached to one
 * side of a swap.
 */
export const SIDEBAR_ASIDE =
  'hidden h-full shrink-0 flex-col border-r border-default-primary bg-default-primary transition-all duration-300 ease-in-out md:flex';

/**
 * The rail ladder. Figma calls this `Size: Small | Large`; the component takes it as a boolean
 * — see the contract entry's divergence.
 *
 * Both steps are breakpoint-prefixed because the aside itself only exists above the
 * breakpoint, and an unprefixed width would also apply to nothing while costing a purge check
 * that cannot fail. Scale classes rather than pixel values on purpose: an arbitrary value is
 * generated from the line the expectation is read off, so the purge guard cannot falsify it.
 */
export const SIDEBAR_WIDTH = {
  small: 'md:w-16',
  large: 'md:w-72',
} as const;

/** The mobile scrim. Rendered only while the drawer is open. */
export const SIDEBAR_SCRIM =
  'fixed inset-0 z-ds-overlay bg-default-overlay/40 animate-in fade-in-0 md:hidden';

/**
 * The mobile drawer. ALWAYS MOUNTED — it is a plain element rather than a Radix surface, so
 * there is no presence machinery to unmount it and the open state is a transform.
 *
 * Which is exactly why the closed state has to hide it from the accessibility tree by hand:
 * on web both navigations are in the tree at once, and an off-screen transform is invisible
 * to a screen reader in the wrong direction — it reads the whole thing out a second time.
 */
export const SIDEBAR_DRAWER =
  'fixed inset-y-0 left-0 z-ds-overlay flex w-72 flex-col bg-default-primary md:hidden transition-transform duration-300 ease-in-out motion-reduce:transition-none';

/**
 * Open and closed are the two ends of ONE transform transition (on `SIDEBAR_DRAWER`), so the drawer
 * slides both ways. There is no `animate-in`: it only plays on mount, and this element is always
 * mounted (UMK-1041, L20).
 */
export const SIDEBAR_DRAWER_STATE = {
  open: 'translate-x-0 shadow-2xl',
  closed: '-translate-x-full pointer-events-none shadow-none',
} as const;

/** The collapse control on the rail. */
export const SIDEBAR_TOGGLE = `flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-default-secondary transition-colors hover:bg-hover-neutral hover:text-default-primary ${FOCUS_RING.control}`;

/** A slot wrapper. The list slot is the one that scrolls; the other two are fixed ends. */
export const SIDEBAR_SLOT = 'flex min-h-0 flex-col p-3';

/**
 * A row. `Menus`' `Icon Left` and `Title` are content, so they are slots rather than classes;
 * what is here is the shape they sit in.
 */
export const SIDEBAR_ITEM =
  'flex w-full cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 text-left text-default-primary outline-none transition-colors hover:bg-hover-neutral disabled:pointer-events-none disabled:opacity-50';

/** `Status: Active`. Composes with the row rather than replacing it. */
export const SIDEBAR_ITEM_ACTIVE = 'bg-weak-brand text-default-brand';

/** The indent a nested row carries. */
export const SIDEBAR_ITEM_SUB = 'pl-9';

/** The disclosure glyph on a row that owns a submenu. */
export const SIDEBAR_ITEM_DISCLOSURE =
  'ml-auto flex h-4 w-4 shrink-0 items-center justify-center text-default-secondary transition-transform';

/**
 * A SECOND, MUTED LINE under a row's label (UMK-1041) — a date under a session title. The text and
 * its description share one column so the glyph and the disclosure still sit on the row's centre.
 */
export const SIDEBAR_ITEM_TEXT = 'flex min-w-0 flex-1 flex-col';

export const SIDEBAR_ITEM_DESCRIPTION = 'block truncate text-ds-body-lg-mobile text-default-secondary';

/**
 * A CONTROL BESIDE THE ROW, NEVER INSIDE IT (UMK-1041). The row is itself a button or an anchor, and
 * an interactive child of an interactive parent is invalid markup that assistive technology reads as
 * one control. So the trailing slot is a SIBLING of the row inside a wrapper, laid over the row's
 * right edge; the row takes extra right padding so its label never runs under the control.
 */
export const SIDEBAR_ITEM_WRAP = 'group relative flex items-center';

export const SIDEBAR_ITEM_TRAILING = 'absolute right-2 flex items-center';

export const SIDEBAR_ITEM_WITH_TRAILING = 'pr-10';
