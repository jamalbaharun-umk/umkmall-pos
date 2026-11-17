/**
 * The chat composer family's class tables, in one place.
 *
 * Same siting rule as every other `*-classes.ts` here: not in `utils/`, because these are one
 * component's chrome rather than a general mapping, and not in `contract/`, which may not name
 * a Tailwind class at all.
 *
 * ONE FILE FOR THE WHOLE FAMILY. The shell, the editor, the drawer, the attachment and the four
 * round buttons are eight contract entries under one `family: 'composer'`, covered by one guard
 * pair — which is what a family is for, and what keeps eight components from needing eight
 * allowlist rows naming eight pairs. The purge guard derives its expectations from this module's exports, so a table added
 * below is picked up with no edit there.
 *
 * ONE PRESENTATION, NOT TWO. `01 Chat Bar` publishes a Desktop and a Mobile drawing, and this
 * shipped briefly with both as a `variant` prop. They are collapsed onto the MOBILE values by
 * product decision: the surface is one composer at every width, and the compact spacing is the one
 * it wants. `Header` reaches the same single-presentation answer from the same published pair, so
 * the two entries no longer disagree. One exception, by name (UMK-1755): the V2 hero takes the
 * Desktop radius and padding from `md` — see `COMPOSER_HERO_EDGE`.
 *
 * The published WIDTHS go with the axis rather than surviving it. 760 and 328 are artboard
 * measurements — the frame a designer drew the composer inside — not a constraint on the
 * component, which is full-width in every surface that renders it. Capping it at 328 would have
 * been the artboard leaking into the API.
 *
 * EVERY OTHER VALUE IS READ OFF `01 Chat Bar` (`812:489`), not off the app's current composer.
 * The exception is the ACTIVE treatment: the published set draws no focus state at all, so the
 * shell's is built from this package's own focus tokens rather than copied from the app's
 * untokenised one. See the note on `COMPOSER_BASE`.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a
 * class named in a comment is emitted whether or not any component still uses it — which props
 * the purge guard up on its own documentation.
 */

import { contract } from '../contract';
import { FOCUS_RING } from '../utils';

/**
 * The shell, including its resting and ACTIVE treatments.
 *
 * `field` rather than `control` for the ring: the focusable element is the editor inside, so focus
 * has to be detected on the wrapper.
 *
 * THE ACTIVE STATE IS THIS PACKAGE'S, NOT THE APP'S. `01 Chat Bar` publishes no focus state, and
 * the app's is a raw palette colour with a hand-written ring — which this file may not carry (the
 * purge guard bans a palette step outright) and which the parity rule says not to copy anyway: the
 * target is the design system, never the surface's legacy styling. The colour is BRAND, settled.
 *
 * IT TAKES `FOCUS_RING.surface`, NOT `.field`, AND THE REASON IS VISUAL RATHER THAN STYLISTIC.
 * `field` pairs a STRONG border colour with a PALE ring colour — two lightnesses of one hue. On a
 * checkbox or a text input the two read as a single treatment; on a surface this large they
 * separate, and the strong inner edge reads as a dark line drawn INSIDE a pale glow. `surface`
 * draws both the border and the halo in the PALE stop, so the band is one hue at one strength and
 * there is no hairline inside it. The app arrives at the same shape from the other direction — its
 * border and ring are both pale teal.
 *
 * Redefining `field` itself was the alternative and is rejected: six form controls read it, and
 * they are exactly the small controls the two-tone pair suits. The new role lives in
 * `focus-ring-classes.ts` with the other two, because that file is the only place the focus token
 * may be named — the containment that keeps UMK-872's rename a one-line change.
 *
 * The SHADOW is the part the published set genuinely lacks and the surface genuinely has: a
 * composer with no elevation reads as a block of the page rather than as something to type into.
 * It lifts on focus, which is the rest of the active state a user perceives.
 */
export const COMPOSER_BASE = `flex w-full flex-col border border-default-primary bg-default-primary shadow-sm transition-shadow focus-within:shadow-md ${FOCUS_RING.surface}`;

