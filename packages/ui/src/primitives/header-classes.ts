/**
 * The header's class tables, in one place.
 *
 * Same siting rule as `sidebar-classes.ts`, `overlay-classes.ts`, `feedback-classes.ts` and
 * `field-classes.ts`: not in `utils/`, because these are component chrome rather than a
 * general mapping, and not in `contract/`, which may not name a Tailwind class at all.
 *
 * SEVEN TREATMENTS, ONE PER PUBLISHED TYPE. The axis is mirrored whole rather than trimmed to
 * the values a consumer exists for today — see the contract entry, which records both that the
 * axis conflates three unrelated facts and that the separators in the published names were
 * normalised. The values differ only by class, which is why the purge guard checks the seven
 * strings are distinct: two collapsing onto one look is a treatment the library claims and
 * does not have, and no behaviour assertion can see it.
 *
 * THE MOBILE/DESKTOP AXIS IS A BREAKPOINT, NOT A PROP. The published set publishes a `Size`,
 * but the two values are one bar at two widths rather than two components — so the parts that
 * change carry `md:` and there is no size prop at all. Recorded as a divergence on the
 * contract entry. Every part that reflows is asserted individually in the purge guard: a
 * contributor that loses its gate freezes at one size while the rest of the bar follows.
 *
 * ONE BREAKPOINT, the package's `md`, for the reason `sidebar-classes.ts` gives at length.
 *
 * SEMANTIC TOKENS ONLY. No palette step, no literal colour — a colour written literally
 * survives every purge check in the guard and silently opts this component out of theming.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a
 * class named in a comment is emitted whether or not any component still uses it — which props
 * the purge guard up on its own documentation.
 *
 * BOTH GUARDS READ THIS FILE AS DATA, and the purge guard now derives BOTH of its registrations
 * from the whole module rather than from a list a human kept (KTD18c) — a new table below is
 * picked up with no edit there. The one export that is a vocabulary rather than classes is
 * excluded there BY NAME; anything else that guard cannot flatten fails its completeness check.
 */

import { contract } from '../contract';
import { FOCUS_RING } from '../utils';

type Axes = typeof contract.Header.axes;

/**
 * The published `Type` values, spelled per the package's vocabulary. See `HEADER_TYPE`.
 *
 * IT IS THE CONTRACT'S ARRAY, not a copy that happened to agree with it. The two were equal
 * byte-for-byte and nothing compared them, so either could have been widened alone (UMK-900).
 */
export const HEADER_TYPES = contract.Header.axes.type;

export type HeaderType = Axes['type'][number];

/**
 * The bar itself. The height and the horizontal inset are the whole of the mobile/desktop
 * axis, so they are the classes the purge guard checks individually.
 *
 * The transition lives here rather than on the scroll states so both directions get it: a
 * shadow that fades in and snaps out is the shape of a transition attached to one side.
 */
export const HEADER_BASE =
  'w-full shrink-0 px-4 py-2 transition-all duration-300 md:px-6 md:py-3';

/** One treatment per published type. */
export const HEADER_TYPE: Record<HeaderType, string> = {
  nonLogin: 'bg-default-primary text-default-primary',
  nonLoginBlack: 'bg-default-invert text-default-invert',
  login: 'bg-default-primary text-default-primary border-b border-border-light',
  temanAiLearn: 'bg-weak-brand text-default-primary border-b border-default-brand',
  temanAiChat: 'bg-default-primary text-default-primary backdrop-blur-sm',
  dashboard: 'bg-default-secondary text-default-primary border-b border-border-light',
  detailPage: 'bg-default-primary text-default-primary border-b border-default-primary',
};

/**
 * The scroll state. Both steps carry a class rather than one being the empty string, so the
 * swap is a swap: an absent idle value leaves the scrolled shadow on the element forever once
 * anything else on the bar re-renders with it merged in.
 */
export const HEADER_SCROLL = {
  idle: 'shadow-none',
  scrolled: 'shadow-sm',
} as const;

/** The row inside the bar. */
export const HEADER_BAR = 'mx-auto flex w-full max-w-4xl items-center justify-between gap-3';

/**
 * The row when the bar has a CENTRED slot (UMK-1041): three columns, the outer two equal, so the
 * middle one is truly centred whatever either side holds. A flex bar with `justify-between` centres
 * it only when both sides happen to be the same width.
 */
export const HEADER_BAR_CENTERED =
  'mx-auto grid w-full max-w-4xl grid-cols-[1fr_auto_1fr] items-center gap-3';

/** The bar's ground while it is transparent at the top (UMK-1041). Substituted for the type's ground, never stacked on it. */
export const HEADER_TRANSPARENT = 'bg-transparent';

/** The default back control, and the class set a caller-supplied one inherits. */
export const HEADER_BACK = `flex shrink-0 items-center gap-2 rounded-full border border-border-light px-3 py-1.5 text-ds-paragraph-mobile font-medium transition-colors hover:bg-hover-neutral ${FOCUS_RING.control}`;

/** The title. Reflows with the bar. */
export const HEADER_TITLE = 'min-w-0 truncate text-ds-paragraph-desktop font-medium md:text-ds-h6-desktop';

/** The actions slot. */
export const HEADER_ACTIONS = 'flex shrink-0 items-center gap-2';

/** The tab strip, below the row. Scrolls sideways rather than wrapping the bar into two. */
export const HEADER_TABS =
  'mx-auto flex w-full max-w-4xl items-center gap-4 overflow-x-auto pt-2 md:pt-3';
