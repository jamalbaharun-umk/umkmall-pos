import { FOCUS_RING } from '../utils';

/**
 * The class tables two controls share, in one place.
 *
 * Both pairings had already gone wrong in different ways: `TextField` and `DateTimeInput`
 * carried byte-identical box tables in two files, and `Radio` reached into `CheckBox.tsx`
 * for three strings — which made its module graph depend on the whole of a sibling
 * component to borrow a class name. Same fix as `utils/focus-ring-classes.ts`: the value
 * lives where more than one component can name it, so a token change is a one-file edit.
 *
 * Not in `utils/`, because these are form-control chrome rather than a general mapping, and
 * not in `contract/`, which may not name a Tailwind class at all.
 */

/** The text-shaped box: `TextField` and `DateTimeInput`. */
export const BOX_BASE =
  'flex w-full items-center border bg-default-primary text-default-primary transition-colors ring-0';

/**
 * FIGMA'S `Field Input` (127:1459), measured: Large h48 / r12 / padding 12·16 / 16·24 type; Small h40 /
 * r8 / padding 10·16 / 14·20 type. DateTimeInput and Select read this table too, so they move with it.
 */
export const BOX_SIZE = {
  large: 'gap-ds-2xs px-ds-md py-ds-sm text-ds-paragraph-desktop rounded-ds-lg',
  small: 'gap-ds-3xs px-ds-md py-ds-xs text-ds-paragraph-mobile rounded-ds-md',
} as const;

/** `TextField`'s third rung, kept OUT of `BOX_SIZE` because `DateTimeInput` and `Select` share that table and have no such size. */
export const BOX_SIZE_XSMALL = 'gap-ds-3xs px-ds-2xs py-ds-4xs text-ds-body-lg-mobile rounded-ds-md';

/** `TextField`'s `compact` rung (UMK-1548), ours, no Figma: 14px type, 10 / 12 padding, r12. Also kept out of `BOX_SIZE`. */
export const BOX_SIZE_COMPACT = 'gap-ds-3xs px-ds-sm py-ds-xs text-ds-paragraph-mobile rounded-ds-lg';

/**
 * The compact box's REST borders (UMK-1548): the `n40` ink (`border.default.invert`, #c3cbd3) in place of the
 * near-white hairline. Error, valid, focus and disabled are untouched. Applied after `BOX_STATE`.
 */
export const BOX_STATE_COMPACT = {
  default: 'border-default-invert',
  filled: 'border-default-invert',
} as const;

/**
 * The compact box's height. A single line is a 44 floor (the sizing token `2-75`, the same 44 as Tailwind's
 * `min-h-11`: 10 + 20 + 10 + the 1px borders is 42 on its own). A multiline box takes a 24 line instead
 * (the line-height token `md`, the same 24 as `leading-6`): 3 rows are 72 + 20 + 2 = 94.
 */
export const BOX_HEIGHT_COMPACT = { single: 'min-h-11', multiline: 'leading-6' } as const;

/** Mutually exclusive; the component picks exactly one. "filled" is derived from the value. */
export const BOX_STATE = {
  default: 'border-default-primary hover:border-default-brand',
  filled: 'border-default-primary hover:border-default-brand',
  error: 'border-default-error hover:border-default-error',
  /* Figma's "Disable Filled": the fill goes grey and the VALUE keeps its full ink; only the placeholder dims
     (`BOX_CONTROL`). */
  disabled: 'border-default-primary bg-default-secondary cursor-not-allowed',
} as const;

/** Figma has no Success state; `valid` (TextField only) is the nearest token. `error` wins over it. */
export const BOX_STATE_VALID = 'border-default-success hover:border-default-success';

/** The inner element that actually holds the text. `read-only:` only ever bites on `TextField`. */
export const BOX_CONTROL =
  'w-full min-w-0 bg-transparent font-medium outline-none placeholder:font-normal placeholder:text-default-secondary disabled:cursor-not-allowed disabled:placeholder:text-disable-primary read-only:cursor-default';

/**
 * `appearance="bare"`: no chrome at all. The box is a plain flex row that STRETCHES its control, so a
 * caller's `min-h-*` on the box is filled by the textarea; the type (size, weight, colour) is the
 * caller's `className` on the box, which the control inherits (preflight sets `font: inherit`).
 */
