import type { ViewStyle } from 'react-native';
import { contract } from '../contract';
import { measure, shadowStyle, tokens, type TextColor, type TextRole } from './theme';

/**
 * The chat MESSAGE family's native style tables — the React Native reading of the web's
 * `primitives/message-classes.ts`, one table per web table and under the same name (UMK-1129).
 *
 * THE SAME NAMES ARE THE CHECK. `__tests__/message-parity.test.ts` resolves every web class in
 * those tables through the token groups Tailwind resolves it through and requires the entry here
 * to hold the same value, per axis value. Two independent sources compared, not one table read
 * back against itself — the `button-paint.test.ts` arrangement. A table added here with no web
 * partner, or a web rung repointed with this one left behind, reds there.
 *
 * NO `react-native` VALUE IMPORT, deliberately. Only the `ViewStyle` type, which erases, so the
 * vitest suite can load this module (`react-native`'s entry is Flow and cannot load there) and
 * the parity guard can compare real values instead of scanning text.
 *
 * THERE IS NO PUBLISHED DESIGN. Ensyra publishes no message, bubble or transcript set, so every
 * value is greenfield on the web and this file follows the web; each contract entry records its
 * divergences against that absence. The spacing and radius rungs are the token ladder's own named
 * steps, never a numeric ladder.
 *
 * THE DENSITY PADDING IS TWO TABLES, AS IT IS ON THE WEB, AND THE SPLIT MEANS THE SAME THING HERE.
 * A bubble takes both the inline and the block entry; a ghost bubble keeps the inline one and takes
 * NO block entry, and the name and metadata slots beside it take the inline one alone. That is what
 * lines a non-bubble child's leading edge up with the bubble text above it. The Tailwind mechanics
 * behind the web's split do NOT carry — a React Native style array resolves last-wins, so appending
 * an override would work here — but `bubbleStyle` below still SELECTS rather than appends, so the
 * two platforms express the one rule the same way and a reader moving between them meets one shape.
 *
 * TYPE STEPS FOLLOW THE MOBILE-TABLE RULE (`native-design-system.md`): a web class maps to the
 * mobile role at the same PIXEL size, not the same role name. The bubble's 14/20 is `paragraph`;
 * the name, the metadata and the pill's 12/16 is `bodyLg` (12/18 on the mobile scale — the nearest
 * published step, two pixels more leading).
 */

type MessageAxes = typeof contract.ChatMessage.axes;
type Density = MessageAxes['density'][number];
type Sender = MessageAxes['sender'][number];
type BubbleAxes = typeof contract.ChatMessageBubble.axes;
type MetaAxes = typeof contract.ChatMessageMetadata.axes;
type ListAxes = typeof contract.ChatMessageList.axes;
type PillAxes = typeof contract.ChatScrollButton.axes;

const s = tokens.spacing;
const r = tokens.radius;

/* ---------------------------------------------------------------- the message row */

/**
 * The row is ONE column, and the speaker is a header above the turn. `minWidth: 0` for the web's
 * reason: an unbroken string must wrap inside the row, never widen it.
 */
export const MESSAGE_ROOT = { flexDirection: 'column', width: '100%', minWidth: 0 } as const satisfies ViewStyle;

/** The author header — the avatar and the name on one line, above the turn. */
export const MESSAGE_AUTHOR = { flexDirection: 'row', alignItems: 'center', gap: s['3xs'] } as const satisfies ViewStyle;

/** The avatar slot. It does not shrink, so a long name cannot squeeze the face to nothing. */
export const MESSAGE_AVATAR = { flexShrink: 0 } as const satisfies ViewStyle;

/** Which edge the column's children hug, per sender. The whole of the user-side flip. */
export const MESSAGE_CONTENT_ALIGN = {
  assistant: 'flex-start',
  user: 'flex-end',
  system: 'center',
} as const satisfies Record<Sender, ViewStyle['alignItems']>;

/** The gap INSIDE one message, per density — see the web table for why it is not a constant. */
export const MESSAGE_CONTENT_GAP = {
  compact: s['2xs'],
  balanced: s.sm,
  spacious: s.md,
} as const satisfies Record<Density, number>;

/**
 * The slot pulls: negative margins that take back most of the column gap between a slot and the
 * bubble it belongs to. MOST, NOT ALL — the sliver left is what makes the three read as one message.
 */
