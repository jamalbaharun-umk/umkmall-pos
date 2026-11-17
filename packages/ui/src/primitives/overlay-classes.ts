/**
 * The class tables the two overlays share, in one place.
 *
 * Same siting rule as `feedback-classes.ts` and `field-classes.ts`: not in `utils/`, because
 * these are component chrome rather than a general mapping, and not in `contract/`, which may
 * not name a Tailwind class at all.
 *
 * `Dialog` and `Menu` share a table rather than keeping two, because their surface, their
 * elevation and their scrim are ONE visual decision — the app they replace had four z-index
 * scales precisely because each overlay kept its own copy.
 *
 * NO FIGMA SET EXISTS for either component, so unlike the feedback tables nothing below was
 * read off a published design. The values are the ones the migrated call sites already
 * render, expressed in tokens where a token exists. The Storybook stories are what a designer
 * responds to; when a set lands, this file is where its values arrive.
 *
 * It also holds the `data-*` pass-through type, for the same reason: one contract, not two
 * copies that agree until they do not.
 *
 * NO EXIT ANIMATIONS. Every table below animates on the way IN only, and that is a
 * correctness rule rather than a taste one.
 *
 * Radix mounts its overlay content behind `Presence`, which on close reads the element's
 * computed `animation-name`; if one is set it suspends the unmount and waits for a matching
 * `animationend`. On this stack that event never arrives for the `exit` keyframe, so the node
 * stays mounted at `data-state="closed"` — visible, opaque and hit-testable — and every side
 * effect Radix releases on unmount is stranded with it: the scroll lock, and the `aria-hidden`
 * it puts on the rest of the document. Dispatching a synthetic `animationend` on the stuck
 * node unmounts it instantly, which is how this was pinned down.
 *
 * The browser gate on UMK-898 caught it; the vitest suite cannot, because happy-dom unmounts
 * the content cleanly either way. `overlays.purge.test.ts` fails on a reintroduced
 * `data-[state=closed]:` animation utility, which is the part a test CAN see.
 *
 * BOTH U5 GUARDS READ THIS FILE AS DATA. The behaviour guard pulls its expected class strings
 * from `DIALOG_SIZE` rather than retyping them, and the purge guard spreads every table here
 * into its REQUIRED list. That is why the tables are exported values and not inline strings:
 * a size step that gains a class gains both of its checks with it.
 */

import { contract } from '../contract';
import { FOCUS_RING } from '../utils';

type MenuAxes = typeof contract.Menu.axes;

/**
 * Arbitrary `data-*` attributes, forwarded to a trigger or an item.
 *
 * The ONE deliberate widening of the otherwise-narrow overlay prop surface. `TutorialSpotlight`
 * finds its coach-mark anchors with `document.querySelector('[data-tutorial-target=...]')`, so
 * an item type accepting only a label, an icon and a handler would drop those attributes with
 * nothing failing to compile — and the UMK-862 coach-mark would quietly land on the wrong
 * element. Typed here rather than twice, so the two components cannot disagree about it.
 */
export type DataAttributes = { [key in `data-${string}`]?: string };

/**
 * The scrim. One token, one opacity, both components — `z-ds-overlay` is the single
 * elevation the four app scales collapse onto.
 *
 * `data-[state=*]` are Radix's own, and both overlays animate: an overlay that fades in and
 * then vanishes on close reads as a crash rather than a dismissal.
 */
export const OVERLAY_SCRIM =
  'fixed inset-0 z-ds-overlay bg-default-overlay/40 data-[state=open]:animate-in data-[state=open]:fade-in-0';

/**
 * The panel, minus its size and its presentation. `z-ds-overlay` again rather than one step
 * above the scrim: they are siblings in the same portal and DOM order already decides, so a
 * second value would be a scale nobody asked for.
 */
export const DIALOG_PANEL =
  'fixed z-ds-overlay flex flex-col bg-default-primary shadow-2xl focus:outline-none';

/**
 * Presentation. `sheet` is the responsive default — bottom sheet below `md`, centred card
 * from `md` up — and `centered` is the opt-out that is centred at every width.
 *
 * `centered` is not only a look: it is what a destructive-confirmation dialog uses to say the
 * sheet gesture must not apply. The component reads the same flag for both, so the two halves
 * cannot drift apart.
 */