export const BARE_BOX = 'flex w-full items-stretch';
export const BARE_CONTROL = 'w-full min-w-0 bg-transparent outline-none placeholder:text-default-secondary';

/**
 * The tick/dot box: `CheckBox` and `Radio`. `appearance-none` makes the input ITSELF the
 * styled box, so the hit target, the focus ring and the painted square are one element
 * rather than three that can drift apart.
 */
/**
 * THE FILL IS DRIVEN BY `:indeterminate` AS WELL AS `:checked` (UMK-1091). A partly selected
 * box deliberately clears `checked` — it is neither checked nor unchecked — so a fill keyed
 * on `checked:` alone left the box WHITE under a white dash glyph, which is to say invisible.
 * `:indeterminate` is a real pseudo-state the component already writes to the DOM, so it can
 * carry the fill rather than the component inventing a marker for it.
 *
 * AND `disabled:` DOES NOT ERASE THE SELECTION. The disabled arm used to be unconditional, so
 * a checked-and-locked box painted as empty — the same defect `Switch` carried, and the same
 * consequence: the control told the user the opposite of its own state. The stacked arms below
 * are more specific than the bare `disabled:` one, so they win without an `!important`.
 *
 * `Radio` now reads `RADIO_BOX` (below), not this table: a radio in an unchecked group matches
 * `:indeterminate` per HTML, so these arms painted every radio of an unanswered group brand-filled.
 * The disabled-and-checked arm is kept there, deliberately: a selected radio that is locked had
 * exactly the same bug as the checkbox.
 */
export const CONTROL_BOX =
  'peer relative shrink-0 appearance-none border-2 bg-default-primary transition-colors border-default-invert hover:border-default-brand checked:border-default-brand checked:bg-default-brand indeterminate:border-default-brand indeterminate:bg-default-brand disabled:cursor-not-allowed disabled:border-default-primary disabled:bg-default-secondary disabled:checked:border-disable-brand disabled:checked:bg-disable-brand disabled:indeterminate:border-disable-brand disabled:indeterminate:bg-disable-brand';

/**
 * `Radio`'s box: `CONTROL_BOX` minus its four `indeterminate:` words (UMK-1492). A radio whose group has
 * no checked member matches `:indeterminate` (the `input.indeterminate` property stays false), so the
 * shared arms filled every radio of an unanswered group brand. Every other word is `CONTROL_BOX`'s, in order.
 */
export const RADIO_BOX =
  'peer relative shrink-0 appearance-none border-2 bg-default-primary transition-colors border-default-invert hover:border-default-brand checked:border-default-brand checked:bg-default-brand disabled:cursor-not-allowed disabled:border-default-primary disabled:bg-default-secondary disabled:checked:border-disable-brand disabled:checked:bg-disable-brand';

export const CONTROL_BOX_ERROR = 'border-default-error hover:border-default-error';

/** The glyph rides above the box and never eats the click that was aimed at it. */
export const CONTROL_GLYPH =
  'pointer-events-none absolute inset-0 m-auto h-full w-full p-ds-5xs text-default-invert';

export const CONTROL_ROW = 'inline-flex items-start gap-ds-2xs';

/**
 * A control with a label sits in the label's FIRST 20px line (the label is 14/20): the box centres on
 * that line, so it drops `(20 - box) / 2` - xlarge 0, large 1, medium 2, small 3. Only a labelled
 * control takes it; a bare box has no line to centre on.
 */
export const CONTROL_FIRST_LINE = {
  xlarge: 'mt-0',
  large: 'mt-px',
  medium: 'mt-ds-5xs',
  small: 'mt-[3px]', // ds-raw-ok: 3px is no spacing rung; (20 - 14) / 2
} as const;

/** The shared label line: every control renders its own, per the recorded divergence. */
export const CONTROL_LABEL = 'text-ds-paragraph-mobile text-default-primary';
export const FIELD_LABEL = 'text-ds-body-lg-mobile font-normal text-default-primary';