export const MESSAGE_AUTHOR_PULL = {
  compact: -s['4xs'],
  balanced: -s['3xs'],
  spacious: -s['2xs'],
} as const satisfies Record<Density, number>;

export const MESSAGE_META_PULL = {
  compact: -s['4xs'],
  balanced: -s['3xs'],
  spacious: -s['2xs'],
} as const satisfies Record<Density, number>;

/** The name slot's type, in the row's quiet tone. */
export const MESSAGE_NAME = { role: 'bodyLg', color: 'secondary' } as const satisfies { role: TextRole; color: TextColor };

/* ---------------------------------------------------------------- density */

/** THE INLINE HALF — the bubble's side padding, and the inset a ghost bubble and both slots keep. */
export const MESSAGE_INSET = {
  compact: s.sm,
  balanced: s.md,
  spacious: s.lg,
} as const satisfies Record<Density, number>;

/** THE BLOCK HALF — the bubble's own vertical padding, and the only half a ghost drops. */
export const MESSAGE_BLOCK = {
  compact: s['2xs'],
  balanced: s.sm,
  spacious: s.md,
} as const satisfies Record<Density, number>;

/* ---------------------------------------------------------------- the bubble */

/** The bubble's shape, minus its fill. */
export const MESSAGE_BUBBLE_BASE = { minWidth: 0, borderRadius: r.xl } as const satisfies ViewStyle;

/** The bubble's type step. */
export const MESSAGE_BUBBLE_TYPE = 'paragraph' as const satisfies TextRole;

/**
 * THE FILL AND THE INK, PER SENDER. The two voices hold the same fill on purpose — the web table's
 * note says why they stay two rows — and every row takes the BODY ink, never the callout's paired
 * prose blue, which is the defect the web table records correcting.
 */
export const MESSAGE_BUBBLE_SENDER = {
  assistant: { backgroundColor: tokens.callout.default.surface, ink: 'primary' },
  user: { backgroundColor: tokens.callout.default.surface, ink: 'primary' },
  system: { backgroundColor: tokens.surface.default.secondary, ink: 'primary' },
} as const satisfies Record<Sender, { backgroundColor: string; ink: TextColor }>;

/** GHOST: no fill. The block padding goes by not being selected; the inline padding stays. */
export const MESSAGE_BUBBLE_GHOST = { backgroundColor: 'transparent' } as const satisfies ViewStyle;

/**
 * The width override. `full` clears the cap in the same entry AND opts out of the column's
 * cross-axis alignment — a child asking for the whole width is otherwise laid out at its own size.
 */
export const MESSAGE_BUBBLE_WIDTH = {
  auto: { maxWidth: '85%' },
  full: { width: '100%', alignSelf: 'stretch' },
} as const satisfies Record<BubbleAxes['width'][number], ViewStyle>;

/**
 * GROUPED RADII, IN LOGICAL CORNERS. React Native's `Start`/`End` corners flip under a
 * right-to-left layout exactly as the web's `start`/`end` do, so a right-to-left reader gets the
 * tuck on the side the message is actually on. Physical corners would put every user bubble's tuck
 * on the wrong side there with nothing able to see it.
 */
export const MESSAGE_GROUP_START = {
  none: {},
  first: { borderBottomStartRadius: r.xs },
  middle: { borderTopStartRadius: r.xs, borderBottomStartRadius: r.xs },
  last: { borderTopStartRadius: r.xs },
} as const satisfies Record<BubbleAxes['group'][number], ViewStyle>;

export const MESSAGE_GROUP_END = {
  none: {},
  first: { borderBottomEndRadius: r.xs },
  middle: { borderTopEndRadius: r.xs, borderBottomEndRadius: r.xs },
  last: { borderTopEndRadius: r.xs },
} as const satisfies Record<BubbleAxes['group'][number], ViewStyle>;

/**
 * THE ONE PLACE A BUBBLE'S AXES BECOME A STYLE, so the ghost rule is a function a test can call
 * rather than a branch it has to find in JSX.
 *
 * The ghost arm SELECTS: it takes the transparent fill INSTEAD OF the sender fill and the block
 * padding, never after them. The user side tucks toward the inline END, the other two toward the
 * inline START.
 */