export const DIALOG_PRESENTATION = {
  sheet:
    'inset-x-0 bottom-0 max-h-[88dvh] w-full rounded-t-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:data-[state=open]:zoom-in-95',
  /* The `fullHeight` variant of `sheet` (UMK-1497), spelled out in full rather than layered over `sheet`:
     tailwind-merge keeps BOTH `max-h-[88dvh]` and `max-h-none`, so an override would leave the cap in the
     class list and let stylesheet order decide. Below `md` it is the whole dynamic viewport with no top
     radius; the `md:` classes are identical to `sheet`'s, so the card is unchanged from `md` up.
     With the keyboard open `Dialog` sets `--dialog-sheet-h` (the visual viewport's height) and
     `--dialog-sheet-top` (its offsetTop): top + height are both set, so `bottom-0` is ignored and the
     sheet sits above the keyboard. Without them it is `100dvh` anchored to the bottom, as before.
     The `md:` classes reset top and height, so a card never reads the vars. */
  sheetFullHeight:
    'inset-x-0 bottom-0 top-[var(--dialog-sheet-top,auto)] h-[var(--dialog-sheet-h,100dvh)] max-h-none w-full rounded-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[85vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:data-[state=open]:zoom-in-95',
  centered:
    'left-1/2 top-1/2 max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=open]:fade-in-0',
  /* The opt-in `rounded="lg"` radius (UMK-1548): the same three presentations with the 24px `ds-2xl` token in place of
     `2xl`, spelled out in full for the reason `sheetFullHeight` is (tailwind-merge does not resolve `rounded-t-2xl` against
     `rounded-t-ds-2xl`, so layering would ship both). `rounded="default"` never reads these, so no other dialog moves. */
  sheetLg:
    'inset-x-0 bottom-0 max-h-[88dvh] w-full rounded-t-ds-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-ds-2xl md:data-[state=open]:zoom-in-95',
  sheetFullHeightLg:
    'inset-x-0 bottom-0 top-[var(--dialog-sheet-top,auto)] h-[var(--dialog-sheet-h,100dvh)] max-h-none w-full rounded-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[85vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-ds-2xl md:data-[state=open]:zoom-in-95',
  centeredLg:
    'left-1/2 top-1/2 max-h-[85vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-ds-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=open]:fade-in-0',
  /* The edge drawers (UMK-1186), at EVERY width. Full height, slide IN only — the no-exit
     rule above applies to these as much as to the rest. Kept in this table rather than in
     `Dialog.tsx` because the purge guard's exit-animation scan reads this file only. The width
     cap here holds below `md`; from `md` up the `size` step governs a drawer's width like a
     card's, so `size="small"` is the narrow drawer. */
  left: 'inset-y-0 left-0 h-full w-full max-w-sm data-[state=open]:animate-in data-[state=open]:slide-in-from-left',
  right: 'inset-y-0 right-0 h-full w-full max-w-sm data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
} as const;

/**
 * `Modal.tsx`'s `maxWidth` ladder, spelled the contract's way.
 *
 * Every step is `md:`-prefixed, exactly as the ladder it comes from: below `md` a sheet is
 * full-bleed and a centred dialog is inset by its own presentation class, so a width cap
 * there would fight both. That responsive prefix is also why the purge guard is not optional
 * — a purged size step renders an unstyled full-width panel against a green suite.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a
 * class named in a comment is emitted whether or not any component still uses it — which props
 * the purge guard up on its own documentation. That was true of this very docblock until the
 * injection proof caught it: removing the step from the table below left the suite green,
 * because the sentence above still spelled it out.
 */
export const DIALOG_SIZE = {
  small: 'md:max-w-sm',
  medium: 'md:max-w-md',
  large: 'md:max-w-lg',
  xlarge: 'md:max-w-xl',
} as const;

/**
 * The drag handle, per `docs/guidelines/swipe-to-close.md`.
 *
 * `md:hidden` is load-bearing rather than cosmetic: the handle is the ONLY grab area, so
 * hiding it above `md` is what keeps the gesture off desktop without a width check in JS.
 * `touch-none` stops the browser claiming the gesture as a scroll before the pointer handlers
 * see it.
 */