/**
 * The adornment slot: a leading or trailing element inside the box.
 *
 * Four live sites hand-roll this today, each with its own padding and its own icon colour.
 * `shrink-0` is the load-bearing part — without it the adornment compresses before the text
 * does, which on a narrow field gives a squashed glyph rather than a scrolled value.
 *
 * DECORATIVE BY DEFAULT is a component decision, not a class one: an interactive adornment is
 * the caller's own element and the caller owns its accessible name.
 */
export const FIELD_ADORNMENT = 'flex shrink-0 items-center text-default-secondary';

/**
 * The character counter, under the box rather than inside it.
 *
 * Inside the box it would sit in the same row as the trailing adornment and the password
 * reveal, and three things competing for one edge is how the hand-rolled versions ended up
 * overlapping. Under the box it also survives `multiline`, where the resize affordance owns
 * the bottom-right corner of the control itself.
 */
export const FIELD_COUNTER = 'self-end text-ds-body-md-mobile text-default-secondary';
/** Under a LARGE field the counter is Figma's 12/18 helper line; a small field and `counterPlacement="inside"` keep 10/16. */
export const FIELD_COUNTER_LARGE = 'self-end text-ds-body-lg-mobile text-default-secondary';

/** At or past the limit. A separate value rather than a modifier, so the purge guard sees it. */
export const FIELD_COUNTER_LIMIT = 'self-end text-ds-body-md-mobile text-default-error';
export const FIELD_COUNTER_LIMIT_LARGE = 'self-end text-ds-body-lg-mobile text-default-error';

/** The tick a `valid` field shows at its trailing edge, only when the caller gave no trailing adornment. */
export const FIELD_VALID_MARK = 'flex shrink-0 items-center text-default-success';

/**
 * THE SELECTABLE OPTION CARD — the shape the agent surface's choice picker renders, which is
 * the second most-used component in that corpus and had no library equivalent at all.
 *
 * The input itself is visually hidden rather than replaced: the card is a `<label>` wrapping a
 * real radio or checkbox, so the group semantics, the roving focus and the arrow keys come
 * from the platform. `peer-checked:` is what lets the card react to a control it does not
 * contain visually, which is the same trick the tick box uses one file up.
 */
export const SELECTION_CARD_ROW = 'flex w-full flex-col gap-ds-2xs';

/** `columns={2}`: replaces the row's flex column (never stacked on it - `flex` and `grid` would race). */
export const SELECTION_CARD_GRID = 'grid w-full grid-cols-1 gap-ds-2xs sm:grid-cols-2';

/* NO gap here: the size step (or the tile step) carries it. A `ds-` rung appended beside another is
   not resolved by `cn` — both ship and the stylesheet's order decides (packages/ui CLAUDE.md) — so a
   `gap-ds-2xs` here made every small card 8px apart instead of its step's 6 (UMK-1218 review). */
export const SELECTION_CARD = `relative flex w-full cursor-pointer items-start border bg-default-primary text-left transition-colors hover:border-default-brand ${FOCUS_RING.field}`;

export const SELECTION_CARD_SIZE = {
  large: 'gap-ds-2xs px-ds-md py-ds-sm rounded-ds-lg',
  small: 'gap-ds-3xs px-ds-sm py-ds-2xs rounded-ds-md',
} as const;

export const SELECTION_CARD_STATE = {
  default: 'border-default-primary',
  selected: 'border-default-brand bg-weak-brand',
  disabled: 'border-default-primary bg-default-secondary text-disable-primary cursor-not-allowed',
} as const;

/**
 * THE LAYOUT AXIS (UMK-1218). `row` is the agent surface's picker: icon left, text beside it, the
 * control hidden. `tile` is a pack picker's card: a centred stack with the control VISIBLE in the
 * top-right corner (Teman AI Page `WE0rXA29d9M54Sm2dghsBL`, mobile coin cards 14275:102539 — a
 * 156×144 card, content centred, the 18px `02 Radio Button` pinned 8px from the top and right).
 *
 * A tile's border is 2px in every state, so selecting one (the brand 2px border the product owner's
 * reference draws) changes the colour without moving the content; unselected, that border is the
 * same #F0F0F0 token Figma's 1px stroke uses.
 *
 * The layout table carries NO spacing. A tile's spacing is its own STEP, `SELECTION_CARD_TILE_SIZE`,
 * which the card SELECTS in place of `SELECTION_CARD_SIZE` rather than appending over it: `cn` cannot
 * resolve two `ds-` rungs of one property (`gap-ds-2xs` beside `gap-ds-3xs` both ship, and the
 * stylesheet's order picks one), so an appended override is not an override (UMK-1218 review).
 */
