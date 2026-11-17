/**
 * The chat MESSAGE family's class tables, in one place.
 *
 * Same siting rule as every other `*-classes.ts` here: not in `utils/`, because these are one
 * family's chrome rather than a general mapping, and not in `contract/`, which may not name a
 * Tailwind class at all.
 *
 * A SECOND FAMILY IN ONE CATEGORY, NOT A SECOND TABLE IN THE COMPOSER'S. The `Chat` category now
 * holds two families: `composer` owns the input half and `message` owns the transcript above it.
 * They are disjoint sets of components, and the purge guard derives its expectations from its
 * class module's exports — so folding two disjoint tables under one guard would make that
 * derivation a lie about both. The family is named for the message rather than for the category
 * because `family` and `category` are deliberately separate fields: a family named for the
 * category would claim the eight composer entries it does not cover.
 *
 * THERE IS NO PUBLISHED DESIGN. Ensyra publishes no message, bubble or transcript set — the
 * `Chat bar` canvas holds the composer and nothing above it — so every value below is greenfield
 * and each contract entry records its divergences against that absence rather than against a
 * node. What is NOT greenfield is the vocabulary: the spacing and radius rungs are the token
 * ladder's own named steps, never a numeric ladder borrowed from elsewhere.
 *
 * THE DENSITY PADDING IS TWO TABLES, AND THE SPLIT IS THE ALIGNMENT MECHANISM. A bubble takes
 * both the inline and the block entry; a ghost bubble keeps the inline one and zeroes the block
 * one, and the name and metadata slots beside it take the inline one alone. That is what makes a
 * non-bubble child's left edge line up with bubble text instead of with the message edge. Merge
 * the two into one padding entry and the alignment becomes unexpressible without a second table.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE. Tailwind scans it as content, so a
 * class named in a comment is emitted whether or not any component still uses it — which props
 * the purge guard up on its own documentation.
 */

import { contract } from '../contract';
import { FOCUS_RING } from '../utils';

type MessageAxes = typeof contract.ChatMessage.axes;
type Density = MessageAxes['density'][number];
type Sender = MessageAxes['sender'][number];
type BubbleAxes = typeof contract.ChatMessageBubble.axes;
type MetaAxes = typeof contract.ChatMessageMetadata.axes;
type ListAxes = typeof contract.ChatMessageList.axes;
type PillAxes = typeof contract.ChatScrollButton.axes;
type TtsAxes = typeof contract.ChatMessageTTSButton.axes;

/* ---------------------------------------------------------------- the message row */

/**
 * THE ARTICLE IS THE COLUMN, AND THE SPEAKER IS A HEADER ABOVE IT RATHER THAN A FACE BESIDE IT.
 *
 * The first cut of this family ran the row horizontally — avatar in one flex child, everything
 * else in a second — and flipped the user side with `row-reverse`. It was self-consistent and it
 * was not what this product draws. Both shipped surfaces put the avatar and the name in a small
 * header ABOVE the reply (`AgentMessage.tsx`'s author row, and the native view's `author` style),
 * and neither gives the user a face at all. A component whose only layout is the one the apps do
 * not use is a component nobody can adopt, so the axis it varies is now the column's cross-axis
 * alignment and the direction table is gone.
 *
 * IT PINS ITS OWN INLINE MINIMUM AND TAKES THE FULL WIDTH. A flex child's default minimum is its
 * content, so an unpinned minimum lets one unbroken string — a URL, a hash — push the row wider
 * than the transcript and scroll the whole region sideways. The full width is the half a browser
 * pass added on the old two-element shape: a bubble asking for the full width resolved it against
 * a column that shrink-wrapped to the bubble, so the override appeared to do nothing and the text
 * wrapped early inside a column with room to spare. Every class resolved and every guard passed;
 * the rendered page was the only evidence. Collapsing the row and the column into one element is
 * what makes that unexpressible rather than merely fixed.
 */
export const MESSAGE_ROOT = 'flex w-full min-w-0 flex-col';

