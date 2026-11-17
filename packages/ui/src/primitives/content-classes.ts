import { BRAND_GRADIENT, FOCUS_RING } from '../utils';

/**
 * The class tables the eight content components share, in one place.
 *
 * Same siting rule as `overlay-classes.ts`, `feedback-classes.ts` and `field-classes.ts`:
 * not in `utils/`, which is for general mappings, and not in `contract/`, which may not name
 * a Tailwind class at all.
 *
 * ONE file for eight components rather than eight files, because the two guards read this as
 * DATA. The behaviour guard pulls its expected class strings from the tables rather than
 * retyping them, and the purge guard spreads every table into its required list — so a size
 * step that gains a class gains both of its checks with it. Eight files would mean eight
 * import lists to remember to extend, and the one nobody extends is the one that regresses.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so
 * a class named in a comment is emitted whether or not any component still uses it — which
 * props the purge guard up on its own documentation. `overlay-classes.ts` records hitting
 * exactly that, and its injection proof is what found it.
 *
 * The Badge and Chip colour work is NOT shared, and that is deliberate: a badge sets a
 * background and a text colour, while a chip is a border, a background and a text colour
 * together, and its two states differ on all three. One table serving both would have to
 * carry an empty border for every badge value, which is the shape a later refactor
 * "simplifies" by dropping the border entirely.
 */

/**
 * The legacy `z-*` brand-token rule, as ONE callable predicate rather than a regex each guard
 * retypes.
 *
 * `bg-z-primary`, `bg-z-lightGray`, `text-z-text-gray` and `text-z-text-primary` are the
 * pre-re-baseline group all four rewritten components carried. It is scheduled to retire, so a
 * survivor renders correctly today and renders nothing on the day the group goes — which is
 * why both guards check for it.
 *
 * Both of them checked for it with their OWN hand-typed regex, and the two had already drifted
 * apart on the boundary character. That is the failure shape
 * `docs/solutions/conventions/shared-rules-must-be-called-not-restated.md` records: the next
 * person widens the family in one copy and the other silently stops covering it. One export,
 * two callers.
 *
 * It takes a whole class string OR a single class, so the same predicate serves the purge
 * guard (which reads table values) and the behaviour guard (which reads `classList` entries).
 */
export const hasLegacyBrandToken = (value: string): boolean =>
  /(?:^|[\s:])(?:bg|text|border|ring|fill|stroke|from|via|to)-z-/.test(value);

/**
 * The wrapper around an icon slot, shared by every component that has one.
 *
 * `shrink-0` is the load-bearing part: without it the icon compresses before the label wraps,
 * which on a narrow pill produces a squashed glyph rather than a truncated word. Shared
 * because three components landed with a byte-identical copy of it in the same change, and a
 * fourth would have copied it again.
 */
export const ICON_SLOT = 'inline-flex shrink-0 items-center';

/**
 * A badge: a non-interactive pill. No focus ring and no hover — it is a `<span>`, and the
 * five call sites that wanted a handler are Chips.
 */
export const BADGE_BASE = 'inline-flex w-fit items-center gap-ds-4xs rounded-ds-full font-medium whitespace-nowrap';

/**
 * THE GRADIENT VALUE, on the colour axis rather than beside it.
 *
 * A gradient is a value the colour axis can take, not a second dimension: a `gradient` boolean
 * alongside `color` makes "gradient AND danger" representable, which is not a thing.
 *
 * BOTH STOPS ARE PUBLISHED TOKENS AND BOTH ARE STATIC CLASSES. The one sanctioned escape from
 * the class-only rule is a computed POSITION, which travels as a number in a custom property —
 * the slider's track is the precedent and the rule. A stop is never inline.
 *
 * WHAT THIS VALUE DELIBERATELY DOES NOT COVER: the two live topic badges read
 * `gradientFrom`/`gradientTo` as typed fields off authored data carrying ELEVEN distinct raw
 * palette pairs. A closed axis cannot express an arbitrary authored pair, and adding a
 * passthrough for one would re-admit exactly what this component's rewrite removed — arbitrary
 * colour arriving at the call site. Those two sites stay hand-rolled; collapsing eleven pairs
 * onto a design decision is a data question, not a component one, and it belongs to whoever
 * owns that data.
 */