export const SELECTION_CARD_LAYOUT = {
  row: 'flex-row',
  tile: 'relative flex-col items-center justify-center border-2 text-center',
} as const;

/**
 * The tile's step, selected INSTEAD of the size step: Figma's frame at every size — 24 top, 12 sides
 * and bottom, 6 between the icon and the heading, a 12px radius. (20 between the heading and the
 * body is the text column's, `SELECTION_CARD_TILE_TEXT`.)
 */
export const SELECTION_CARD_TILE_SIZE = {
  large: 'gap-ds-3xs px-ds-sm pb-ds-sm pt-ds-xl rounded-ds-lg',
  small: 'gap-ds-3xs px-ds-sm pb-ds-sm pt-ds-xl rounded-ds-lg',
} as const;

/** The tile's text column: centred, 20px between the heading and the body. */
export const SELECTION_CARD_TILE_TEXT = 'items-center gap-ds-lg';

/** A tile's badge straddles its top edge, centred — Figma's `Badge` there is absolute, TOP/CENTER. */
export const SELECTION_CARD_TILE_BADGE = 'absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2';

/** The tile's corner control: an 18px ring, white — `border-default-invert` #C3CBD3, as Figma draws it. */
export const SELECTION_CARD_INDICATOR =
  'pointer-events-none absolute right-ds-2xs top-ds-2xs flex h-4.5 w-4.5 items-center justify-center border bg-default-primary';

/** A radio's ring is round, a checkbox's square — the same control the card holds, drawn. */
export const SELECTION_CARD_INDICATOR_SHAPE = {
  radio: 'rounded-ds-full',
  checkbox: 'rounded-ds-xs',
} as const;

export const SELECTION_CARD_INDICATOR_STATE = {
  default: 'border-default-invert',
  selected: 'border-default-invert',
  disabled: 'border-default-primary bg-default-secondary',
} as const;

/** The mark inside a selected indicator: a brand-filled dot (radio) or square (checkbox). */
export const SELECTION_CARD_INDICATOR_MARK = 'h-3 w-3 bg-default-brand';

/**
 * THE INVERTED HIERARCHY, as two tables rather than one.
 *
 * When an option's description carries a title, that title becomes the heading and the
 * authored label demotes to an eyebrow above it. The agent surface's own adapter explains
 * why: its flow validation matches against the AUTHORED label, so the label cannot be
 * rewritten to hold a generated title — the split is the only place the generated one can go.
 * A card that renders the label as the heading regardless gets every one of those wrong.
 */
export const SELECTION_CARD_EYEBROW = 'text-ds-body-md-mobile uppercase tracking-wide text-default-secondary';
export const SELECTION_CARD_HEADING = 'text-ds-body-lg-mobile font-bold text-default-primary';
export const SELECTION_CARD_BODY = 'text-ds-body-lg-mobile text-default-secondary';

/** The real control, kept in the tree and out of sight — never `display:none`, which unfocusable. */
export const SELECTION_CARD_INPUT = 'peer sr-only';

/**
 * THE DROPZONE. Figma's `Upload Area` and the text area share nine property IDs — they are one
 * shell seen twice — which is why this reuses the text fields' label wiring rather than
 * inventing its own.
 */
/* NO BORDER STYLE HERE — it is the `border` axis below. The width stays, because every value
   of that axis has one. */
export const UPLOAD_BASE = `flex w-full cursor-pointer flex-col items-center justify-center border bg-default-primary text-center transition-colors ${FOCUS_RING.field}`;

/**
 * SOLID OR DASHED, and only one of them is published.
 *
 * Figma's `Upload Area` strokes the zone with `strokeDashes: None`, so `solid` is the default
 * and the parity answer. `dashed` is OURS — recorded as a divergence — and it exists because a
 * dashed rule is the near-universal "drop a file here" convention and the app's own live
 * dropzone ships it. A caller that needs it should say so through this axis rather than through
 * `className`: an override there lives in the consumer, where this package's purge guard cannot
 * see it, and reads as drift rather than as a decision.
 */
