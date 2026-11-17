import { BRAND_GRADIENT, FOCUS_RING } from '../utils';

/**
 * The class tables the feedback surfaces share, in one place.
 *
 * Same siting rule as `field-classes.ts`: not in `utils/`, because these are component
 * chrome rather than a general mapping, and not in `contract/`, which may not name a
 * Tailwind class at all.
 *
 * `Alert` and the `Toaster` are ONE visual — a toast is an `Alert` with `type="toast"` —
 * so their tables live together rather than being two lists that agree until they do not.
 *
 * Every value below was read off Ensyra — DS on 2026-09-05: component sets `Alerts & Toast`
 * (191:1745) and `Tooltip` (180:1707). Where a Figma hex resolved to a published token that
 * is what is written; nothing here is an approximation of a design value.
 */

/**
 * Figma draws NO stroke on an alert — the tint alone carries it, and a toast is a solid
 * fill. An earlier reading of this slice expected `border.*` to carry the severity; the
 * set says otherwise, so there is no border here to keep in sync.
 */
export const ALERT_BASE = 'flex w-full items-center gap-ds-2xs rounded-ds-md';

/**
 * Padding, type step and glyph box per size. The type steps are ABSOLUTE, not responsive:
 * Figma's Size axis IS the scale here, so unlike `Text` these carry no `lg:` sibling. That
 * also retires the large-breakpoint size pin the old Alert needed — it existed only because that
 * component overrode `Text`'s own responsive pair, and tailwind-merge resolves a conflict
 * within one modifier bucket only. Nothing overrides anything now, so there is no bucket
 * to lose. `feedback.test.tsx` asserts the absence rather than trusting it.
 */
export const ALERT_SIZE = {
  large: { box: 'px-ds-md py-ds-xs text-ds-paragraph-desktop', glyph: 'h-7 w-7' },
  medium: { box: 'px-ds-sm py-ds-2xs text-ds-paragraph-mobile', glyph: 'h-6 w-6' },
  small: { box: 'px-ds-2xs py-ds-2xs text-ds-body-lg-mobile', glyph: 'h-5 w-5' },
} as const;

/**
 * `type` is a real visual fork, not a radius change: an alert is a 10% tint of its
 * function, a toast is the solid colour. That is why `type="toast"` was deliberately not
 * wired up in slice 1 — a component that accepted it and changed only its corner would be
 * the looks-right-does-nothing failure this work exists to avoid.
 */
export const ALERT_SURFACE = {
  alert: {
    success: 'bg-weak-success',
    info: 'bg-weak-brand',
    warning: 'bg-weak-warning',
    danger: 'bg-weak-error',
  },
  toast: {
    success: 'bg-default-success',
    info: 'bg-default-brand',
    warning: 'bg-default-warning',
    danger: 'bg-default-error',
  },
} as const;

/**
 * Warning is the odd one out on both toast tables, and deliberately: `#fbbc04` is a light
 * amber, so white copy on it fails contrast where white on the other three passes. Figma
 * draws that variant with the primary ink. Do not "regularise" these to `invert`.
 */
export const ALERT_INK = {
  alert: {
    success: 'text-default-primary',
    info: 'text-default-primary',
    warning: 'text-default-primary',
    danger: 'text-default-primary',
  },
  /* `font-medium`: Figma draws every toast's copy at weight 500 (Alerts & Toast, node 191:1745,
     read 2026-10-08); nothing here set a weight, so the message inherited the page's 400. */
  toast: {
    success: 'text-default-invert font-medium',
    info: 'text-default-invert font-medium',
    warning: 'text-default-primary font-medium',
    danger: 'text-default-invert font-medium',
  },
} as const;

/** The glyph takes the function colour on an alert and the ink colour on a toast. */
export const ALERT_GLYPH_INK = {
  alert: {
    success: 'text-default-success',
    info: 'text-default-brand',
    warning: 'text-default-warning',
    danger: 'text-default-error',
  },
  toast: {
    success: 'text-default-invert',
    info: 'text-default-invert',
    warning: 'text-default-primary',
    danger: 'text-default-invert',
  },
} as const;