/**
 * THE AUTHOR HEADER — the avatar and the name on one line, above the turn.
 *
 * IT CARRIES NO INSET OF ITS OWN AND THE COMPONENT GIVES IT THE DENSITY ONE, which is the same
 * arrangement the metadata row below already had. The header shipped FLUSH with the message edge
 * for one run, on the reasoning that the avatar is the leftmost thing in the row — true of the
 * app, where the assistant side has no inset anywhere at all. It is not true here: a bubble takes
 * the inline padding, so a flush header put the face a whole inset to the left of the words under
 * it and the column read as two left edges. A GHOST bubble makes it plainer still, because its
 * padding survives without a fill to explain it — the indentation is invisible and the
 * misalignment is not.
 *
 * So every slot in the column reads ONE table: the header, the bubble and the metadata. That is
 * the property worth keeping, rather than any particular edge.
 */
export const MESSAGE_AUTHOR = 'flex items-center gap-2';

/**
 * The avatar slot: a 28px circle on the page surface with a hairline and a small lift, centring
 * whatever the host passes (an 18px mark, initials). It draws the FRAME so every host's face reads
 * as one family — the live agent chat drew exactly this around its mark (UMK-1041, L23). It does
 * not shrink, so a long name cannot squeeze the face to nothing.
 */
export const MESSAGE_AVATAR =
  'flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default-primary bg-default-primary shadow-sm';

/**
 * Which edge the column's children hug, per sender. This is the whole of the user-side flip now:
 * one authored order, read the same way by a screen reader on both sides of the transcript.
 *
 * `system` centres rather than picking a side: it is nobody's turn, and a system notice pinned to
 * the assistant's edge reads as something the assistant said.
 */
export const MESSAGE_CONTENT_ALIGN = {
  assistant: 'items-start',
  user: 'items-end',
  system: 'items-center',
} as const satisfies Record<Sender, string>;

/**
 * THE GAP INSIDE ONE MESSAGE — between the author header, the turn, and the metadata, and between
 * consecutive bubbles in a grouped run. The one the slot pulls below are sized against.
 *
 * IT IS A DENSITY TABLE, AND IT SHIPPED AS ONE CONSTANT. That was the bug, and it was invisible
 * from inside this package: `density` moved the bubble's padding and the list's row gap, so a
 * story flipping the prop DID visibly change — while the header, the turn and the metadata stayed
 * a fixed 8px apart at every setting. The prop looked honoured and was two thirds honoured. No
 * assertion could see it either, because every check here reads one table at a time and a
 * constant is a perfectly well-formed one.
 *
 * The rungs are also a step up from where they were. `balanced` now lands on the live surface's
 * own spacing — a 6px header-to-turn distance once the pull below is taken off, matching the app's
 * `mb-1.5` — where the old constant left 4px at every density and read as one crowded block.
 */
export const MESSAGE_CONTENT_GAP = {
  compact: 'gap-ds-2xs',
  balanced: 'gap-ds-sm',
  spacious: 'gap-ds-md',
} as const satisfies Record<Density, string>;

/**
 * THE SLOT PULLS, and they are why the bubble returns a FRAGMENT rather than a wrapper.
 *
 * The name and metadata slots are siblings of the bubble inside the content column's flex, not
 * children of a box around the three. That keeps a run of grouped bubbles evenly spaced — wrap
 * them in a div and every group gains one column gap it did not ask for at each end. The price is
 * that both slots sit a full column gap away from the bubble they belong to, which reads as three
 * unrelated rows, so each pulls most of that gap back.
 *
 * MOST, NOT ALL. Pulling the whole gap butts the timestamp against the bubble's edge; leaving a
 * sliver is what makes the three read as one message.
 *
 * TWO TABLES RATHER THAN ONE NESTED ONE, and per density rather than fixed. A pull sized against a
 * gap that moves has to move with it or the sliver it leaves is a different fraction at every
 * setting — at the old fixed 4px against the new spacious 16px gap it would have left 12px, which
 * is further apart than the gap between two whole messages used to be. Nested one level deeper
 * (`{ author: { compact: … } }`) they would also fall outside the shape the purge guard's
 * flattener walks, and an export it walks past is an export nothing checks.
 */
export const MESSAGE_AUTHOR_PULL = {
  compact: '-mb-ds-4xs',
  balanced: '-mb-ds-3xs',
  spacious: '-mb-ds-2xs',
} as const satisfies Record<Density, string>;

