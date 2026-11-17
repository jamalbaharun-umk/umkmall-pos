/**
 * The app shell's class tables, in one place.
 *
 * Same siting rule as `sidebar-classes.ts`, `header-classes.ts` and `overlay-classes.ts`: not
 * in `utils/`, because these are component chrome rather than a general mapping, and not in
 * `contract/`, which may not name a Tailwind class at all.
 *
 * THE HEIGHT UNIT IS THE DYNAMIC ONE, and that is the whole reason this frame is worth owning
 * (UMK-653). On a phone the large viewport unit is the height the page would have with the
 * browser chrome retracted, so a shell sized in it hides its bottom hundred-odd pixels behind
 * that chrome — and because the body itself never scrolls here, the chrome can never retract
 * to hand the space back. Every app that has built this frame by hand has had to learn that
 * once. It is a class fact, so the purge guard can hold it.
 *
 * THE OVERFLOW CHAIN IS LOAD-BEARING, not tidying. The scroller belongs to the caller's
 * content, and it only scrolls if every ancestor between it and the frame refuses to grow: a
 * flex child's default minimum is its content, so one missing minimum in the chain lets the
 * content push the frame taller than the viewport and the whole page scrolls instead of the
 * region. Nothing in this package can see that happen — happy-dom has no layout engine — so
 * the chain is spelled out here where it can at least be read.
 *
 * THE BREAKPOINT IS `md`, matching `Sidebar` and the rest of this package rather than the
 * app's `lg`; the divergence is recorded once, on the sidebar's contract entry, and this frame
 * follows it. The two navigation slots are gated by opposite prefixes of that ONE breakpoint —
 * mixing them gives a width band with both navigations mounted and visible at once.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a
 * class named in a comment is emitted whether or not any component still uses it — which props
 * the purge guard up on its own documentation.
 *
 * BOTH GUARDS READ THIS FILE AS DATA, and the purge guard now derives BOTH of its registrations
 * — the required list AND the exit-animation map — from the whole module rather than from a list
 * a human kept, so a new table below is picked up with no edit there. One written in a shape that
 * guard cannot flatten fails its completeness check by name rather than going quietly missing.
 */

/**
 * The frame itself: a full-height column that does not scroll.
 */
export const SHELL_ROOT = 'flex h-dvh w-full flex-col overflow-hidden bg-default-primary';

/** The row below the header: navigation beside content. */
export const SHELL_BODY = 'flex min-h-0 flex-1 overflow-hidden';

/**
 * The content column. Its minimum is pinned on BOTH axes: the vertical one so the caller's
 * scroller can scroll, the horizontal one so a wide child (a code block, a table) scrolls
 * inside the column instead of shoving the navigation off the side.
 */
export const SHELL_MAIN = 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden';

/**
 * The two navigation slots. The rail is prefixed: an unprefixed rule would show it at every width.
 * The drawer slot is TRANSPARENT AT EVERY WIDTH (UMK-1041): it hosts a `Sidebar`, which draws its
 * own rail and its own drawer and gates each by breakpoint itself. Hiding the slot above the
 * breakpoint would hide that rail with it.
 */
export const SHELL_NAV = {
  rail: 'hidden h-full shrink-0 md:flex',
  drawer: 'contents',
} as const;

/** The header slot. It does not shrink, and it does not scroll with the content. */
export const SHELL_HEADER = 'shrink-0';

/**
 * The header slot laid OVER the content on narrow screens (UMK-1041), so whatever the content
 * paints at its top runs behind the bar unbroken. From the breakpoint up it is back in flow.
 */
export const SHELL_HEADER_OVERLAY = 'absolute inset-x-0 top-0 z-30 md:static';

/** The overlaid header positions against the frame, so the frame has to be positioned. */
export const SHELL_ROOT_RELATIVE = 'relative';

/**
 * The bottom bar slot (UMK-1757): an IN-FLOW row after the body, so the body (and the caller's
 * scroller inside it) ends above the bar with no padding on any surface. It does not shrink, and it
 * exists only below the breakpoint, where a tab bar replaces the rail.
 */
export const SHELL_BOTTOM = 'shrink-0 md:hidden';