/**
 * THE TREATMENT TABLES — how much of the box the severity paints.
 *
 * Figma publishes NO treatment of any kind on `Alerts & Toast`: only `Type`, `Function` and
 * `Size`. This axis is entirely ours, recorded as a divergence on the contract entry, and it
 * exists because the app's own `Callout` has six looks that `Alert` could not express — 19 of
 * its 30 live instances are the left-accent shape alone.
 *
 * BUILT FROM THE PUBLISHED `callout` TOKEN GROUP, not from substitutes. `tokens.css` emits
 * `callout-{default,coach,good,warn,neg}-{surface,border,text}` — a group named for the very
 * component being migrated, whose keys ARE `Callout`'s five non-banner variants. So the
 * mapping below is read off that group rather than approximated from the `surface-weak-*`
 * tints, and `coach`'s coloured ink is the group's own value rather than something chosen to
 * look close.
 *
 * WHY `coach` IS ITS OWN TREATMENT AND NOT A `full` VARIANT. `full` is pinned byte-identical
 * to what shipped before this axis existed — every call site that passes no `treatment` must
 * render exactly as it did — so `full` keeps the flat `surface-weak-*` tint with no border.
 * `coach` is a full BORDER plus coloured ink on a green surface, which is none of that; the
 * only ways to reach it were to change `full` for every existing caller or to approximate it,
 * and approximating it is precisely what the token group exists to make unnecessary. So the
 * axis carries four values rather than the three the ticket sketched, and the extra one is
 * recorded as a divergence with its reason.
 */
const withInk = (surface: Record<string, string>, ink: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(surface).map(([fn, klass]) => [fn, `${klass} ${ink[fn]}`]),
  ) as Record<keyof typeof surface, string>;

export const ALERT_TREATMENT = {
  /* DERIVED from the two tables above rather than retyped, so "no treatment renders exactly
     as before" is true by construction instead of by two lists agreeing. */
  full: withInk(ALERT_SURFACE.alert, ALERT_INK.alert),
  accent: {
    success: 'bg-callout-good-surface border-l-4 border-callout-good-border text-callout-good-text',
    info: 'bg-callout-default-surface border-l-4 border-callout-default-border text-callout-default-text',
    warning: 'bg-callout-warn-surface border-l-4 border-callout-warn-border text-callout-warn-text',
    danger: 'bg-callout-neg-surface border-l-4 border-callout-neg-border text-callout-neg-text',
  },
  /* `success` reaches for the COACH triple, not the GOOD one — the group publishes two
     greens and they are different variants, not a duplicate. */
  coach: {
    success: 'bg-callout-coach-surface border border-callout-coach-border text-callout-coach-text',
    info: 'bg-callout-default-surface border border-callout-default-border text-callout-default-text',
    warning: 'bg-callout-warn-surface border border-callout-warn-border text-callout-warn-text',
    danger: 'bg-callout-neg-surface border border-callout-neg-border text-callout-neg-text',
  },
  /**
   * The one treatment the group does NOT cover: there is no `callout-banner-*` triple,
   * because it is a gradient. Both stops are published semantic tokens, so this asks design
   * for nothing and adds nothing to the overlay file.
   *
   * The green shifts: the stop is `#087660` where the live banner draws `#2F8A4A` — a darker
   * teal-green rather than mid grass. Accepted to avoid a design dependency, and the browser
   * check is the gate on it. A severity does not change a banner, so all four functions
   * share the fill.
   */
  banner: {
    success: 'bg-gradient-to-r from-hover-brand to-hover-success text-default-invert',
    info: 'bg-gradient-to-r from-hover-brand to-hover-success text-default-invert',
    warning: 'bg-gradient-to-r from-hover-brand to-hover-success text-default-invert',
    danger: 'bg-gradient-to-r from-hover-brand to-hover-success text-default-invert',
  },
} as const;

/** The glyph ink per treatment. On a tint it takes the function colour; on the gradient it inverts. */
export const ALERT_TREATMENT_GLYPH_INK = {
  full: ALERT_GLYPH_INK.alert,
  accent: {
    success: 'text-callout-good-border',
    info: 'text-callout-default-border',
    warning: 'text-callout-warn-border',
    danger: 'text-callout-neg-border',
  },
  coach: {
    success: 'text-callout-coach-border',
    info: 'text-callout-default-border',
    warning: 'text-callout-warn-border',
    danger: 'text-callout-neg-border',
  },
  banner: {
    success: 'text-default-invert',
    info: 'text-default-invert',
    warning: 'text-default-invert',
    danger: 'text-default-invert',
  },
} as const;

/**
 * Colour is not a channel every reader has, so each function also carries a word. Rendered
 * visually-hidden: the glyph and the tint already say it to everyone else, and a visible
 * second label would be noise on every alert in the product.
 */
export const ALERT_VARIANT_LABEL = {
  success: 'Berhasil',
  info: 'Informasi',
  warning: 'Peringatan',
  danger: 'Kesalahan',
} as const;