/**
 * The six published colours (Ensyra — DS, component set 146:2464), each resolved to a token.
 *
 * `bestseller` IS THE ODD ONE, AND IT IS NOT AN INCONSISTENCY. The other five are 10% tints
 * of their function, so their text takes the matching semantic colour. `bestseller` is the
 * SOLID success surface, which is why its text inverts instead — it is the saturated green
 * pill on a course card, and a refactor that flattens the six onto one tint-shaped rule
 * turns it into a pale mint badge with unreadable text.
 */
export const BADGE_COLOR = {
  primary: 'bg-weak-brand text-default-brand',
  warning: 'bg-weak-warning text-default-warning',
  success: 'bg-weak-success text-default-success',
  danger: 'bg-weak-error text-default-error',
  light: 'bg-weak-neutral text-default-primary',
  bestseller: 'bg-default-success text-default-invert',
  /* Both stops are token classes; the docblock above says what this value does not cover. */
  gradient: `${BRAND_GRADIENT} text-default-invert`,
} as const;

/**
 * The four published steps. There is no `large` between the top step and `medium` — that is
 * Figma's ladder, and inventing one to even out the ramp is the fabrication the contract
 * exists to prevent.
 */
export const BADGE_SIZE = {
  xlarge: 'px-ds-sm py-ds-2xs text-ds-paragraph-mobile',
  medium: 'px-ds-xs py-ds-3xs text-ds-body-lg-mobile',
  small: 'px-ds-2xs py-ds-5xs text-ds-body-md-mobile',
  micro: 'px-ds-3xs py-ds-5xs text-ds-body-sm-mobile',
  /* UMK-1548 (TL decision): two rungs of ours, no Figma set. 14px bold; the weight rides the size because
     the base is medium and these two are the only badges that go bold. 6 / 10 and 4 / 12 padding. */
  compact: 'px-ds-xs py-ds-3xs text-ds-paragraph-mobile font-bold',
  compactTight: 'px-ds-sm py-ds-4xs text-ds-paragraph-mobile font-bold',
} as const;

/**
 * A chip: interactive, so a `<button>` with the shared ring rather than a hand-rolled one.
 *
 * `disabled:` carries BOTH halves — the dimmed look and the dead pointer. A chip that only
 * dims still fires its handler, which is the failure a look-only disabled state always is.
 */
export const CHIP_BASE = `inline-flex w-fit items-center gap-ds-4xs rounded-ds-full border font-bold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-60 ${FOCUS_RING.control}`;

/**
 * Idle and selected, covering what the app's chip family renders today.
 *
 * The two must stay visibly different at every size — a `state` axis whose values resolve to
 * the same treatment is a selection control that cannot show a selection, and it renders
 * perfectly.
 */
export const CHIP_STATE = {
  default:
    'border-default-primary bg-default-primary text-default-primary hover:border-default-brand hover:text-default-brand',
  active: 'border-default-brand bg-weak-brand text-default-brand',
} as const;

/* The compact chip's metrics (TL-C13, user ruling: existing tokens only). One edit each to change. */
const CHIP_COMPACT_TEXT = 'text-ds-paragraph-mobile'; // 14px
const CHIP_COMPACT_PAD_Y = 'py-ds-3xs'; // 6px
const CHIP_COMPACT_PAD_X = 'px-ds-md'; // 16px

/** The six published steps (component set 146:3347). `huge` sits above the top badge step. */
export const CHIP_SIZE = {
  huge: 'px-ds-xl py-ds-sm text-ds-paragraph-desktop',
  xlarge: 'px-ds-md py-ds-xs text-ds-paragraph-mobile',
  large: 'px-ds-sm py-ds-2xs text-ds-body-lg-desktop',
  medium: 'px-ds-xs py-ds-2xs text-ds-body-lg-mobile',
  small: 'px-ds-2xs py-ds-3xs text-ds-body-md-mobile',
  micro: 'px-ds-3xs py-ds-5xs text-ds-body-sm-mobile',
  /* UMK-1548 U10 (TL-C13): the mockup's reply-situation chip. NOT a Figma rung. 14px text, 6px / 16px
     padding, all existing tokens (user ruling); a token swap is the three constants below. */
  compact: `${CHIP_COMPACT_PAD_X} ${CHIP_COMPACT_PAD_Y} ${CHIP_COMPACT_TEXT}`,
} as const;