/**
 * The hero's lift (UMK-1041, L19): a composer that is the page's subject, not a row in a thread.
 * Listed AFTER `COMPOSER_BASE` so its larger shadow wins over the base's resting and focus shadows
 * for the reason every later utility does — they sit in the same layer and the stylesheet order is
 * what decides, and `cn` (tailwind-merge) drops the base's shadow when both are passed.
 */
export const COMPOSER_RAISED = 'shadow-xl focus-within:shadow-xl';

/**
 * THE V2 HERO'S EDGE AND DESKTOP SHAPE (UMK-1755), on top of `COMPOSER_RAISED` and only with it: `ChatComposer`'s `heroEdge`.
 * Its own table since the web Beranda v2 went behind `temanai-web-beranda-v2`: a hero from before it keeps the lift alone.
 *
 * THE EDGE: Figma's home `01 Chat Bar` strokes the hero brand → success, top to
 * bottom, at every width (the desktop frame draws it left to right; the author chose one direction,
 * as the mobile frame and native draw it). CSS cannot paint a border with a gradient, so the BORDER
 * goes transparent and the BOX paints two backgrounds: the surface's white clipped to the padding
 * box, the gradient clipped to the border box, which shows only through the transparent border.
 * The border stays transparent on focus too, so the base's halo border cannot repaint the edge; the
 * halo ring outside it is the focus cue. Semantic stops only: the success stop is darker than the
 * frame's green, which is a palette step this table may not name.
 *
 * FROM `md`, THE DESKTOP SHAPE: the published Desktop radius (24) and padding (20 by
 * 32). The one exception to the single presentation described at the top of this file, by the
 * author's decision; the purge guard allows exactly these three responsive classes, here only. They
 * override the shell's compact radius and padding because a responsive rule comes after the base
 * rules in the stylesheet, and `cn` keeps both since their variants differ.
 */
export const COMPOSER_HERO_EDGE =
  'border-transparent focus-within:border-transparent [background:linear-gradient(rgb(var(--surface-default-primary)),rgb(var(--surface-default-primary)))_padding-box,linear-gradient(to_bottom,rgb(var(--surface-default-brand)),rgb(var(--surface-default-success)))_border-box] md:rounded-ds-2xl md:px-ds-2xl md:py-ds-lg';

/** Radius, padding and gap. One set — see the note on the collapsed axis above. */
export const COMPOSER_SHELL = 'w-full rounded-2xl p-4 gap-5';

/** The editor box, which owns the affordance slot pinned inside its top-right corner. */
export const COMPOSER_EDITOR_BOX = 'relative w-full';

/**
 * The editor itself. It autogrows, so it carries no fixed row count — the library's multiline
 * field takes one and could not serve here.
 */
export const COMPOSER_EDITOR =
  'w-full resize-none bg-transparent text-ds-paragraph-mobile leading-5 text-default-primary outline-none placeholder:text-default-secondary disabled:cursor-not-allowed disabled:opacity-60';

/** The slot anchored inside the editor box, top-right — the mobile fullscreen trigger's home. */
export const COMPOSER_EDITOR_AFFORDANCE = 'absolute right-0 top-0';

/** The control row. Leading group left, trailing group right, per the published frame. */
export const COMPOSER_ROW = 'flex w-full items-end justify-between gap-2';

export const COMPOSER_GROUP = 'flex items-center gap-2';

/**
 * The DRAWER — a ROW inside the tray, not a panel of its own.
 *
 * IT CARRIES NO FILL AND NO BORDER when it sits in a composer, and that is the correction this
 * shape went through. It shipped once as its own bordered panel floating above the bar, which drew
 * TWO stacked containers with a gap between them: the reference surfaces draw ONE tray, tinted
 * once, with the white editor box resting inside it. The tint therefore belongs to the tray (see
 * `COMPOSER_TRAY_TONE`) and the drawer inherits it, so a colour is chosen in one place.
 *
 * `items-center` rather than `items-start`: what a drawer holds is usually one row — chips, or an
 * icon beside a line of text — and top-aligning a 20px icon against a 20px line looks accidental.
 */