/** The metadata's half of the same mechanism, pulling the other edge. */
export const MESSAGE_META_PULL = {
  compact: '-mt-ds-4xs',
  balanced: '-mt-ds-3xs',
  spacious: '-mt-ds-2xs',
} as const satisfies Record<Density, string>;

/**
 * The name slot's own type treatment. It sits in the author header, so it takes no inset. Strong
 * ink and semibold, as the live agent chat draws the speaker (L23) — the earlier small secondary
 * line read as a caption rather than as who is talking.
 */
export const MESSAGE_NAME = 'text-ds-paragraph-mobile font-semibold text-default-primary';

/* ---------------------------------------------------------------- density */

/**
 * THE INLINE HALF of the density padding — the bubble's side padding, and the inset a ghost
 * bubble and both slots keep. See the file note: this is the alignment mechanism, not a split for
 * tidiness.
 */
export const MESSAGE_INSET = {
  compact: 'px-ds-sm',
  balanced: 'px-ds-md',
  spacious: 'px-ds-lg',
} as const satisfies Record<Density, string>;

/**
 * THE BLOCK HALF — the bubble's own vertical padding, and the only half a ghost zeroes.
 *
 * `balanced` is the app's `py-3`. It was `py-ds-2xs` (8px), which drew a bubble noticeably
 * shorter than the one the product ships while every class still resolved.
 */
export const MESSAGE_BLOCK = {
  compact: 'py-ds-2xs',
  balanced: 'py-ds-sm',
  spacious: 'py-ds-md',
} as const satisfies Record<Density, string>;

/* ---------------------------------------------------------------- the bubble */

/**
 * The bubble's shape and type, minus its fill.
 *
 * IT BREAKS WORDS. A transcript is the one surface where an unbroken token is normal input — a
 * pasted URL, a base64 blob, a hash — and a bubble that will not break one is a bubble that
 * widens past the column while every class name on it still looks right.
 */
export const MESSAGE_BUBBLE_BASE = 'min-w-0 break-words rounded-ds-xl text-ds-paragraph-mobile leading-5';

/**
 * THE FILL, PER SENDER, AND THE TWO ENTRIES HOLD THE SAME VALUE ON PURPOSE.
 *
 * The published callout surface is the exact colour the app's bubble hardcodes today, so both
 * sides take it and the swap is not a visual change. Keeping them as separate entries rather than
 * one shared constant is the whole point: a later theme that wants to tint one sender can edit
 * one row, where a shared constant would have to be split first — and splitting a constant two
 * components read is the edit most likely to move both.
 *
 * `system` is the one that genuinely differs. It is not a turn, so it takes the plain secondary
 * surface rather than either side's voice.
 *
 * EVERY ROW TAKES THE BODY TEXT COLOUR, NOT ITS SURFACE'S PAIRED ONE, AND THAT IS THE WHOLE
 * CORRECTION. This shipped for one run reading `text-callout-default-text` on both voices — the
 * colour published alongside the callout surface, and the obvious partner to pick once the fill
 * was settled. It is the info-callout's PROSE colour (`#0051a2`, a blue) and the app's transcript
 * is navy (`text-gray-900` on the agent surface, `#042648` in the classic renderer), so every
 * reply drew a shade of blue nobody had asked for. Nothing in this package could see it: the
 * class resolved, the purge guard proved a colour was named, and only looking at the rendered
 * page told the two apart — the UMK-978 shape, one family later. The `system` row had the
 * sibling defect and worse: secondary text on the secondary surface is `#93a2b0` on `#f6f6f6`,
 * which is not a contrast ratio a notice can be read at.
 */
export const MESSAGE_BUBBLE_SENDER = {
  assistant: 'bg-callout-default-surface text-default-primary',
  user: 'bg-callout-default-surface text-default-primary',
  system: 'bg-default-secondary text-default-primary',
} as const satisfies Record<Sender, string>;