/**
 * `compact`, idle only: the border is the `n40` ink (`border.default.invert`, #c3cbd3) where every other size
 * keeps the near-white hairline. Applied AFTER `CHIP_STATE`; the selected state keeps its brand border.
 */
export const CHIP_COMPACT_IDLE_BORDER = 'border-default-invert';

/**
 * `compact` is the only size whose weight follows the state: regular idle, semibold selected. Every other size
 * keeps `CHIP_BASE`'s `font-bold`. Applied AFTER `CHIP_SIZE` so it wins over the base weight in `cn`.
 */
export const CHIP_COMPACT_WEIGHT = {
  default: 'font-normal',
  active: 'font-semibold',
} as const;

/** A card: a container. Radius and transition are shared; the surface is the axis below. */
export const CARD_BASE = 'rounded-ds-2xl transition-shadow';

/**
 * The card's radius rungs (UMK-960), each an existing radius token. One is SELECTED out of `CARD_BASE`,
 * never appended to it (tailwind-merge keeps both rungs of an unknown scale). `lg` IS the default's 2xl, so
 * leaving `rounded` off and passing `lg` render the same card.
 */
export const CARD_ROUNDED = {
  none: 'rounded-ds-null',
  sm: 'rounded-ds-lg',
  md: 'rounded-ds-xl',
  lg: 'rounded-ds-2xl',
  full: 'rounded-ds-full',
} as const;

/**
 * HOW THE CARD IS SEPARATED FROM THE PAGE, and it is genuinely three different answers.
 *
 * The first cut of this rewrite dropped the legacy `variant` axis because "no consumer passes
 * it" — which was true and the wrong conclusion, the same one that shipped a pill tab bar. No
 * consumer passed anything, because the component was unused. Surveying what the app really
 * renders found all three of these live:
 *
 * - `elevated` — a shadow on a plain surface. The course and marketing cards, and the default,
 *   so the two existing call sites keep exactly what they render today.
 * - `outlined` — a border and no shadow. The DOMINANT treatment across the TemanAI surfaces:
 *   template rows, attachment rows, notice cards. Several add a hover shadow of their own,
 *   which stays a call-site concern rather than a fourth value.
 * - `plain` — no chrome at all, for a card whose surface supplies its own. The a2ui card is
 *   this: a bare passthrough whose chrome comes from the surface wrapping it.
 *
 * No Figma set backs this: the published `Card` is a course card rather than a container (see
 * the contract entry). The axis is read off the code, the way `Dialog`'s was.
 */
export const CARD_VARIANT = {
  elevated: 'bg-default-primary shadow-lg',
  outlined: 'border border-default-primary bg-default-primary',
  /* Deliberately empty — "no chrome" is the absence of classes, not a class. Enumerated in the
     guard's `DELIBERATELY_EMPTY` beside `padding.none` for the same reason. */
  plain: '',
} as const;

/**
 * The padding ladder, spelled out. The legacy component abbreviated these to `sm | md | lg`,
 * which is the abbreviation slice 3 already reverted once as a defect.
 */
export const CARD_PADDING = {
  none: '',
  small: 'p-ds-md',
  medium: 'p-ds-lg sm:p-ds-2xl',
  large: 'p-ds-2xl sm:p-ds-3xl-mobile',
} as const;

/** A divider's wrapper, minus everything that depends on which way it runs. */
export const DIVIDER_BASE = 'relative';

/**
 * WHICH WAY THE RULE RUNS. A vertical divider is not a rotated horizontal one — it separates
 * items inside a row, takes its height from the row (`self-stretch`) rather than spanning a
 * width, and carries horizontal margin instead of vertical.
 *
 * The a2ui renderer has had this since it was written, and `axis` is pinned there by the
 * upstream A2UI Basic spec — so a library divider that can only be horizontal cannot serve that
 * migration at all.
 */
export const DIVIDER_ORIENTATION = {
  horizontal: 'my-ds-md w-full sm:my-ds-xl',
  vertical: 'mx-ds-4xs self-stretch',
} as const;

/** The rule element, per orientation: which edge carries the border, and how it is sized. */
export const DIVIDER_RULE = {
  horizontal: 'w-full border-t border-default-primary',
  vertical: 'h-full border-l border-default-primary',
} as const;