export const COMPOSER_DRAWER = 'w-full flex-wrap items-center gap-3 rounded-2xl p-3';

/**
 * The drawer's two display states, as CLASSES rather than the `hidden` ATTRIBUTE.
 *
 * THIS IS A BUG FIX, NOT A STYLE. The collapse shipped as `hidden={isCollapsed}` on a node whose
 * class list already said `flex` — and a class beats the UA stylesheet's `[hidden] { display: none }`
 * every time, so the attribute was set, the state was correct, and the drawer never collapsed.
 * happy-dom made it worse: it applies no UA stylesheet at all, so a guard reading the attribute
 * passed either way. The row's display now comes from ONE place, which is the only arrangement in
 * which the two cannot disagree.
 */
export const COMPOSER_DRAWER_DISPLAY = { open: 'flex', collapsed: 'hidden' } as const;

/**
 * The drawer's OWN treatments, for a drawer used outside a composer tray.
 *
 * `inherit` IS THE DEFAULT AND IT IS EMPTY ON PURPOSE. Inside a composer the tray is already
 * tinted, so a drawer that painted itself would draw a second, differently-shaded panel on top of
 * the first — the doubling this file corrected. The other four exist because a drawer is a usable
 * container on its own (a file-picker list, a reply-to preview), and there it has to carry its own
 * surface or it is invisible.
 *
 * REUSES THE PUBLISHED `callout` GROUP AND `Alert`'s VOCABULARY rather than inventing either. The
 * token group `callout-{default,coach,good,warn,neg}-{surface,border,text}` is named for exactly
 * this shape — a filled, bordered panel carrying a message — and `feedback-classes.ts` already
 * maps it. The axis values are `Alert`'s, which is why the loud one is `danger` and NOT `error`:
 * that is Figma's word, and slice 3 is where this package stopped saying error. One vocabulary
 * across the alert, the toast and the composer.
 */
export const COMPOSER_DRAWER_VARIANT = {
  inherit: '',
  neutral: 'border border-default-primary bg-default-secondary text-default-primary',
  info: 'border border-callout-default-border bg-callout-default-surface text-callout-default-text',
  warning: 'border border-callout-warn-border bg-callout-warn-surface text-callout-warn-text',
  danger: 'border border-callout-neg-border bg-callout-neg-surface text-callout-neg-text',
  /**
   * native-ui-v2's floating sidebar. NATIVE draws the whole presentation (modal, scrim, inset
   * panel, motion — `native/ChatDrawer.tsx`); the web follows no part of that identity and only
   * PAINTS the value, as the glass fill and hairline, so the contract's one vocabulary holds on
   * both platforms. Nothing on the web renders it.
   */
  floating: 'border border-glass-default bg-glass-strong text-default-primary',
} as const;

/**
 * The collapse TOGGLE, and the thin line it draws when the drawer is open.
 *
 * ONE ELEMENT, ONE MEANING. An earlier draft drew a decorative handle behind a `showHandle`
 * boolean while the drawer could not collapse — a control that looks draggable and does nothing,
 * which is an affordance lie. It appears exactly when the drawer IS collapsible, and pressing it
 * is what collapses it.
 *
 * THE LINE IS DELIBERATELY SMALL. It shipped at `h-1 w-9` in the pale border colour, which reads
 * as a sheet's drag handle — a promise of a gesture this is not — and at that size and lightness it
 * competes with the attachments beside it. Shorter, thinner and darker reads as a hairline rule
 * that happens to be pressable, which is what it is.
 */
export const COMPOSER_DRAWER_TOGGLE = `flex w-full shrink-0 basis-full items-center justify-center rounded-lg py-1 ${FOCUS_RING.control}`;