/**
 * GHOST: THE BLOCK PADDING GOES, THE INLINE PADDING STAYS.
 *
 * A ghost bubble is how a non-bubble child — a media grid, an artifact card — gets the bubble's
 * inline padding so its leading edge matches the text column above it. Zero the inline padding too
 * and it becomes an ordinary wrapper that aligns nothing, which is the one thing it exists for.
 *
 * IT IS A SUBSTITUTION, NOT AN OVERRIDE, AND THAT IS FORCED BY THE MERGE HELPER. This shipped for
 * one run as a zeroing entry appended after the fill and the block padding — the obvious shape,
 * and silently inert: the class merger resolves a conflict from a map of Tailwind's OWN utility
 * values, and the design system's named rungs are not in it, so two vertical paddings on one
 * element do not read as a conflict at all. Both survive onto the element, neither wins by being
 * later, and which one paints is decided by their order in the emitted stylesheet. Every class
 * name on the element was still correct. So the component picks this table INSTEAD of the pair
 * rather than after it, and the guard asserts this entry names no padding on either axis — an
 * entry that zeroes one is an entry that is trying to override again.
 */
export const MESSAGE_BUBBLE_GHOST = 'bg-transparent';

/**
 * THE WIDTH OVERRIDE CLEARS THE CAP IN THE SAME ENTRY, and that is not tidiness.
 *
 * The default cap is what keeps a one-line reply from spanning a desktop column. Setting a width
 * without clearing the cap leaves the cap winning, so the override appears to do nothing on a
 * wide surface and to work on a narrow one — a bug that only shows up at one end of the viewport
 * range and looks like a layout accident.
 */
export const MESSAGE_BUBBLE_WIDTH = {
  auto: 'max-w-[85%]',
  /* THREE PARTS, AND ALL THREE ARE LOAD-BEARING. The column aligns its children to one edge, so a
     child asking for the full width is still laid out at its own size unless it also opts out of
     that alignment — which is what the self-stretch does. Drop it and the override sets a width
     against a box that never grew. */
  full: 'w-full max-w-none self-stretch',
} as const satisfies Record<BubbleAxes['width'][number], string>;

/**
 * GROUPED RADII, IN LOGICAL PROPERTIES.
 *
 * A run of consecutive bubbles from one sender tucks its corners toward that sender's edge, which
 * is what makes the run read as one turn rather than as three. There are two tables because the
 * sender decides WHICH edge tucks, and they are logical rather than physical (`start`/`end`, not
 * `left`/`right`) so a right-to-left reader gets the tuck on the side the message is actually on.
 * Physical corners would put every user bubble's tuck on the wrong side in Arabic with nothing in
 * this package able to see it.
 *
 * `none` is the standalone bubble and paints nothing: a lone message keeps all four corners.
 */
export const MESSAGE_GROUP_START = {
  none: '',
  first: 'rounded-es-ds-xs',
  middle: 'rounded-ss-ds-xs rounded-es-ds-xs',
  last: 'rounded-ss-ds-xs',
} as const satisfies Record<BubbleAxes['group'][number], string>;

export const MESSAGE_GROUP_END = {
  none: '',
  first: 'rounded-ee-ds-xs',
  middle: 'rounded-se-ds-xs rounded-ee-ds-xs',
  last: 'rounded-se-ds-xs',
} as const satisfies Record<BubbleAxes['group'][number], string>;

/* ---------------------------------------------------------------- metadata */

/** The metadata row. Direction comes from the table below; the authored order never changes. */
export const MESSAGE_META_ROOT = 'flex items-center gap-ds-4xs text-ds-legacy-xs leading-4 text-default-secondary';

/**
 * THE REVERSAL IS THE FLEX DIRECTION ALONE, for the reason the message row's is: the authored
 * order stays timestamp, footer, status, so what assistive technology receives is the same
 * sentence on both sides of the transcript.
 */
export const MESSAGE_META_DIRECTION = {
  assistant: 'flex-row',
  user: 'flex-row-reverse',
  system: 'flex-row',
} as const satisfies Record<Sender, string>;

/** The dot between two present pieces. Never selectable — it is punctuation, not content. */
export const MESSAGE_META_SEPARATOR = 'select-none text-disable-primary';