export const DIALOG_HANDLE =
  'flex shrink-0 cursor-grab touch-none justify-center pt-3 pb-1 active:cursor-grabbing md:hidden';

/**
 * The grey pill inside the handle area: 40x4, full radius, `--border-default-invert` #C3CBD3
 * (the mockup's handle, UMK-1579).
 *
 * DRAWN AS A BORDER, NOT A FILL, because no `bg-*` utility resolves to that variable and
 * `bg-default-secondary` is the SURFACE token #F6F6F6 (UMK-978), near-invisible on the white
 * sheet. `border-2` on a 4px-high box leaves no content area, so the border IS the pill.
 */
export const DIALOG_HANDLE_BAR = 'h-1 w-10 rounded-full border-2 border-default-invert';

/** The close affordance, when one is asked for. */
export const DIALOG_CLOSE = `absolute right-4 top-4 rounded-full p-1 text-default-secondary transition-colors hover:bg-hover-neutral hover:text-default-primary ${FOCUS_RING.control}`;

/**
 * WHICH OF THE TWO SHIPPED MENU TREATMENTS A SURFACE RENDERS.
 *
 * NEITHER VALUE HAS A DESIGN SOURCE. There is no published Figma set for `Menu` at all — see
 * this file's docblock — so neither treatment is the "correct" one and neither is a drift from
 * one. `pill` is the treatment slice 4 invented when it migrated the chat composer's tools
 * menu, and it is the default because that surface is live. `boxed` is DERIVED FROM THE APP'S
 * SETTINGS POPOVER (`AccountMenu.tsx`), which has always rendered square-cornered rows in a
 * bordered card — so migrating it onto this component is a port rather than a restyle of a
 * live surface. A designer reconciling the two into one set later is the expected resolution;
 * until then, do not "fix" either one into the other.
 *
 * The palette the settings popover writes by hand is spelled in tokens here — every raw value
 * it uses has a semantic token within a rounding error, and this package may not name a raw
 * palette class.
 */
export type MenuVariant = MenuAxes['variant'][number];

/*
 * EVERY VARIANT TABLE BELOW IS SPELLED OUT IN FULL rather than composed from a shared base.
 * Composing reorders the emitted string, and `pill` has to come out of these tables byte for
 * byte as it did before the axis existed — the composer renders it live, and a class-order
 * change there is a rendering change nothing in this package can see. The duplication is the
 * cheap half of that trade; edit both halves when a shared value moves.
 */

/**
 * The menu panel, per variant. Same elevation token as the dialog — a menu opened from inside
 * a dialog is portalled to the same layer, and DOM order puts the later-opened one on top,
 * which is the behaviour both migrated call sites need.
 *
 * `pill` is BYTE-FOR-BYTE what this table rendered before the variant existed; the composer is
 * live and a change here is a visible change there. `boxed` swaps the borderless, gapped panel
 * for the settings popover's bordered card: a border, its own inset, and rows that sit flush
 * against each other rather than floating apart.
 */
export const MENU_CONTENT = {
  pill: 'z-ds-overlay flex w-60 flex-col gap-1 rounded-2xl bg-default-primary py-1 shadow-10-pct data-[state=open]:animate-in data-[state=open]:zoom-in-95',
  boxed:
    'z-ds-overlay flex w-60 flex-col rounded-2xl border border-default-primary bg-default-primary p-1.5 shadow-10-pct data-[state=open]:animate-in data-[state=open]:zoom-in-95',
} as const;

/**
 * A row, per variant. `data-[highlighted]` is Radix's own attribute for the keyboard-active
 * item, and it has to carry the SAME treatment as hover — the roving tabindex moves focus
 * without a pointer, so a row that only lights on hover is invisible to a keyboard user.
 *
 * The two differ in their corner, their inset and their icon gap and in nothing else. `boxed`'s
 * three values are read off the settings popover's own row class.
 */
export const MENU_ITEM = {
  pill: 'flex w-full cursor-pointer select-none items-center gap-2.5 rounded-full px-4 py-2.5 text-left text-default-primary outline-none transition-colors data-[highlighted]:bg-hover-neutral data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  boxed:
    'flex w-full cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-left text-default-primary outline-none transition-colors data-[highlighted]:bg-hover-neutral data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
} as const;