/** The glyph each function defaults to. Four distinct SHAPES, for the same reason. */
export const ALERT_VARIANT_ICON = {
  success: 'check-circle',
  info: 'info',
  warning: 'alert-triangle',
  danger: 'alert-circle',
} as const;

/**
 * The toast host's width — HERE rather than beside the component, so both purge guards derive
 * it from the same export they derive every other class from.
 *
 * THE WIDTH IS THE DESIGN'S, not sonner's 356px card. Figma draws the toast at 1140 on the
 * 1440 desktop frame and 328 on the 360 phone — the same box at two sizes, not two components
 * — and this one expression hits both of those numbers exactly while degrading sanely between.
 *
 * IT HAS TO BE `!important`, and that is the whole trap. `--width` alone is correct on desktop
 * and WRONG below 600px: sonner's own stylesheet has a mobile media query that sets
 * `width: 100%` beside a 16px left offset, so the container is a full viewport wide starting
 * 16px in and the last 16px — the close button — is cut off the right edge. Nothing errors, and
 * a desktop browser never shows it.
 *
 * The underscores are Tailwind's escape for a space. They are the right spelling but NOT
 * load-bearing — Tailwind normalises an un-spaced `calc(100vw-32px)` back to a valid
 * declaration on its own. The numbers are the part that can silently be wrong, so
 * `feedback.purge.test.ts` pins the emitted `width:` value rather than only the rule.
 */
export const TOASTER_WIDTH = '!w-[min(1140px,calc(100vw_-_32px))]';

/**
 * The dismiss button, shared by the toast host and the tooltip.
 *
 * One string rather than two, because the two are the same affordance and would otherwise
 * drift — the first version of this slice had them identical in two files and BOTH were
 * missing a focus ring, so a keyboard user could reach the close button and see nothing.
 * `FOCUS_RING.control` is the right half of that pair here: the focusable element IS the
 * styled element, so there is no wrapper for `focus-within` to sit on.
 */
export const DISMISS_BUTTON = `shrink-0 rounded-ds-xs opacity-80 transition-opacity hover:opacity-100 ${FOCUS_RING.control}`;

/**
 * The tooltip tip. Both colours resolve to published tokens — the dark surface is Figma's
 * `#021629`, which IS `Surface/Invert Secondary`. The app spells it `#111827` today; that
 * is drift from the design source, not a competing decision, so do not "correct" this back
 * to match those call sites.
 */
export const TOOLTIP_SURFACE = {
  dark: 'bg-hover-invert text-default-invert',
  white: 'bg-default-primary text-default-primary',
} as const;

/**
 * The arrow must take the tip's own fill, or it detaches visually at every placement.
 * Radix renders it as an `<svg>`, so the fill is a `fill-*` utility rather than `bg-*` —
 * a `bg-*` class on that element resolves to nothing and the arrow renders black.
 */
export const TOOLTIP_ARROW_FILL = {
  dark: 'fill-hover-invert',
  white: 'fill-default-primary',
} as const;

export const TOOLTIP_SIZE = {
  large: { box: 'px-ds-md py-ds-2xs text-ds-paragraph-mobile', glyph: 'h-6 w-6' },
  /* 18px is Figma's, and it is not on the spacing scale — the arbitrary value is the
     honest spelling rather than rounding the design to 16 or 20. It carries a cost: an
     arbitrary value is JIT-generated FROM this line, so it can never purge and the purge
     guard cannot falsify it (see the filter there). */
  small: { box: 'px-ds-sm py-ds-3xs text-ds-body-lg-mobile', glyph: 'h-[18px] w-[18px]' },
} as const;

/**
 * The skeleton base and its sweep.
 *
 * The sweep is a translated gradient rather than a pulsing opacity: `animate-pulse` on a
 * tinted block is what the app does in 25 places today and it reads as a flashing element
 * rather than as loading. Both colours are published — there is no skeleton token, because
 * the values it needs already have names.
 */
export const SKELETON_BASE = 'relative overflow-hidden bg-weak-neutral';

/**
 * `motion-reduce:hidden` on the SWEEP, not a stopped animation: pausing a keyframe freezes
 * it mid-travel at whatever position it had reached, which leaves a permanent bright band
 * across the placeholder. Removing the sweep leaves the base tint, which is the correct
 * reduced-motion form — still visible, simply static.
 */
export const SKELETON_SHEEN =
  'absolute inset-0 -translate-x-full animate-ds-shimmer bg-gradient-to-r from-transparent via-default-primary to-transparent motion-reduce:hidden';