/**
 * DELIVERY STATUS, FIVE VALUES, AND ONLY TWO OF THEM PAINT.
 *
 * `sending` is the only one that moves, and it carries the reduced-motion variant WITH the
 * animation rather than near it: this package expresses reduced motion as a Tailwind variant a
 * guard can read off the class list, never as a runtime media query — the test environment has no
 * media engine, so a runtime check is unassertable here and would ship unproved.
 *
 * `error` is the only one that changes colour. The other three inherit the row's secondary tone
 * on purpose: a delivered message is not news, and three quiet states that each paint something
 * turn a timestamp row into a traffic light.
 */
export const MESSAGE_META_STATUS = {
  sending: 'animate-pulse motion-reduce:animate-none',
  sent: '',
  delivered: '',
  read: '',
  error: 'text-default-error',
} as const satisfies Record<MetaAxes['status'][number], string>;

/** The status glyph. Smaller than the row's type, so it reads as a mark rather than a word. */
export const MESSAGE_META_GLYPH = 'h-3.5 w-3.5 shrink-0';

/** The status group: glyph beside its label, never wrapping between the two. */
export const MESSAGE_META_STATUS_GROUP = 'inline-flex shrink-0 items-center gap-ds-5xs';

/* ---------------------------------------------------------------- the list */

/**
 * THE LIST IS TWO ELEMENTS, AND THE SPLIT IS LOAD-BEARING.
 *
 * The root is the flex child and the log region; the inner content element carries the gap and the
 * padding. The scroll owner observes the INNER element for height, so content growth is a separate
 * measurement from the scroll box's own size — collapse the two and every resize of the viewport
 * reads as content arriving.
 */
export const MESSAGE_LIST_ROOT = 'flex min-h-0 w-full flex-1 flex-col';

/** The inner element's own shape. Its spacing comes from the two tables below. */
export const MESSAGE_LIST_CONTENT = 'flex w-full flex-col';

/**
 * THE DENSITY'S PADDING AND ITS GAP ARE TWO TABLES, FOR THE REASON THE BUBBLE'S PADDING IS.
 *
 * A caller's `gap` replaces the gap and must leave the padding alone. Writing both into one
 * density entry and appending the override is the obvious shape and is silently inert: the class
 * merger resolves conflicts from a map of Tailwind's own utility values, and the named rungs are
 * not in it, so two gaps on one element are not a conflict it can see. Both ship and the emitted
 * stylesheet's order decides. Split, the component SELECTS one gap instead of stacking two.
 */
export const MESSAGE_LIST_PAD = {
  compact: 'p-ds-sm',
  balanced: 'p-ds-lg',
  spacious: 'p-ds-xl',
} as const satisfies Record<Density, string>;

/**
 * THE GAP BETWEEN WHOLE MESSAGES, and it has to clear the gap INSIDE one or the transcript reads
 * as a single column of evenly-spaced lines with no turn boundaries. That was the second half of
 * the compactness: at `balanced` the two were 12px between messages against 8px inside one, a 4px
 * difference carrying the whole distinction between "the same speaker, still going" and "somebody
 * else now". Each rung is now comfortably above its `MESSAGE_CONTENT_GAP` counterpart.
 */
export const MESSAGE_LIST_DENSITY_GAP = {
  compact: 'gap-ds-sm',
  balanced: 'gap-ds-lg',
  spacious: 'gap-ds-2xl',
} as const satisfies Record<Density, string>;

/**
 * The gap override, on the token ladder's OWN named rungs rather than a numeric scale.
 *
 * IT DOES NOT REACH `spacious`, AND THAT IS FINE RATHER THAN AN OVERSIGHT. The rungs top out at
 * `lg` while the spacious density draws wider than that, so the override cannot reproduce every
 * density — it is a different ladder for a different purpose. A surface that wants spacious asks
 * for the density; this is for a surface that wants one specific spacing regardless of it, which
 * in practice means a tighter one.
 *
 * A borrowed numeric ladder was the alternative and is refused: it would contradict the named
 * ladder the rest of this package reads, in the one place a caller picks a spacing by hand.
 */
export const MESSAGE_LIST_GAP = {
  none: 'gap-ds-null',
  '2xs': 'gap-ds-2xs',
  xs: 'gap-ds-xs',
  sm: 'gap-ds-sm',
  md: 'gap-ds-md',
  lg: 'gap-ds-lg',
} as const satisfies Record<ListAxes['gap'][number], string>;