export const UPLOAD_BORDER = {
  solid: 'border-solid',
  dashed: 'border-dashed',
} as const;

export const UPLOAD_SIZE = {
  large: 'gap-ds-2xs px-ds-md py-ds-xl rounded-ds-lg text-ds-paragraph-mobile',
  small: 'gap-ds-3xs px-ds-sm py-ds-sm rounded-ds-md text-ds-body-lg-mobile',
} as const;

/**
 * Figma spells the third value `Error Not Filled`; the shortening is recorded as a divergence
 * rather than the phrase being imported.
 *
 * EVERY VALUE HERE IS CALLER-DECLARED, and that is what keeps the axis portable. `busy` is
 * ours — Figma publishes no such value, recorded as a divergence — but a caller can *say* it
 * on any platform. Drag-over cannot: it is a pointer condition that does not exist on native,
 * so it is NOT on this ramp. See `UPLOAD_DRAG_OVER`.
 *
 * The precedence is fixed in the component, not discovered here:
 * `disabled → busy → error → filled → default`.
 */
export const UPLOAD_STATUS = {
  default: 'border-default-primary hover:border-default-brand text-default-secondary',
  filled: 'border-default-invert hover:border-default-brand text-default-primary',
  error: 'border-default-error hover:border-default-error text-default-error',
  disabled: 'border-default-primary bg-default-secondary text-disable-primary cursor-not-allowed',
  busy: 'border-default-primary bg-default-secondary text-default-secondary cursor-progress',
} as const;

/**
 * The drag-over treatment — ADDITIVE, and deliberately not a status value.
 *
 * A status is what the caller declares about the upload, and every value of that axis has to
 * be sayable on both platforms because web and native siblings consume ONE contract. There is
 * no drag on native, so putting drag-over on the ramp would force a native sibling to define a
 * style for a status it can never reach — a dead entry the compiler demands. The variant
 * contract stops being shared the moment it names something belonging to one platform.
 *
 * So this composes OVER the resolved status instead. It is web-only by construction: nothing
 * on native ever applies it, and the shared axis stays true on both.
 */
export const UPLOAD_DRAG_OVER = 'border-default-brand bg-weak-brand text-default-brand';

export const UPLOAD_INPUT = 'sr-only';

/**
 * A VALUE-BEARING LISTBOX. `Menu` cannot substitute: it carries items with their own handlers
 * and an optional per-row tick, but no value/onValueChange pair — so a caller has to hold the
 * selection itself and Menu never reflects it.
 */
export const SELECT_TRIGGER = `flex w-full items-center justify-between border bg-default-primary text-default-primary transition-colors ${FOCUS_RING.field}`;

/*
 * NO SIZE OR STATE TABLE OF ITS OWN. A select trigger is the same box as a text field, so it
 * reads `BOX_SIZE` and `BOX_STATE` directly — which is the whole reason this file exists.
 */

/**
 * IN PLACE, NOT PORTALLED, and that is what resolves a live conflict rather than deferring it.
 *
 * The dialog guidance says to set a parent dialog non-modal when a child overlay opens inside
 * it; the overlay guard was hardened so a non-modal dialog reddens. A listbox that never
 * leaves the document flow never poses the question — `absolute` inside a `relative` wrapper
 * needs no portal, no focus trap negotiation and no z-index race with a dialog.
 */
/*
 * `w-max min-w-full max-w-[calc(100vw-2rem)]` (UMK-1186): the list is as wide as its rows,
 * never narrower than the trigger, and never wider than the screen. `w-full` alone took the
 * trigger's width, so a country code in a phone field's prefix opened onto a list the width of
 * "+62", with every hint wrapped and clipped. The widening sits on `width` and not `min-width`
 * because CSS applies `min-width` LAST: a `min-w-max` overrode the cap, and a long row
 * ("Kabupaten Kepulauan Seribu · DKI Jakarta") ran off a phone's edge. Under the cap a long row
 * wraps. The cap assumes a trigger that starts near the page gutter; one inset further (a right
 * column, a dialog) can still overflow by that offset.
 * The PORTAL path pins the list to its popover (`Select.tsx`), whose width is the trigger's.
 */