/**
 * The line TREATMENT, now independent of the direction so the two axes compose. Splitting them
 * is what keeps each table a flat set the guards can read — a nested
 * `[orientation][variant]` table would have to be unpacked by hand in both of them.
 */
export const DIVIDER_VARIANT = {
  default: 'border-solid',
  dashed: 'border-dashed',
} as const;

/**
 * The centred label. Its background is what punches the rule — so it takes the SAME surface
 * token as whatever it sits on, and a divider on a tinted surface needs the caller's own
 * class rather than this one.
 */
export const DIVIDER_LABEL = 'bg-default-primary px-ds-md text-default-secondary';

/**
 * A TAB IS UNDERLINED, NOT A PILL — read off the published set (185:1050) rather than inherited
 * from the component this replaced.
 *
 * The legacy `Tabs.tsx` rendered a pill rail: a rounded grey track with a solid blue pill on the
 * active tab. It had zero consumers, and "zero consumers" was mistaken for "the treatment is
 * ours to keep" — so the first cut of this rewrite modernised the legacy LOOK onto tokens while
 * taking its axis names from Figma. Both tab bars the app actually renders (the settings modal,
 * and the a2ui renderer) are underlined, and so is Figma. The rule is per TAB rather than on the
 * list, which is why the list itself carries no border.
 */
export const TAB_LIST = 'flex items-stretch';

/**
 * A trigger, minus its state and its size. Takes the shared ring, like every control here. `min-w-0`: a flex item
 * will not shrink below its text, so without it a long label pushed a narrow container into a sideways scroll
 * (UMK-960); with it the trigger shrinks and the label wraps.
 */
export const TAB_TRIGGER = `flex min-w-0 flex-1 items-center justify-center gap-ds-sm border-solid transition-colors ${FOCUS_RING.control}`;

/**
 * Active and idle. Derived from the tab set's active value, never passed as a prop — two
 * simultaneously-active tabs is a state the design has no answer for.
 *
 * The BORDER WIDTH is part of the state, not just its colour: the active tab's rule is 2px and
 * the idle one's is 1px, so a state table carrying only colour renders a uniform rule and loses
 * the emphasis the design uses to say which tab you are on.
 */
export const TAB_STATE = {
  default: 'border-b border-default-primary font-normal text-default-secondary hover:text-default-primary',
  active: 'border-b-2 border-default-brand font-semibold text-default-brand',
} as const;

/** The two published steps (185:1041 / 421:641): 44px and 36px tall. */
export const TAB_SIZE = {
  large: 'px-ds-xl py-ds-2xs text-ds-h6-desktop',
  small: 'px-ds-md py-ds-3xs text-ds-h6-mobile',
  /** UMK-960, ours: a dense bar of four or more tabs in a dialog. 14px type, no side padding, so the labels share the width. */
  xsmall: 'px-0 py-ds-xs text-ds-paragraph-mobile',
} as const;

/**
 * Figma's `Show Notif` is a COUNT BADGE, not a dot — a pale error-tinted pill carrying a number.
 * An earlier cut of this file rendered a 4px dot, which is a different affordance: a dot says
 * "something is here", a count says how much, and the design says the latter.
 */
export const TAB_NOTIF = 'inline-flex shrink-0 items-center justify-center rounded-ds-full bg-weak-error';

/** The badge's padding and type step follow the TAB's size. */
export const TAB_NOTIF_SIZE = {
  large: 'px-ds-xs py-ds-4xs text-ds-body-md-mobile',
  small: 'px-ds-2xs py-ds-4xs text-ds-body-sm-mobile',
  xsmall: 'px-ds-2xs py-ds-4xs text-ds-body-sm-mobile',
} as const;

/** And its text colour follows the tab's STATE, brand on the active tab. */
export const TAB_NOTIF_STATE = {
  default: 'text-default-primary',
  active: 'text-default-brand',
} as const;

/**
 * A list, per direction. `bullet` draws its own marker rather than using a list marker: the
 * a2ui renderer this covers authors bold-prefixed prose inside each item, and a native marker
 * sits at the wrong baseline against it.
 */