/**
 * AND IT IS THE DARK STOP AT 25%, NOT A GREY TOKEN, BECAUSE THERE IS NO LONGER A GREY ONE
 * (UMK-978). The handle rested on `#C3CBD3` — `Neutral/N40`, reached through `Border/Invert` on
 * a background utility. The restructure publishes no `N40` step in `Surface` at any state, and
 * the per-utility palettes make a border token unsayable as a background by construction. The
 * two Surface steps either side of it are `#E6E9ED`, which is the pale grey the guard next door
 * exists to keep this handle out of, and `#021629`, which is near-black.
 *
 * So it takes the dark stop through Tailwind's opacity modifier: 25% of `#021629` composites to
 * `#C0C5CA`, four values off what it rendered before. That is a real token and a first-class
 * mechanism — the pipeline stores channels precisely so `<alpha-value>` works — rather than an
 * invented hex, and it is why this is not a visual change.
 */
export const COMPOSER_DRAWER_HANDLE =
  'block h-[3px] w-6 rounded-full bg-hover-invert/25 transition-colors group-hover:bg-default-invert';

/**
 * The COLLAPSED SUMMARY — what the toggle renders instead of the line once the drawer is shut.
 *
 * A collapsed drawer with only a hairline above the editor says nothing about what it is holding,
 * so a user who collapsed four files has no way to know they are still attached and still about to
 * be sent. The summary is the drawer's collapsed FACE, and it is the same control: pressing it
 * opens the drawer again.
 *
 * ITS CONTENT IS THE HOST'S, and that is the same rule the buttons' labels follow. "4 Attachments"
 * is copy in a specific language about a specific kind of content, and a container that holds
 * arbitrary children cannot know whether it is holding files, chips or a waveform. The component
 * owns the row and the affordance; the host owns the words.
 */
export const COMPOSER_DRAWER_SUMMARY = 'flex w-full items-center gap-3 text-left text-ds-paragraph-mobile leading-5';

/** The dismiss affordance, present only when the caller supplies a handler for it. */
export const COMPOSER_DRAWER_DISMISS = `ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-default-secondary transition-colors hover:bg-hover-neutral ${FOCUS_RING.control}`;

/** One attachment, whichever treatment it takes — the anchor its own overlays position against. */
export const COMPOSER_ATTACHMENT = 'relative shrink-0';

/** The image treatment: a rounded preview. `default` is the published 80px; `large` is the 96px the app's picker draws. */
export const COMPOSER_PREVIEW_SIZE = {
  default: 'h-20 w-20',
  large: 'h-24 w-24',
} as const;

export const COMPOSER_PREVIEW = 'overflow-hidden rounded-lg bg-default-secondary';

/** The caption under a preview, as wide as the preview so a long name truncates instead of widening the tile. */
export const COMPOSER_CAPTION_WIDTH = {
  default: 'w-20',
  large: 'w-24',
} as const;

export const COMPOSER_CAPTION = 'mt-1.5 truncate text-center text-ds-paragraph-mobile leading-5 text-default-primary';

/** The preview as a button: opens the host's lightbox. */
export const COMPOSER_PREVIEW_BUTTON = `block cursor-pointer rounded-lg transition-opacity hover:opacity-90 ${FOCUS_RING.control}`;

/** The words under the status spinner, host-supplied. */
export const COMPOSER_STATUS_LABEL = 'px-1 text-center text-ds-legacy-xs font-medium leading-tight';

export const COMPOSER_PREVIEW_IMAGE = 'h-full w-full object-cover';

/** The close circle, pinned to the preview's top-right corner at the published 22px. */
export const COMPOSER_CLOSE = `absolute -right-2 -top-2 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-default-primary bg-default-primary p-1 text-default-primary ${FOCUS_RING.control}`;

/**
 * The FILE treatment — the one Figma publishes and the app never built.
 *
 * The app renders a document as the same grey square as an image; its type-branching helper has
 * four branches that all return identical grey classes, so the colour hook exists and is inert.
 * This is the design that was intended: a bordered card carrying a coloured extension badge, the
 * filename, and a type label.
 */
export const COMPOSER_FILE_CHIP =
  'flex items-end gap-2 rounded-xl border border-default-primary bg-default-primary py-1.5 pl-1.5 pr-4';

/** The extension badge. ponytail: arbitrary rem, so it does NOT follow --ds-text-scale (10px has no
 *  token without a 16px line-height). Its fill is the success surface — the green the published chip draws. */