export const bubbleStyle = ({
  sender,
  density,
  ghost,
  group,
  width,
}: {
  sender: Sender;
  density: Density;
  ghost: boolean;
  group: BubbleAxes['group'][number];
  width: BubbleAxes['width'][number];
}): ViewStyle => ({
  ...MESSAGE_BUBBLE_BASE,
  paddingHorizontal: MESSAGE_INSET[density],
  ...(ghost
    ? MESSAGE_BUBBLE_GHOST
    : { paddingVertical: MESSAGE_BLOCK[density], backgroundColor: MESSAGE_BUBBLE_SENDER[sender].backgroundColor }),
  ...(sender === 'user' ? MESSAGE_GROUP_END : MESSAGE_GROUP_START)[group],
  ...MESSAGE_BUBBLE_WIDTH[width],
});

/* ---------------------------------------------------------------- metadata */

/** The metadata row. Direction comes from the table below; the authored order never changes. */
export const MESSAGE_META_ROOT = { alignItems: 'center', gap: s['4xs'] } as const satisfies ViewStyle;

/** The metadata's type, in the row's quiet tone. */
export const MESSAGE_META_TYPE = { role: 'bodyLg', color: 'secondary' } as const satisfies { role: TextRole; color: TextColor };

/**
 * THE REVERSAL IS THE FLEX DIRECTION ALONE: the authored order stays timestamp, footer, status, so
 * what assistive technology receives is the same sentence on both sides of the transcript.
 */
export const MESSAGE_META_DIRECTION = {
  assistant: 'row',
  user: 'row-reverse',
  system: 'row',
} as const satisfies Record<Sender, ViewStyle['flexDirection']>;

/** The dot between two present pieces — punctuation, not content. */
export const MESSAGE_META_SEPARATOR = 'disable' as const satisfies TextColor;

/**
 * DELIVERY STATUS: five values, and only two of them draw anything of their own. `error` changes
 * the ink; `sending` pulses (and stops pulsing under reduced motion); the three settled states stay
 * on the row's quiet tone because a delivered message is not news.
 */
export const MESSAGE_META_STATUS = {
  sending: { ink: 'secondary', pulse: true },
  sent: { ink: 'secondary', pulse: false },
  delivered: { ink: 'secondary', pulse: false },
  read: { ink: 'secondary', pulse: false },
  error: { ink: 'error', pulse: false },
} as const satisfies Record<MetaAxes['status'][number], { ink: TextColor; pulse: boolean }>;

/**
 * The status glyph. `xs` — 12, the row's own type size.
 *
 * THE WEB DRAWS 14 and native cannot say it: `Icon`'s size axis is closed at 12/16/20/24/32 and
 * the measurement ladder publishes no 14. The web's reason for its size is "smaller than a word, so
 * it reads as a mark"; on the mobile scale the row's type is 12, so the nearest rung that still
 * reads as a mark rather than a word is 12. Recorded here rather than faked with a raw 14.
 */
export const MESSAGE_META_GLYPH = 'xs' as const;

/** The status group: glyph beside its label, never wrapping between the two. */
export const MESSAGE_META_STATUS_GROUP = {
  flexDirection: 'row',
  flexShrink: 0,
  alignItems: 'center',
  gap: s['5xs'],
} as const satisfies ViewStyle;

/* ---------------------------------------------------------------- the list */

/** The list's padding per density. Its gap is a separate table, for the web's reason. */
export const MESSAGE_LIST_PAD = {
  compact: s.sm,
  balanced: s.lg,
  spacious: s.xl,
} as const satisfies Record<Density, number>;

/** The gap between WHOLE messages; each rung clears its `MESSAGE_CONTENT_GAP` counterpart. */
export const MESSAGE_LIST_DENSITY_GAP = {
  compact: s.sm,
  balanced: s.lg,
  spacious: s['2xl'],
} as const satisfies Record<Density, number>;

/** The gap override, on the ladder's own named rungs. It replaces the gap and leaves the padding. */
export const MESSAGE_LIST_GAP = {
  none: s.null,
  '2xs': s['2xs'],
  xs: s.xs,
  sm: s.sm,
  md: s.md,
  lg: s.lg,
} as const satisfies Record<ListAxes['gap'][number], number>;

/**
 * Where a SHORT conversation sits. On the web this is a grown spacer element; a platform list has
 * no children of its own to put one among, so the content container grows to the viewport and
 * justifies to the end instead. Once the content overflows the two alignments are identical.
 */