export const LIST_DIRECTION = {
  vertical: 'flex flex-col gap-ds-4xs',
  horizontal: 'flex flex-wrap gap-ds-2xs',
  bullet: 'flex flex-col gap-ds-4xs',
} as const;

/**
 * A list with NATIVE markers (`disc`, `decimal`). It is NOT a flex column: a flex item is
 * blockified, which turns an `li` from `list-item` into `block` and drops the marker. The
 * spacing between rows is `space-y-*`, not `gap`, for the same reason.
 */
export const LIST_MARKER = {
  disc: 'list-disc pl-ds-lg',
  decimal: 'list-decimal pl-ds-md',
} as const;

/**
 * The row spacing a caller may pick, from the spacing scale (UMK-960). SELECTED out of the
 * direction's own gap, never appended: tailwind-merge does not know the `ds-` spacing scale, so
 * two gap rungs would both ship. This is the flex/gap form; `LIST_SPACE` is the `space-y` form that a
 * native-marker list needs.
 */
export const LIST_GAP = {
  '4xs': 'gap-ds-4xs',
  '3xs': 'gap-ds-3xs',
  '2xs': 'gap-ds-2xs',
  xs: 'gap-ds-xs',
  sm: 'gap-ds-sm',
  md: 'gap-ds-md',
  lg: 'gap-ds-lg',
  xl: 'gap-ds-xl',
  '2xl': 'gap-ds-2xl',
  '3xl-mobile': 'gap-ds-3xl-mobile',
} as const;

/** The `space-y` form of the same rungs, for a list that keeps native markers. */
export const LIST_SPACE = {
  '4xs': 'space-y-ds-4xs',
  '3xs': 'space-y-ds-3xs',
  '2xs': 'space-y-ds-2xs',
  xs: 'space-y-ds-xs',
  sm: 'space-y-ds-sm',
  md: 'space-y-ds-md',
  lg: 'space-y-ds-lg',
  xl: 'space-y-ds-xl',
  '2xl': 'space-y-ds-2xl',
  '3xl-mobile': 'space-y-ds-3xl-mobile',
} as const;

/**
 * The same rungs behind a breakpoint, for a flex list whose gap changes with the viewport (a
 * marquee track). Literal strings, not built at runtime, so Tailwind's scan finds every one.
 */
export const LIST_GAP_MD = {
  '4xs': 'md:gap-ds-4xs',
  '3xs': 'md:gap-ds-3xs',
  '2xs': 'md:gap-ds-2xs',
  xs: 'md:gap-ds-xs',
  sm: 'md:gap-ds-sm',
  md: 'md:gap-ds-md',
  lg: 'md:gap-ds-lg',
  xl: 'md:gap-ds-xl',
  '2xl': 'md:gap-ds-2xl',
  '3xl-mobile': 'md:gap-ds-3xl-mobile',
} as const;
export const LIST_GAP_LG = {
  '4xs': 'lg:gap-ds-4xs',
  '3xs': 'lg:gap-ds-3xs',
  '2xs': 'lg:gap-ds-2xs',
  xs: 'lg:gap-ds-xs',
  sm: 'lg:gap-ds-sm',
  md: 'lg:gap-ds-md',
  lg: 'lg:gap-ds-lg',
  xl: 'lg:gap-ds-xl',
  '2xl': 'lg:gap-ds-2xl',
  '3xl-mobile': 'lg:gap-ds-3xl-mobile',
} as const;

/** One bullet row, and the dot itself. The top margin optically centres it on the first line. */
export const LIST_BULLET_ITEM = 'flex items-start gap-ds-2xs';
export const LIST_BULLET = 'mt-ds-4xs h-ds-5xs w-ds-5xs shrink-0 rounded-ds-full bg-default-brand';

/** A disclosure. Native `<details>`, so the keyboard behaviour arrives for free. */
export const DISCLOSURE_BASE = 'rounded-ds-md border border-default-primary bg-default-primary';
export const DISCLOSURE_SUMMARY = `cursor-pointer rounded-ds-md px-ds-sm py-ds-2xs font-bold text-default-primary marker:text-default-secondary ${FOCUS_RING.control}`;
export const DISCLOSURE_PANEL = 'px-ds-sm pb-ds-sm pt-ds-3xs';

/** An image's box. Its aspect and its width come from the type and size steps below. */
export const IMAGE_BASE =
  'relative flex items-center justify-center overflow-hidden bg-default-primary';