export const COMPOSER_FILE_BADGE =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded bg-default-success text-ds-legacy-10 font-semibold uppercase text-default-invert';

/** The square non-image tile: a file icon over its extension, sized by `COMPOSER_PREVIEW_SIZE`. */
export const COMPOSER_FILE_TILE =
  'flex flex-col items-center justify-center rounded-lg border-2 border-default-primary bg-default-secondary p-2';

/** Nearest type token to the picker's 9px is `ds-legacy-10`. */
export const COMPOSER_FILE_TILE_EXT = 'text-ds-legacy-10 font-medium uppercase tracking-wide text-default-primary';

export const COMPOSER_FILE_TEXT = 'flex min-w-0 flex-col';

export const COMPOSER_FILE_NAME = 'truncate text-ds-paragraph-mobile leading-5 text-default-primary';

/** The type label, and — when `showSize` is on — the size beside it. */
export const COMPOSER_FILE_META = 'text-ds-legacy-xs leading-4 uppercase text-default-secondary';

/**
 * Per-attachment upload status, drawn INSIDE the attachment it belongs to.
 *
 * This is the exception KTD6 names: these overlays are children of each individual tile, not a
 * bar over the attachment area, so an app cannot position them — it does not own the chips'
 * layout or their count. The component owns the positioning and the app owns the state.
 */
export const COMPOSER_STATUS = {
  idle: 'hidden',
  uploading:
    'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-default-overlay/40 text-default-invert',
  compressing:
    'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-default-overlay/40 text-default-invert',
  error:
    'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-default-error/60 text-default-invert',
  done: 'pointer-events-none absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-default-success text-default-invert',
} as const;

/** The positioning context for the absolutely-placed overlay slot. */
export const COMPOSER_OVERLAY = 'relative';

/**
 * The outer column: header, the bordered box, footer.
 *
 * IT CARRIES NO BORDER AND NO FOCUS TREATMENT — that is the whole reason it exists. Only the box
 * inside it is focusable chrome, so a drawer in the header does not get the focus band drawn
 * around it when the editor is focused.
 *
 * It carries no padding or fill either, because a composer with no slots filled is a bare bar.
 * The tray below is what turns it into a container, and only when there is something to contain.
 */
export const COMPOSER_OUTER = 'flex w-full flex-col';

/**
 * THE TRAY — the tinted panel the editor box rests inside, added to the outer column only when a
 * `header` or `footer` is actually filled.
 *
 * NO PADDING AND NO GAP, WHICH IS THE POINT. The tray held `p-2` briefly, so the editor box sat
 * inset on all four sides and the tint framed it like a border. The reference surfaces tuck the
 * tray UNDER the box instead: it shows only where a slot actually is, and the box runs to its
 * edges everywhere else. Whatever breathing room the slot needs is the SLOT's padding
 * (`COMPOSER_DRAWER`), not the tray's — put it here and every slot inherits spacing it did not ask
 * for, including one that wants to sit flush.
 *
 * CONCENTRIC, AND THE TWO NUMBERS ARE ONE MEASUREMENT. The tray's radius is the box's radius plus
 * the inset it sits at, so with no inset the two radii are equal. Any other pairing makes the
 * inner corner look either pinched or loose against the outer one — change one and change the
 * other, which is the coupling that justifies both living on one line.
 *
 * WHY A TRAY AND NOT TWO STACKED PANELS. The earlier shape drew the drawer as its own bordered
 * panel above a separate bordered bar, with a gap showing the page between them. The reference
 * surfaces draw one container: the tint runs behind the editor box and shows as a margin around
 * it, which is what makes the drawer read as part of the composer rather than as a notification
 * that happens to be sitting on top of it.
 *
 * The gap is what separates the drawer row from the box; the tint fills it, so the seam reads as
 * one panel rather than two.
 */
export const COMPOSER_TRAY = 'rounded-2xl';