export const MESSAGE_LIST_ALIGN = {
  top: 'flex-start',
  bottom: 'flex-end',
} as const satisfies Record<ListAxes['align'][number], ViewStyle['justifyContent']>;

/** What the region shows when it holds nothing: centred in the free space. */
export const MESSAGE_LIST_EMPTY = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  gap: s['2xs'],
} as const satisfies ViewStyle;

/** The empty state's type: the bubble's step, in the quiet tone. */
export const MESSAGE_LIST_EMPTY_TYPE = { role: 'paragraph', color: 'secondary' } as const satisfies { role: TextRole; color: TextColor };

/** The pending row the load-older action shows while it is unresolved. */
export const MESSAGE_LIST_PENDING = {
  width: '100%',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: s['2xs'],
} as const satisfies ViewStyle;

/* ---------------------------------------------------------------- the frame and the pill */

/** The transcript frame: the positioning context the pill is pinned inside. */
export const MESSAGE_THREAD_ROOT = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  width: '100%',
} as const satisfies ViewStyle;

/**
 * Where the pill sits. `box-none`: the strip across the transcript's foot takes no touch of its
 * own, so it does not swallow a tap meant for the last message, while the pill inside it does.
 */
export const MESSAGE_THREAD_PILL_SLOT = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: s.md,
  alignItems: 'center',
  pointerEvents: 'box-none',
} as const satisfies ViewStyle;

/**
 * The pill, resting and pressed. `pressed` stands where the web has `hover`, the rule every
 * native sibling follows (`Button`, `Menu`).
 *
 * THE ELEVATION IS THE `10Pct` TOKEN, where the web writes Tailwind's own `shadow-md`, which is no
 * token at all. The web's recorded reason for its step is visibility — a near-white circle on a
 * near-white transcript at the small step is present and invisible — and `10Pct` is the published
 * shadow closest to that step, the same one `Dialog`'s panel reads.
 */
export const MESSAGE_SCROLL_BUTTON = {
  position: 'relative',
  flexDirection: 'row',
  flexShrink: 0,
  alignItems: 'center',
  height: measure['2-25'],
  gap: s['4xs'],
  borderRadius: r.full,
  borderWidth: tokens.borderWidth.sm,
  borderColor: tokens.border.default.primary,
  ...shadowStyle(tokens.shadow['10Pct']),
} as const satisfies ViewStyle;

export const MESSAGE_SCROLL_BUTTON_FILL = {
  rest: tokens.surface.default.primary,
  pressed: tokens.surface.hoverNeutral,
} as const;

/** The pill's type and ink. */
export const MESSAGE_SCROLL_BUTTON_TYPE = { role: 'bodyLg', color: 'primary' } as const satisfies { role: TextRole; color: TextColor };

/**
 * TWO SHAPES, ONE CONTROL. Without a visible label the pill is a circle holding a glyph; with one
 * it expands and the glyph leads the words.
 */
export const MESSAGE_SCROLL_BUTTON_SHAPE = {
  icon: { width: measure['2-25'], justifyContent: 'center' },
  labelled: { paddingHorizontal: s.sm },
} as const satisfies Record<PillAxes['shape'][number], ViewStyle>;

/**
 * The pill's TOUCH target, grown past its drawn 36 by `hitSlop` so the circle stays the web's size.
 * 48 — Android's minimum, and past iOS's 44 — is a measurement rung, and the slop is half the
 * difference on each side — `measure['2-25']` is the pill's drawn height above.
 */
export const MESSAGE_SCROLL_BUTTON_TARGET = measure['3'];
export const MESSAGE_SCROLL_BUTTON_HIT_SLOP = (MESSAGE_SCROLL_BUTTON_TARGET - measure['2-25']) / 2;

/** The glyph: 16, sized to the pill rather than to the type beside it. */
export const MESSAGE_SCROLL_BUTTON_GLYPH = { size: 'sm', color: 'primary' } as const satisfies {
  size: 'sm';
  color: TextColor;
};

/** The new-message mark. It carries no text — see the contract entry's divergence. */
export const MESSAGE_SCROLL_BUTTON_BADGE = {
  position: 'absolute',
  right: -s['5xs'],
  top: -s['5xs'],
  width: s['2xs'],
  height: s['2xs'],
  borderRadius: r.full,
  backgroundColor: tokens.surface.default.brand,
} as const satisfies ViewStyle;