/**
 * The rule between two groups of rows (UMK-1041). Per variant because the boxed panel's rows sit
 * flush inside an inset while the pill panel floats its rows apart, so a rule that is right in
 * one touches the edge in the other.
 */
export const MENU_SEPARATOR = {
  pill: 'mx-4 my-1 border-t border-default-primary',
  boxed: 'my-1 border-t border-default-primary',
} as const;

/** A destructive row (sign out, delete). Composes with `MENU_ITEM`, replacing its ink and highlight. */
export const MENU_ITEM_DANGER = 'text-default-error data-[highlighted]:bg-weak-error';

/** A checkable row while checked. Composes with `MENU_ITEM` rather than replacing it. */
export const MENU_ITEM_CHECKED = 'bg-weak-brand text-default-brand';

/**
 * The row that OPENS a submenu, while its submenu is open.
 *
 * Composes with `MENU_ITEM` rather than replacing it. The open state has to look like the
 * highlighted state because it IS one in every way that matters to the user: the pointer has
 * moved off the row and onto the nested panel, so `data-[highlighted]` is gone while the row
 * is still the parent of what is on screen. Without this the trail back up a nested menu is
 * invisible.
 *
 * THE TWO VARIANTS DIVERGE HERE, and deliberately rather than by oversight. The settings
 * popover marks its one submenu-opening row with the brand tint while every other row of the
 * same card hovers neutral — the row that owns what is on screen is a different thing from the
 * row the pointer happens to be over, and that surface already says so. `pill` keeps neutral
 * because that is what the live composer renders and it has no submenu to argue otherwise.
 */
export const MENU_SUB_TRIGGER = {
  pill: 'data-[state=open]:bg-hover-neutral',
  boxed: 'data-[state=open]:bg-weak-brand',
} as const;

/**
 * The nested panel, per variant. A SEPARATE table from `MENU_CONTENT`, not an alias of it.
 *
 * Narrower, because a nested panel sits beside its parent and the pair has to fit a phone
 * width, and it fades rather than scaling: a nested panel that zooms out of its own trigger
 * reads as a second menu appearing from nowhere instead of as a level below the row.
 *
 * SAME ELEVATION TOKEN, deliberately. It is a sibling in the same portal layer and DOM order
 * already puts the later-opened panel on top — a second value here would re-open the scale
 * this file exists to have collapsed.
 *
 * IT TAKES ITS PARENT'S VARIANT. A boxed menu whose nested rows come back as pills is the bug
 * this axis is most likely to grow, because the recursion is a separate call and the default
 * would quietly serve it.
 *
 * ANIMATES IN ONLY, like every table above, and for the reason in this file's docblock: an
 * exit animation suspends Radix's unmount and strands the node at `data-state="closed"`.
 */
export const MENU_SUB_CONTENT = {
  pill: 'z-ds-overlay flex w-56 flex-col gap-1 rounded-2xl bg-default-primary py-1 shadow-10-pct data-[state=open]:animate-in data-[state=open]:fade-in-0',
  boxed:
    'z-ds-overlay flex w-56 flex-col rounded-2xl border border-default-primary bg-default-primary p-1.5 shadow-10-pct data-[state=open]:animate-in data-[state=open]:fade-in-0',
} as const;

/**
 * The popover panel (UMK-1185). Extracted from `DateTimeInput`'s inline calendar surface, so the
 * values are that surface's: the bordered card with a large radius. Same elevation token as the
 * dialog and the menu — a popover opened inside a dialog must sit above it.
 *
 * ANIMATES IN ONLY, for the reason in this file's docblock.
 */
export const POPOVER_CONTENT =
  'z-ds-overlay rounded-ds-lg border border-default-primary bg-default-primary p-ds-sm shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95';

/**
 * Per `align`: the corner the panel zooms in from, so it grows out of the edge it is anchored
 * to rather than out of its own centre.
 */
export const POPOVER_ALIGN = {
  start: 'origin-top-left',
  center: 'origin-top',
  end: 'origin-top-right',
} as const;