/**
 * The tray's tone — and it lives on the TRAY rather than on each slot for a reason worth keeping.
 *
 * There is one tinted surface per composer, so there is one place to tint. Putting the choice on
 * the drawer instead let a caller set a colour that the tray behind it then contradicted, which is
 * the doubling `COMPOSER_DRAWER` describes. The cost is real and accepted: a composer cannot show
 * a danger header and a warning footer at once. It gets one voice, which is also the honest
 * reading of a surface that is trying to tell the user one thing.
 *
 * Same vocabulary as the drawer's own variants — `Alert`'s values on the published `callout`
 * group — so `tone` and `variant` never need translating between each other.
 *
 * `neutral` takes the plain secondary surface: holding attachments is not a message about
 * anything.
 */
export const COMPOSER_TRAY_TONE = {
  neutral: 'bg-default-secondary text-default-primary',
  info: 'bg-callout-default-surface text-callout-default-text',
  warning: 'bg-callout-warn-surface text-callout-warn-text',
  danger: 'bg-callout-neg-surface text-callout-neg-text',
} as const satisfies Record<(typeof contract.ChatComposer.axes.tone)[number], string>;

/**
 * The round control shared by all four composer buttons.
 *
 * ONE BASE, FOUR COMPONENTS. `02 Tools` publishes a single component with a `Type` axis and this
 * package ships four named components instead (see the contract divergence). The treatment they
 * share lives here so "a composer button" has one definition; what differs per button is its
 * RESTING and ACTIVE fill, and those are per-component precisely because they are not the same
 * decision.
 *
 * `control` rather than `field` for the ring: the focusable element IS the styled one here.
 */
export const COMPOSER_BUTTON_BASE = `inline-flex shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed ${FOCUS_RING.control}`;

/**
 * The button's box. `landing` is the hero composer's 36px, matching the voice bar it swaps with
 * (`COMPOSER_VOICE_BAR_SIZE`) so the row does not jump; `compact` is the in-chat 32px.
 */
export const COMPOSER_BUTTON_SIZE = {
  compact: 'h-8 w-8',
  landing: 'h-9 w-9',
} as const;

/** The corner dot, and the anchor it positions against. */
export const COMPOSER_BUTTON_BADGE_ANCHOR = 'relative';
export const COMPOSER_BUTTON_BADGE =
  'absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border border-default-primary bg-default-error';

/**
 * The resting treatment, PER BUTTON — which is the part that is easy to get wrong.
 *
 * Three of the four rest as an outlined white circle, exactly as `02 Tools` draws them. SEND DOES
 * NOT: it rests FILLED, because on the live surface send is the one control that is always the
 * next thing you want, and drawing it like its neighbours makes the composer's primary action
 * indistinguishable from its secondary ones. That is a divergence from the published set and it is
 * recorded as one; it is not an oversight, and collapsing these four back onto one shared idle
 * would silently undo it.
 */
export const COMPOSER_BUTTON_IDLE = {
  tools:
    'border-default-primary bg-default-primary text-default-primary hover:bg-hover-neutral',
  attachment:
    'border-default-primary bg-default-primary text-default-primary hover:bg-hover-neutral',
  voice:
    'border-default-primary bg-default-primary text-default-primary hover:bg-hover-neutral',
  send: 'border-transparent bg-default-brand text-default-invert hover:bg-hover-brand',
} as const;

/**
 * THE ACTIVE FILL IS NOT ONE DECISION, which is why this is a record rather than a constant.
 *
 * The microphone goes RED because it is recording; the other three go BLUE because they are armed,
 * open or in flight. Collapsing these into a shared `ACTIVE` compiles, renders, and turns a
 * recording indicator into an arming one — so the guard asserts the mic DISAGREES with the rest,
 * and that assertion is the reason this shape exists.
 *
 * The border goes transparent rather than being dropped so the button does not change size between
 * states; a 1px reflow inside a toolbar row is visible.
 */
export const COMPOSER_BUTTON_ACTIVE = {
  voice: 'border-transparent bg-default-error text-default-invert hover:bg-hover-error',
  tools: 'border-transparent bg-default-brand text-default-invert hover:bg-hover-brand',
  attachment: 'border-transparent bg-default-brand text-default-invert hover:bg-hover-brand',
  send: 'border-transparent bg-default-brand text-default-invert hover:bg-hover-brand',
} as const;