/**
 * THE BOTTOM-ALIGNMENT SPACER, AND IT IS A REAL ELEMENT RATHER THAN A JUSTIFICATION.
 *
 * A short conversation should sit above the composer, not hang from the top of an empty region.
 * Justifying the content to its end would do it and would also break the scroller: the overflow
 * direction flips, so the first fill lands at the wrong end. A grown spacer collapses to nothing
 * the moment the content overflows, which is why both alignments present the same geometry to the
 * scroll owner.
 */
export const MESSAGE_LIST_SPACER = 'flex-1';

/** What the region shows when it holds nothing. */
export const MESSAGE_LIST_EMPTY =
  'flex flex-1 flex-col items-center justify-center gap-ds-2xs text-ds-paragraph-mobile text-default-secondary';

/**
 * The load-older sentinel: a first child of the content element with height but no ink.
 *
 * A HAIRLINE RATHER THAN NOTHING, and rather than a hidden element. A hidden element is not
 * observable at all — the intersection never fires and the load-older action becomes unreachable
 * with nothing failing — and a zero-height box is a coin toss across engines.
 */
export const MESSAGE_LIST_SENTINEL = 'h-px w-full shrink-0';

/** The pending row the action shows while it is unresolved. */
export const MESSAGE_LIST_PENDING = 'flex w-full shrink-0 items-center justify-center py-ds-2xs';

/* ---------------------------------------------------------------- the frame and the pill */

/**
 * The transcript frame. It is the positioning context the pill is pinned inside, and it composes
 * in the app shell's content slot without either frame fighting the other for the scroller: the
 * shell's content region refuses to grow with both minimums pinned, precisely so a child can
 * scroll, and its scroll spy resolves that region once and tests containment — so a scroller
 * nested inside it keeps feeding the header's shadow.
 */
export const MESSAGE_THREAD_ROOT = 'relative flex min-h-0 w-full flex-1 flex-col';

/**
 * THE SCROLLER, AND CONTAINING THE OVERSCROLL IS NOT POLISH. Without it a transcript scrolled to
 * its end hands the gesture to the page, and on a phone that is the pull-to-refresh a reader did
 * not ask for.
 */
export const MESSAGE_THREAD_SCROLLER =
  'flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain';

/**
 * Where the pill sits. It takes no pointer events, so the strip across the transcript's foot does
 * not swallow a tap meant for the last message; the pill itself takes them back.
 */
export const MESSAGE_THREAD_PILL_SLOT =
  'pointer-events-none absolute inset-x-0 bottom-ds-md flex justify-center';

/**
 * The pill. Its transition carries the reduced-motion variant for the same reason the pulsing
 * delivery status does — a class a guard can read, never a runtime media query.
 *
 * THE ELEVATION IS THE MIDDLE STEP, NOT THE SMALL ONE, and a browser pass is what settled it. The
 * pill rests on the plain surface with the plain border — a near-white circle on a near-white
 * transcript — so at the small step it was technically present and practically invisible. An
 * affordance a reader cannot find is not an affordance, and no assertion here can see the
 * difference: both steps resolve, both are emitted, and the class name is right either way.
 */
export const MESSAGE_SCROLL_BUTTON = `pointer-events-auto relative inline-flex h-9 shrink-0 items-center gap-ds-4xs rounded-ds-full border border-default-primary bg-default-primary text-ds-legacy-xs leading-4 text-default-primary shadow-md transition-colors hover:bg-hover-neutral motion-reduce:transition-none ${FOCUS_RING.control}`;

/**
 * TWO SHAPES, ONE CONTROL. Without a visible label the pill is a circle holding a glyph; with one
 * it expands and the glyph leads the words. A single padded shape would leave the icon-only form a
 * wide lozenge with a glyph floating in it.
 */
export const MESSAGE_SCROLL_BUTTON_SHAPE = {
  icon: 'w-9 justify-center',
  labelled: 'px-ds-sm',
} as const satisfies Record<PillAxes['shape'][number], string>;