export const SKELETON_SHAPE = {
  text: 'h-ds-md w-full rounded-ds-xs',
  /* A default box, like its siblings. `aspect-square` alone sets no size, so a bare
     `<Skeleton shape="circle" />` in a flex row collapses to nothing — and the story's own
     `w-10`/`w-12` overrides were hiding it. `className` still wins through `cn`. */
  circle: 'h-ds-xl w-ds-xl shrink-0 rounded-ds-full',
  rect: 'h-ds-4xl w-full rounded-ds-md',
} as const;

/**
 * PROGRESS AND SPINNER — the two components this package shipped with no table, no guard and
 * no tokens at all.
 *
 * They predate the re-baseline: `bg-green-500`, `bg-orange-500`, `bg-red-500`, `bg-gray-200`,
 * `border-t-z-primary`, `border-t-gray-500`. Every one of those renders correctly today and
 * renders nothing on the day the legacy group retires, and nothing in the package could see
 * it — they were outside all four families. Bringing them in is the prerequisite for changing
 * them at all: adding a capability to an unguarded component on a raw palette compounds the
 * debt rather than paying it.
 *
 * SLICE 6 OWNS RECONCILING THESE TWO with their native siblings, and this goes exactly as far
 * as a class table, token colours and guard coverage — no further. `Label`, the third
 * uncovered component, is untouched.
 */
export const PROGRESS_TRACK = 'w-full overflow-hidden rounded-ds-full bg-default-secondary';

/** The filled portion. `transition-all` is what animates a value change rather than snapping. */
export const PROGRESS_FILL = 'h-full rounded-ds-full transition-all duration-300';

export const PROGRESS_VARIANT = {
  default: 'bg-default-brand',
  success: 'bg-default-success',
  warning: 'bg-default-warning',
  error: 'bg-default-error',
  /* The unfilled sibling in a segmented bar — a filled segment drawn in the track's own
     colour, which is how a password-strength meter shows a step it has not reached. */
  gray: 'bg-default-secondary',
  gradient: BRAND_GRADIENT,
} as const;

/**
 * The track height, which was a hardcoded `h-1` with no way to say anything else.
 *
 * Spelled out rather than abbreviated: `Alert`, `Button`, `TextField`, `Tab`, `Chip` and
 * `Badge` all spell their size ramps, and slice 3 already reverted one abbreviation for
 * exactly this reason. `Spinner` keeps its legacy `sm|md|lg|xl` next door because changing a
 * shipped vocabulary is slice 6's call, not this plan's.
 */
export const PROGRESS_SIZE = {
  large: 'h-3',
  medium: 'h-2',
  small: 'h-1',
} as const;

/**
 * THE RADIAL FORM — the gauge a2ui's `Chart` renders, as a shape on this component rather than
 * a second one. That chart is `kind: ["gauge"]` only, across three usages; a whole component
 * for one shape of one thing is more surface to keep in step, not less.
 *
 * A DIAMETER, not a height. The linear size ramp is a track thickness and means nothing to a
 * circle, so the radial case reads its own table off the same axis rather than being sized by
 * a `className` at the call site — which is the escape hatch that made the linear height
 * hardcoded for as long as it was.
 */
export const PROGRESS_RADIAL_SIZE = {
  large: 'h-24 w-24',
  medium: 'h-16 w-16',
  small: 'h-12 w-12',
} as const;

/**
 * The arc's colour, as a text token the stroke inherits through `currentColor`.
 *
 * `stroke-current` plus a text class for the SEMANTIC arcs, which are genuinely text-family
 * colours, and it keeps them spelled the same way as the gradient stops below — those have no
 * choice, because an SVG `<stop>` reads `currentColor` and nothing else. The grey arc is the
 * exception and says why at its own entry. The COLOUR is a class and only the computed SWEEP
 * travels inline — the rule `Slider`'s track set for this package.
 */