export const SELECT_LIST =
  'absolute z-ds-overlay mt-ds-4xs max-h-60 w-max min-w-full max-w-[calc(100vw-2rem)] overflow-auto border border-default-primary bg-default-primary py-ds-4xs shadow-lg';

/**
 * THE OPEN LIST FOLLOWS THE TRIGGER'S SIZE (UMK-1122). Before this the list carried no type
 * size at all and inherited the page's, so `large` matched only by accident and a `small`
 * trigger opened onto rows bigger than itself. The ramp mirrors `BOX_SIZE` — there is no
 * Figma set for Select, so the small metrics are DERIVED from the small box, not read.
 */
export const SELECT_LIST_SIZE = {
  large: 'rounded-ds-lg',
  small: 'rounded-ds-md',
} as const;

/** Every row in the list — option, search, message, create — takes its padding and type from here. */
export const SELECT_ROW_SIZE = {
  large: 'px-ds-md py-ds-sm text-ds-paragraph-desktop',
  small: 'px-ds-md py-ds-xs text-ds-paragraph-mobile',
} as const;

export const SELECT_OPTION = {
  default: 'flex w-full cursor-pointer items-center text-left text-default-primary hover:bg-weak-brand',
  active: 'flex w-full cursor-pointer items-center text-left bg-weak-brand text-default-brand',
} as const;

/** The search row: a leading search glyph, then the input (per the UMK-1119 mock). */
export const SELECT_SEARCH = 'flex w-full items-center gap-ds-2xs border-b border-default-primary text-default-secondary';

export const SELECT_SEARCH_INPUT =
  'min-w-0 flex-1 bg-transparent text-default-primary outline-none placeholder:text-default-secondary';

/** An empty result is a message, never a blank box — a box with nothing in it reads as broken. */
export const SELECT_EMPTY = 'text-default-secondary';

/**
 * An option's secondary text — a city's province, a variant's unit. Muted and INLINE, so the
 * option still reads as one line: a hint on its own line turns a listbox into a menu of cards.
 */
export const SELECT_OPTION_HINT = 'text-default-secondary';

/**
 * The line under a disabled field explaining WHY it is disabled ("pick a province first").
 * Distinct from `FieldError`: this is not an error region, it is never announced as an alert,
 * and it disappears the moment the field becomes usable.
 */
export const SELECT_DISABLED_HINT = 'text-ds-body-md-mobile text-default-secondary';

/**
 * `OtpInput` (UMK-1186): ONE real input drawn as a row of boxes. The input is laid over the
 * whole row at zero opacity rather than `sr-only`, so a tap anywhere lands in it and the OS
 * autofill has an on-screen field to target. The boxes take `BOX_STATE` like the text box, so
 * a code field and a text field share their border, error and disabled inks.
 */
export const OTP_ROW = 'relative inline-flex gap-ds-2xs';
export const OTP_BOX =
  'flex items-center justify-center border bg-default-primary font-semibold text-default-primary transition-colors';
export const OTP_BOX_SIZE = {
  large: 'h-12 w-11 rounded-ds-lg text-ds-paragraph-mobile',
  small: 'h-10 w-9 rounded-ds-md text-ds-body-lg-mobile',
} as const;
/** The box the next digit lands in, while the input has focus. */
export const OTP_BOX_ACTIVE = 'border-focus-brand';
export const OTP_INPUT = 'absolute inset-0 h-full w-full cursor-text opacity-0 disabled:cursor-not-allowed';

/** UMK-1325 SegmentedControl: a pill track holding N radio segments; the chosen one fills. */
export const SEGMENTED_TRACK =
  'inline-flex gap-ds-3xs rounded-ds-full border border-default-primary bg-default-secondary p-ds-3xs';
export const SEGMENTED_SEGMENT =
  'rounded-ds-full text-default-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50';
export const SEGMENTED_SEGMENT_SIZE = {
  medium: 'px-ds-md py-ds-2xs text-ds-paragraph-mobile',
  small: 'px-ds-sm py-ds-3xs text-ds-body-lg-mobile',
} as const;
export const SEGMENTED_SEGMENT_CHECKED = 'bg-default-brand font-semibold text-default-invert';