/** The glyph, sized to the pill rather than to the type beside it. */
export const MESSAGE_SCROLL_BUTTON_GLYPH = 'h-4 w-4 shrink-0';

/**
 * The new-message mark. It carries no text at all — a count here would be a number in a language
 * this component does not own, and a translated string leaking into a circle is exactly the
 * clipped-text regression the label-less form is guarded against.
 */
export const MESSAGE_SCROLL_BUTTON_BADGE =
  'absolute -right-ds-5xs -top-ds-5xs h-ds-2xs w-ds-2xs rounded-ds-full bg-default-brand';

/**
 * ── THE LISTEN CONTROL ──
 *
 * The per-message text-to-speech toggle that sits in a turn's action row.
 *
 * IT OWNS NO AUDIO, which is the whole shape. Playback is the host's — a fetch, a cache, a
 * `<audio>`, a speech-synthesis fallback and a rule that only one message speaks at a time — and
 * none of that belongs to a design system. What is left is a control with five drawings and a
 * label, and the two app surfaces had written that control out twice, verbatim, drifting.
 */
/**
 * THE PADDING IS A TARGET SIZE, NOT A LOOK, which is why it is 6 and not the 2 this shipped with.
 *
 * `p-ds-5xs` is 2px and sits one rung from `p-ds-3xs`'s 6 — it is also the row's own GAP token
 * (`MESSAGE_META_STATUS_GROUP`), which is how the wrong one gets reached for. Around a 16px glyph
 * the difference is a 20px box against a 28px one: both live surfaces draw 28 (`p-1.5`), 20 is
 * under WCAG 2.2 AA 2.5.8's 24px minimum, and it would have made this by some distance the
 * smallest interactive control in either chat family — `COMPOSER_BUTTON_BASE` is 32 and
 * `MESSAGE_SCROLL_BUTTON` is 36.
 *
 * NOTHING IN THIS PACKAGE COULD SEE IT. Every class resolved, every purge guard passed, and the
 * control was 29% smaller than the two it de-duplicates. That is the same invisible-geometry class
 * as UMK-978's wrong-hex problem, so it is pinned below rather than trusted to a reader.
 */
export const MESSAGE_TTS_BUTTON = `inline-flex shrink-0 items-center justify-center rounded-ds-sm p-ds-3xs transition-colors disabled:cursor-not-allowed ${FOCUS_RING.control}`;

/**
 * WHAT EACH STATE DRAWS.
 *
 * `idle` alone rests transparent and colours its glyph in the secondary ink; the other four take
 * a weak fill, because a control that is doing something has to be findable in a row of five
 * identical grey glyphs.
 *
 * SUCCESS AND WARNING, NOT TEAL AND ORANGE. Both live surfaces paint this button from Tailwind's
 * ramp — `teal-600` playing, `orange-500` paused — and those are not sayable here: the family's
 * purge guard bans a raw palette step precisely so an app's untokenised chrome cannot be copied
 * into the library. The semantics survive the translation and the hues do not, which is a real
 * difference and is recorded on the contract entry rather than left for a reader to discover in a
 * browser (UMK-978: a class that resolves can still be the wrong colour, and nothing here sees it).
 *
 * `error` has no counterpart on either surface at all — both fall back to the idle drawing when
 * playback fails, so a failure looks exactly like a control nobody has pressed. It is drawn
 * because the host's state machine already has the value.
 */
export const MESSAGE_TTS_STATE = {
  idle: 'text-default-secondary hover:bg-weak-success hover:text-hover-success',
  loading: 'bg-weak-success text-default-success',
  playing: 'bg-weak-success text-default-success',
  paused: 'bg-weak-warning text-default-warning',
  error: 'bg-weak-error text-default-error',
} as const satisfies Record<TtsAxes['state'][number], string>;

/**
 * The glyph, and the spinner that replaces it, sized to the action row rather than to the type.
 *
 * IT IS HALF OF THE TARGET SIZE. The button draws no width of its own — the box is this glyph plus
 * twice the padding above — so shrinking this shrinks the control, which the guard reads both
 * halves of for that reason.
 */
export const MESSAGE_TTS_GLYPH = 'h-4 w-4';