/**
 * Intrinsic mode (UMK-960): the box carries no ratio, background, clipping or size step, only a
 * positioned context, so a caller's `className` (an absolute decor ring, `h-8`, a marquee tile
 * height) is the whole layout. The image fills the box's height and keeps its own ratio.
 */
export const IMAGE_BARE = 'relative flex w-fit max-w-full';
export const IMAGE_BARE_IMG = 'block h-full w-auto max-w-full';

/** The radius rungs, from the radius scale. One is SELECTED, never appended to `IMAGE_TYPE`'s. */
export const IMAGE_ROUNDED = {
  null: 'rounded-ds-null',
  xs: 'rounded-ds-xs',
  sm: 'rounded-ds-sm',
  md: 'rounded-ds-md',
  lg: 'rounded-ds-lg',
  xl: 'rounded-ds-xl',
  '2xl': 'rounded-ds-2xl',
  '3xl': 'rounded-ds-3xl',
  full: 'rounded-ds-full',
} as const;

/**
 * Thumbnail is square, a banner is wide — and `natural` constrains no ratio at all.
 *
 * The first two are published. `natural` is not, and it is here because a survey of the TemanAI
 * surfaces found it is what almost every image actually is: a generated result, the lightbox,
 * the photo-edit preview and the camera preview all render at the image's own ratio, and
 * exactly one instance in the whole chat surface is a square thumbnail. Forcing a generated
 * 3:4 portrait into a square box crops it, which is a visible defect rather than a style
 * difference. Recorded as a divergence on the contract entry rather than slipped in.
 */
export const IMAGE_TYPE = {
  thumbnail: 'aspect-square rounded-ds-md',
  banner: 'aspect-[16/9] rounded-ds-lg',
  natural: 'h-auto rounded-ds-md',
  /* A circle (UMK-1186). Square ratio and a full round; the caller sizes it by className,
     because the `size` steps are content widths rather than avatar sizes. */
  avatar: 'aspect-square rounded-full',
} as const;

/**
 * The three published steps (component set 494:461). Widths come from the SPACING scale
 * rather than the max-width one: Tailwind's `maxWidth` theme does not inherit spacing, so a
 * `max-w-ds-*` here would be an arbitrary-looking class the preset never emits — and the
 * purge guard is the only thing that would have caught it.
 */
export const IMAGE_SIZE = {
  regular: 'w-full',
  small: 'w-ds-4xl',
  blog: 'w-ds-5xl-desktop',
} as const;

/** The hover treatment Figma publishes as a two-value variant and this package takes as a flag. */
export const IMAGE_HOVER = 'transition-opacity hover:opacity-90';

/**
 * The placeholder. Also the SECURITY branch: a non-https source renders this instead of an
 * image, so nothing is ever requested — the same defence the a2ui renderer already carries.
 * Dashed so an empty slot reads as empty rather than as a broken photo.
 */
export const IMAGE_PLACEHOLDER =
  'border border-dashed border-default-primary text-ds-body-lg-mobile text-default-secondary';

/**
 * A FENCED BLOCK WITH A COPY AFFORDANCE.
 *
 * Two live sites carry a byte-identical copy of this — `AssistantMarkdown`'s code renderer and
 * the same block inside `ChatMessage` — down to the class strings and the Indonesian labels.
 * (The ticket counted six; the other four are ordinary clipboard buttons on a message, which
 * is a different affordance and not this component's job.)
 *
 * The dark ground is the point rather than a theme: a fenced block reads as a quotation of
 * machine output, and the two live copies both draw it that way. It is on the invert surfaces
 * instead of the `gray-800`/`gray-900` pair they hardcode.
 */
export const CODE_BLOCK_BASE = 'overflow-hidden rounded-ds-md';

/** The bar's slot for caller controls: pushed to the trailing edge, ahead of the copy control. */
export const CODE_BLOCK_ACTIONS = 'ml-auto flex items-center gap-2';

export const CODE_BLOCK_BAR =
  'flex items-center justify-between bg-default-invert text-default-invert';

/**
 * `whitespace-pre-wrap` KEEPS THE NEWLINES AND STILL WRAPS. `pre` alone puts a long line off
 * the side of a chat bubble; `normal` collapses the indentation that is half of what a fenced
 * block is for.
 */
