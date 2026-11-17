/**
 * The lightbox's class tables, in one place.
 *
 * Same siting rule as `header-classes.ts`, `sidebar-classes.ts`, `overlay-classes.ts`,
 * `feedback-classes.ts` and `field-classes.ts`: not in `utils/`, because these are component
 * chrome rather than a general mapping, and not in `contract/`, which may not name a Tailwind
 * class at all.
 *
 * A SEPARATE FILE FROM `overlay-classes.ts`, deliberately. The dialog and the menu share a
 * table because their surface, their elevation and their scrim are one visual decision. This
 * one is not that decision: it is full-bleed at every width where the dialog is a sheet then
 * a card, and its scrim is opaque enough to be the background of the image rather than a
 * dimming of the page behind. Folding it in would either fork those tables or bend them.
 *
 * NO FIGMA SET EXISTS. The values are the ones the migrating call site already renders,
 * expressed in tokens where a token exists.
 *
 * ONE PRESENTATION, AT EVERY WIDTH. Nothing below carries a responsive prefix, and the purge
 * guard asserts that: a band where this surface is not full-bleed is a band where it is not
 * this component.
 *
 * NO EXIT ANIMATIONS. Every table animates on the way IN only, and here the reason is the one
 * `overlay-classes.ts` sets out at length: this is a Radix surface, so a computed animation
 * name on close suspends the unmount waiting for an event that never arrives on this stack —
 * which strands the panel visible and hit-testable and leaks the scroll lock with it.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a
 * class named in a comment is emitted whether or not any component still uses it — which props
 * the purge guard up on its own documentation.
 *
 * BOTH GUARDS READ THIS FILE AS DATA, and the purge guard now derives BOTH of its registrations
 * — the required list AND the exit-animation check — from the whole module rather than from a
 * list a human kept, so a new table below is picked up with no edit there. One written in a shape
 * that guard cannot flatten fails its completeness check by name rather than going quietly
 * missing.
 */

import { FOCUS_RING } from '../utils';

/**
 * The scrim. Far denser than the dialog's, because it is not dimming the page behind so much
 * as being the surface the image sits on — an image viewer over a half-visible chat reads as
 * a stuck overlay rather than as a viewer.
 *
 * Same elevation token as the panel, for the reason `overlay-classes.ts` gives: they are
 * siblings in one portal and DOM order already decides.
 */
export const LIGHTBOX_SCRIM =
  'fixed inset-0 z-ds-overlay bg-default-overlay/90 data-[state=open]:animate-in data-[state=open]:fade-in-0';

/**
 * The panel. Full-bleed at every width — no size ladder and no presentation flag, because
 * there is only one way this component exists.
 *
 * The padding is what keeps the image off the edges and away from the controls; it is not a
 * width cap, so it needs no breakpoint gate.
 */
export const LIGHTBOX_PANEL =
  'fixed inset-0 z-ds-overlay flex flex-col items-center justify-center p-12 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0';

/**
 * The image. Contained rather than cropped, and bounded by the panel rather than by a chosen
 * size: the caller passes whatever the message held, and a viewer that crops it is answering
 * a question nobody asked.
 */
export const LIGHTBOX_IMAGE = 'max-h-full max-w-full rounded-lg object-contain shadow-2xl';

/** The optional affordance row, pinned clear of the image. */
export const LIGHTBOX_ACTIONS = 'absolute left-4 top-4 flex items-center gap-2';

/** One affordance. Sits on the scrim rather than on a surface, so it carries its own. */
export const LIGHTBOX_ACTION = `flex items-center gap-1.5 rounded-lg bg-default-primary px-3 py-1.5 text-ds-paragraph-mobile font-medium text-default-primary shadow-md transition-colors hover:bg-hover-neutral ${FOCUS_RING.control}`;

/** The close affordance, which is never optional. */
export const LIGHTBOX_CLOSE = `absolute right-4 top-4 rounded-lg bg-default-primary p-2 text-default-primary shadow-md transition-colors hover:bg-hover-neutral ${FOCUS_RING.control}`;

/**
 * The `light` scrim (UMK-1690, Figma `15055:57360`): the viewer opened over a light page, where the dense one
 * reads as a stuck overlay. The token at 60%; its own alpha does not reach the CSS variable, so the modifier
 * carries it.
 */
export const LIGHTBOX_SCRIM_LIGHT =
  'fixed inset-0 z-ds-overlay bg-default-overlay/60 data-[state=open]:animate-in data-[state=open]:fade-in-0';

/** The close on the `light` scrim: a 48px white round button, as the design draws it. */
export const LIGHTBOX_CLOSE_ROUND = `absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-default-primary text-default-primary shadow-md transition-colors hover:bg-hover-neutral ${FOCUS_RING.control}`;

/**
 * The body's box whenever there is a bar or a `media` slot: it takes what height the bar leaves and may shrink below
 * its content, so a tall portrait image scales down instead of pushing the bar off a phone screen. Without either,
 * the image stays a direct child of the panel, as every chat caller has it.
 */
export const LIGHTBOX_BODY = 'flex min-h-0 w-full flex-1 items-center justify-center';

/** The `media` slot's box, inside the body: bounded so a player the app passes in cannot outgrow it. */
export const LIGHTBOX_MEDIA = 'flex h-full w-full max-w-3xl items-center justify-center';

/** The labelled action bar under the media: a white pill on the scrim. */
export const LIGHTBOX_BAR = 'mt-4 flex shrink-0 items-center gap-1 rounded-full bg-default-primary px-4 py-2 shadow-md';

/** One labelled action: the icon above its label. */
export const LIGHTBOX_BAR_ACTION = `flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-2 text-ds-body-sm-mobile font-medium text-default-primary transition-colors hover:bg-hover-neutral ${FOCUS_RING.control}`;