/**
 * The DISABLED treatment, and it is its own table for the reason the send button makes obvious.
 *
 * An opacity fade is the usual way to say "disabled" and it is wrong for a filled control: a
 * faded blue circle still reads as blue, so a send button that cannot be pressed still looks like
 * the primary action. Disabled send goes to a flat neutral fill instead — the state the surface
 * spends most of its time in, since the composer starts empty.
 *
 * The three outlined buttons keep the fade, because a faded outline reads as unavailable already.
 */
export const COMPOSER_BUTTON_DISABLED = {
  tools: 'disabled:opacity-50',
  attachment: 'disabled:opacity-50',
  voice: 'disabled:opacity-50',
  send: 'disabled:border-transparent disabled:bg-default-secondary disabled:text-default-secondary disabled:hover:bg-default-secondary',
} as const;

/**
 * The glyph box. Figma draws most glyphs at 20 and the active minus at 24 — a real difference in
 * the published set, so it is a per-state size rather than one number.
 */
export const COMPOSER_GLYPH = {
  default: 'h-5 w-5',
  wide: 'h-6 w-6',
  /* The stop square. Smaller on purpose: a 20px filled square inside a 32px circle is a block. */
  tight: 'h-3.5 w-3.5',
  /* The upload spinner, which has to actually spin — a still `loader` glyph reads as a broken icon. */
  spinner: 'h-4 w-4 animate-spin',
} as const;

/** The same four glyphs on the 36px `landing` button, scaled by 36/32 to the nearest rung. */
export const COMPOSER_GLYPH_LANDING = {
  default: 'h-6 w-6',
  wide: 'h-7 w-7',
  tight: 'h-4 w-4',
  spinner: 'h-5 w-5 animate-spin',
} as const;

/**
 * SEND'S THIRD AND FOURTH STATES, and the reason this is an axis rather than a boolean.
 *
 * A composer that cannot become a STOP button cannot serve a streaming surface, which is every
 * surface this component has. While a reply streams, send is not a disabled send — it is a
 * different control with a different action, a different glyph and a different colour, and the
 * click does the opposite thing. The shell shipped without it: `active` was documented as "the
 * in-flight look" while drawing the ordinary blue send glyph, so the one state a user most needs
 * to see was the one state that looked like every other.
 *
 * `waiting` is the quieter sibling: uploads still in flight, so the turn cannot start yet. It stays
 * blue because nothing has gone wrong and nothing is interruptible — only the glyph says "not yet".
 *
 * STOP IS THE ERROR SURFACE, not a new red. It is the same fill the recording microphone takes,
 * for the same reason: this is the control that interrupts something already running.
 */
export const COMPOSER_SEND_STATE = {
  send: '',
  stop: 'border-transparent bg-default-error text-default-invert hover:bg-hover-error',
  waiting: '',
} as const;

/**
 * ── THE VOICE BAR AND ITS WAVEFORM ──
 *
 * The bar that REPLACES the composer's icon row while the microphone is open — it does not sit
 * above the editor, and that placement is the reason `size` exists at all: the two rows it can
 * replace are 32px and 36px tall, so a bar of one height makes the composer JUMP the moment
 * recording starts. Both values are the height of something else, which is why neither is a rung
 * on a general scale.
 *
 * NO PUBLISHED SOURCE for the bar itself. `01 Chat Bar` draws the microphone and the composer row
 * and stops; the listening treatment is the app's own. So the colours here are this package's
 * semantic tokens rather than the surface's literals, and the contract entry records the four
 * hexes that changes. The surface's `#F2F8FE` / `rgba(0,116,231,0.2)` / `#E5202E` are not
 * sayable in this package anyway: the family purge guard's ban on a literal colour and on a raw
 * palette step is what keeps the app's untokenised chrome from being copied in, and a component
 * that had to name a hex would be the signal to publish a token rather than to widen the ban.
 */