export const CODE_BLOCK_BODY =
  'block overflow-x-auto whitespace-pre-wrap bg-hover-invert font-mono text-default-invert';

export const CODE_BLOCK_SIZE = {
  large: 'px-ds-sm py-ds-2xs text-ds-paragraph-mobile',
  small: 'px-ds-2xs py-ds-3xs text-ds-body-lg-mobile',
} as const;

export const CODE_BLOCK_ACTION = `inline-flex items-center gap-ds-4xs rounded-ds-xs px-ds-3xs text-ds-body-md-mobile hover:bg-hover-invert ${FOCUS_RING.control}`;

/** The failure ink. A copy that quietly does nothing is the whole failure mode here. */
export const CODE_BLOCK_FAILED = 'text-default-error';

/**
 * A STEP TRAIL, on ONE vocabulary reconciled from three that disagree.
 *
 * Ensyra publishes the same idea three times with three different property names, and one word
 * means two different things across them: a step position in one set and a step state in
 * another. All three spellings are recorded as divergences on the contract entry rather than
 * one being silently preferred, so design can reject this reconciliation cheaply.
 *
 * The mark and the connector are separate tables because they are separate elements with
 * separate rules: the mark carries the state's fill and ink, the connector carries only
 * whether the leg BEHIND this step is complete. A single table serving both would have to
 * carry a connector colour for the first step, which has no connector at all.
 */
export const STEPPER_BASE = 'flex';

export const STEPPER_ORIENTATION = {
  horizontal: 'flex-row items-start',
  vertical: 'flex-col items-stretch',
} as const;

/**
 * `relative`, because the leg is POSITIONED rather than laid out.
 *
 * An in-flow connector was the first shape and it was wrong in a way no unit test could see:
 * `flex-1` on a leg inside a column grows it vertically, and inside a row it pushes the label
 * across the viewport. Both rendered valid markup with every class present, and both looked
 * like a scattered pile in a browser. The leg is drawn from the step's own mark back to the
 * previous one instead, which is also what lets it cross the gap between two steps rather
 * than covering half of it from each side.
 */
export const STEPPER_STEP = {
  horizontal: 'relative flex flex-1 flex-col items-center gap-ds-3xs',
  vertical: 'relative flex flex-row items-start gap-ds-2xs pb-ds-sm',
} as const;

/**
 * The whole-item button (UMK-1809): the mark and the label inside ONE native button, so a tap on
 * either selects the step. It reproduces the `li`'s own layout per orientation, so a step that has
 * `onSelect` lands exactly where one without it does.
 *
 * NO `relative`, `z-*`, `transform`, opacity transition or `isolation`, ever: each makes the button a
 * stacking context or the box the connector measures from, and the mark's `relative z-10` would then
 * stop lifting it above the next step's leg. The affordance is a hover background and a visible focus
 * ring, neither of which shifts layout (no padding, no border width).
 */
export const STEPPER_SELECT = {
  horizontal: `flex cursor-pointer flex-col items-center gap-ds-3xs rounded-ds-md hover:bg-hover-neutral ${FOCUS_RING.control}`,
  vertical: `flex cursor-pointer flex-row items-start gap-ds-2xs rounded-ds-md text-left hover:bg-hover-neutral ${FOCUS_RING.control}`,
} as const;

/** The numbered mark. `shrink-0` keeps it circular when the label beside it wraps. */
/**
 * `relative z-10` is load-bearing, and BOTH halves are.
 *
 * `relative` alone only lifts the mark above the leg in its OWN step. A step's leg reaches back
 * to the PREVIOUS step's mark, and it lives in a later `<li>` — so with both merely positioned,
 * paint order is DOM order and the later leg draws straight across the earlier circle. It reads
 * as a struck-through step, and no assertion can see it: the classes, the DOM and the geometry
 * are all exactly what the tests ask for.
 */
export const STEPPER_MARK =
  'relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-ds-full border text-ds-body-lg-mobile font-bold';