export const PROGRESS_RADIAL_STROKE = {
  default: 'stroke-current text-default-brand',
  success: 'stroke-current text-default-success',
  warning: 'stroke-current text-default-warning',
  error: 'stroke-current text-default-error',
  /**
   * THE ONE ENTRY THAT IS NOT A TEXT TOKEN, and it stopped being able to pretend (UMK-978). The
   * unfilled/grey arc is a SURFACE grey — `#F5F5F7`, the same value the track behind it uses —
   * and it reached the stroke through `text-surface-secondary`, a surface token worn on a text
   * utility. The per-utility palettes removed that spelling by construction; sourcing it from
   * the text ramp instead would have made it `#93A2B0`, a mid-grey arc where a near-white one
   * belongs. So it names the `stroke` palette directly, at the value it always had.
   */
  gray: 'stroke-default-secondary',
  /**
   * THE ARC CANNOT TAKE A CSS GRADIENT — an SVG stroke reads a paint server, not a background —
   * so this value's colour lives on the two `<stop>` elements and the stroke points at them
   * through a paint reference. `PROGRESS_RADIAL_GRADIENT_STOPS` holds that pair.
   *
   * NO `stroke-current` HERE, and that is the whole entry. A CSS `stroke` beats the
   * presentation attribute that names the paint server, so keeping the sibling values' class
   * silently replaced the gradient with `currentColor` — which, with no text class on the
   * circle, painted the arc BLACK while every assertion passed. Only a browser could see it.
   *
   * The token class is the SVG paint FALLBACK, not decoration: the stroke is written
   * `url(#id) currentColor`, so an unresolvable gradient paints brand rather than black.
   */
  gradient: 'text-default-brand',
} as const;

/**
 * The radial gradient's stops, as TOKEN CLASSES on the stop elements.
 *
 * `stopColor="currentColor"` is the plumbing; the colour itself is a class, exactly as it is
 * everywhere else in this file. Writing the token into a `stopColor` attribute instead would
 * put a colour value back into markup, which is the thing the class-only rule exists to stop.
 */
export const PROGRESS_RADIAL_GRADIENT_STOPS = {
  from: 'text-default-brand',
  to: 'text-hover-brand',
} as const;

/** The unfilled ring behind the arc — the radial reading of the linear track. */
export const PROGRESS_RADIAL_TRACK = 'stroke-default-secondary';

export const PROGRESS_LABEL = 'flex items-center justify-between text-ds-body-lg-mobile';
export const PROGRESS_LABEL_TEXT = 'text-default-secondary';
export const PROGRESS_LABEL_VALUE = 'font-medium text-default-primary';

/**
 * `motion-reduce:animate-none` is on the BASE, not on a variant.
 *
 * A spinner is a pure animation, so with the animation suppressed it is a static ring — which
 * is the correct reduced-motion answer, and the reason the busy state has to reach assistive
 * technology through `role`/`aria-label` rather than through the movement.
 */
export const SPINNER_BASE =
  'inline-block animate-spin rounded-ds-full border-2 border-transparent motion-reduce:animate-none';

/**
 * Two adjacent sides, which is what makes a uniform ring read as a rotating arc. Dropping to
 * one side leaves a spinning dot; keeping all four leaves a ring with no apparent motion.
 */
/**
 * The gradient spinner is a FILLED disc with the middle punched out, not a bordered ring.
 *
 * A border cannot carry a gradient at all, so the ring shape has to come from a mask: the
 * gradient paints the whole circle and an inner circle in the page's own surface removes the
 * centre. `inset-0.5` is the 2px the bordered variants spend on their border, so both forms
 * draw a ring of the same weight at every size.
 */
/**
 * A CONIC SWEEP, not the shared linear one — and only a browser could say why.
 *
 * The linear pair painted a ring that is very nearly one colour all the way round, so it had
 * no apparent rotation at all: a spinner that does not look like it is spinning, against a
 * fully green suite. A conic gradient fading out of the brand colour is the arc the live
 * loader draws, and it is the only shape that reads as motion on a ring.
 *
 * The arbitrary value is `Slider`'s documented escape, used the same way: the colour is a
 * TOKEN REFERENCE rather than a literal, so nothing here is a hex and repointing the token
 * repoints this. Tailwind publishes no conic utility, which is why the escape is needed at
 * all.
 */
export const SPINNER_GRADIENT_FILL =
  '[background:conic-gradient(from_0deg,transparent,rgb(var(--surface-default-brand)))]';
export const SPINNER_GRADIENT_MASK = 'absolute inset-0.5 rounded-ds-full bg-default-primary';

export const SPINNER_VARIANT = {
  primary: 'border-t-default-brand border-r-default-brand',
  white: 'border-t-default-light border-r-default-light',
  gray: 'border-t-default-primary border-r-default-primary',
  /**
   * NO BORDER INK, deliberately: this variant's colour is the fill, and leaving a border
   * colour here would draw a second coloured arc on top of the gradient. The shape check
   * exempts it by name rather than by weakening the rule for the other three.
   */
  gradient: 'border-transparent',
} as const;

export const SPINNER_SIZE = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
} as const;