export const COMPOSER_VOICE_BAR =
  'flex w-full items-center gap-3 rounded-xl border border-default-brand/20 bg-weak-brand px-3 shadow-sm';

/** The two heights, each matching the icon row this bar stands in for. */
export const COMPOSER_VOICE_BAR_SIZE = {
  compact: 'h-8',
  landing: 'h-9',
} as const;

/** The microphone puck. Sized per bar height, like everything else on this row. */
export const COMPOSER_VOICE_PUCK =
  'relative flex items-center justify-center rounded-full bg-default-brand text-default-invert shadow-md';

export const COMPOSER_VOICE_PUCK_SIZE = {
  compact: 'h-6 w-6',
  landing: 'h-8 w-8',
} as const;

/**
 * THE HALO, and `motion-reduce:hidden` rather than a stopped animation — the same call `Skeleton`
 * makes, for the same reason: `animate-ping` frozen mid-sweep leaves a ring sitting at whatever
 * scale and opacity it happened to reach, which reads as a rendering fault rather than stillness.
 */
export const COMPOSER_VOICE_HALO =
  'absolute inset-0 rounded-full bg-default-brand/20 animate-ping motion-reduce:hidden';

/** The label and the waveform share the middle, which takes the slack. */
export const COMPOSER_VOICE_MIDDLE = 'flex min-w-0 flex-1 items-center gap-3';

export const COMPOSER_VOICE_LABEL = {
  compact: 'text-ds-legacy-xs font-medium text-default-brand',
  landing: 'text-ds-paragraph-mobile font-medium text-default-brand',
} as const;

/** The glyph inside the puck, and the smaller one inside the stop button. */
export const COMPOSER_VOICE_GLYPH = {
  compact: 'h-3 w-3',
  landing: 'h-4 w-4',
} as const;

export const COMPOSER_VOICE_STOP_GLYPH = {
  compact: 'h-2.5 w-2.5',
  landing: 'h-3.5 w-3.5',
} as const;

/**
 * THE STOP BUTTON IS THE ERROR SURFACE, the same call `COMPOSER_SEND_STATE.stop` makes: this is
 * the control that interrupts something already running. It draws a PAUSE glyph rather than a
 * stop square, because the recording halts rather than being discarded — a distinction the
 * accessible name has to carry too, which is why the label stays the caller's.
 */
export const COMPOSER_VOICE_STOP = `flex shrink-0 items-center justify-center rounded-full bg-default-error text-default-invert transition-colors hover:bg-hover-error ${FOCUS_RING.control}`;

export const COMPOSER_VOICE_STOP_SIZE = {
  compact: 'h-5 w-5',
  landing: 'h-7 w-7',
} as const;

/**
 * THE WAVEFORM. Five bars of fixed height, scaled by one keyframe on five delays.
 *
 * IT READS NO AMPLITUDE, and that is a decision rather than a stub: the surface has no metering
 * to give it, and a waveform wired to real levels on one platform and faked on the other would be
 * a difference nobody asked for. Both shipped surfaces already draw the fixed loop.
 *
 * `h-full` on a bar inside a fixed-height rail is what makes `scaleY` mean anything — the
 * transform scales the drawn box, so a bar with no height of its own scales nothing and the
 * waveform renders as an invisible row of zero-height pills.
 */
export const COMPOSER_WAVE = 'flex h-4 items-center gap-0.5';

export const COMPOSER_WAVE_BAR = 'h-full w-1 rounded-full bg-default-brand';

/**
 * Whether the bars are moving. `idle` is a real state rather than a disabled one: the bar can be
 * mounted before the microphone opens, and bars frozen at full height read as a level meter
 * pinned at maximum — so the resting drawing is the same 0.3 the keyframe starts from, and
 * `motion-reduce` resolves to exactly that rather than to nothing.
 */
export const COMPOSER_WAVE_STATE = {
  idle: 'scale-y-[0.3]',
  listening: 'animate-ds-soundwave motion-reduce:animate-none motion-reduce:scale-y-[0.3]',
} as const;