/**
 * `01 Mark`, value for value.
 *
 * `default` has NO FILL and a 3px ring — Figma strokes it and leaves the disc empty, so a
 * `bg-` here would paint over the surface it is meant to sit on. The width lives in this
 * table rather than in `STEPPER_MARK` because only this one state has a stroke.
 *
 * `current` and `done` get NO STROKE in Figma; the `border-border-*` each carries is the same
 * colour as its own fill, a deliberate no-op kept because `AXIS_SHAPE` requires every state to
 * name a border. Do not "clean it up" into a visible ring, and do not repoint it away from its
 * fill.
 *
 * `done` is BRAND, not success. A finished step is not a success message — Figma paints it the
 * same blue as the current one, and the connector leg behind it matches (see
 * `STEPPER_CONNECTOR_STATE`).
 */
export const STEPPER_MARK_STATE = {
  default: 'border-3 border-border-secondary text-default-secondary',
  current: 'border-default-brand bg-default-brand text-default-invert',
  done: 'border-default-brand bg-default-brand text-default-invert',
} as const;

export const STEPPER_LABEL_STATE = {
  default: 'text-ds-body-lg-mobile text-default-secondary',
  current: 'text-ds-body-lg-mobile font-bold text-default-primary',
  done: 'text-ds-body-lg-mobile text-default-primary',
} as const;

/**
 * The leg BEHIND a step. `first` has none, which is the absence of an element rather than an
 * empty class — the component renders no connector at all rather than a zero-length one.
 */
/**
 * The leg BEHIND a step, drawn from this step's mark back to the previous one.
 *
 * TWO AXES, AND THEY ARE DIFFERENT PROBLEMS.
 *
 * CROSS axis (`top-[1.125rem]` / `left-[1.125rem]` plus `-translate-*-1/2`): the mark's own
 * half-height, 18px of 36. Tailwind's scale has no `4.5` step, so it is spelled as a value.
 * The translate is not decoration — `top`/`left` place the leg's EDGE, so without it the line
 * sits half its own thickness off the circle's centre, and it is a translate rather than
 * arithmetic so it stays right at any leg thickness.
 *
 * ALONG axis (`right-[calc(50%+1.125rem)]` / `bottom-full`, with a diameter subtracted from
 * the length): the leg stops at the ring, NOT at the centre. `right-1/2` was the original and
 * it is wrong by exactly the mark's radius — the step is centred, so the step's midpoint IS
 * the mark's centre, and a leg ending there runs under the left half of the disc. That was
 * invisible only while `default` carried an opaque `bg-default-primary`; Figma strokes that
 * state and leaves it EMPTY, so the line now shows through the ring and stops on the numeral.
 * `z-10` never hid it — the fill did, and there is nothing left to raise the mark above.
 *
 * MEASURING THE OFFSET CONFIRMS THIS BUG RATHER THAN CATCHING IT: a leg centred on the mark's
 * centre reads as 0px error on the cross axis while being 18px wrong on the along axis. The
 * guard pins the along-axis clearance separately for that reason.
 *
 * RESIZE THE MARK AND BOTH MOVE WITH IT, or the legs sit wrong with nothing red.
 *
 * `first` has no leg at all — the absence of an element, not a zero-length one, which is why
 * `position` is an axis whose evidence is structural.
 */
export const STEPPER_CONNECTOR = {
  horizontal:
    'absolute right-[calc(50%+1.125rem)] top-[1.125rem] -translate-y-1/2 h-ds-5xs w-[calc(100%-2.25rem)]',
  /**
   * `bottom-full`, NOT `bottom-1/2` and not `100% - half`. The mark sits at the TOP of a
   * vertical step (`items-start`) and the step carries bottom padding, so half the step's
   * height lands BELOW the mark's centre — a fraction pokes the leg out under the circle, and
   * `100% - half` stops it at the centre, i.e. INSIDE the ring. `bottom-full` is the step's
   * own top edge, which is exactly the mark's top edge: the leg starts where the ring ends.
   * The height then drops one whole diameter so the far end clears the previous mark too.
   */
  vertical:
    'absolute bottom-full left-[1.125rem] -translate-x-1/2 h-[calc(100%-2.25rem)] w-ds-5xs',
} as const;

/** Brand for `done`, matching the mark it runs into — a green leg into a blue circle was the
 *  visible half of the defect the mark table above records. */
export const STEPPER_CONNECTOR_STATE = {
  default: 'bg-default-secondary',
  current: 'bg-default-secondary',
  done: 'bg-default-brand',
} as const;
