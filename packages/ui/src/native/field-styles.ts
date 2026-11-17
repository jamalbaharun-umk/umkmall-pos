import type { TextStyle, ViewStyle } from 'react-native';
import { measure, tokens, type TextColor, type TextRole } from './theme';

/**
 * The style tables the form controls share — the native reading of
 * `primitives/field-classes.ts`, value for value.
 *
 * Same siting rule: not in `theme.ts`, which is the token bridge, and not in `contract/`,
 * which may not name a platform value at all. One file so a token change is a one-file
 * edit, and so `TextField` cannot drift from the box `DateTimeInput` will one day share.
 */

/** The text-shaped box. Sizes carry the type role the control reads its input in. */
export const BOX_SIZE = {
  large: {
    gap: tokens.spacing['2xs'],
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.lg,
    role: 'paragraph' as TextRole,
  },
  small: {
    gap: tokens.spacing['3xs'],
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing['2xs'],
    borderRadius: tokens.radius.md,
    role: 'bodyLg' as TextRole,
  },
} as const;

/** `TextField`'s `compact` rung (UMK-1548), ours: 14px type, 10 / 12 padding, r12. Kept out of `BOX_SIZE`, which `DateTimeInput` and `Select` share. */
export const BOX_SIZE_COMPACT = {
  gap: tokens.spacing['3xs'],
  paddingHorizontal: tokens.spacing.sm,
  paddingVertical: tokens.spacing.xs,
  borderRadius: tokens.radius.lg,
  role: 'paragraph' as TextRole,
} as const;

/** The compact box's rest borders: the n40 ink (`border.default.invert`); error and disabled keep theirs. */
export const BOX_STATE_COMPACT = {
  default: { borderColor: tokens.border.default.invert },
  filled: { borderColor: tokens.border.default.invert },
} as const satisfies Record<string, ViewStyle>;

/** The compact box's height: a 44 floor on one line (sizing `2-75`), a 24 line (line-height `md`) on several. */
export const BOX_HEIGHT_COMPACT = { single: { minHeight: measure['2-75'] }, multilineLineHeight: tokens.font.lineHeight.md } as const;

/** The compact field's stack gap (4) and caption ink: muted, UMK-1548. */
export const FIELD_STACK_COMPACT = { gap: tokens.spacing['4xs'] } as const satisfies ViewStyle;

/** Mutually exclusive; the component picks exactly one. "filled" is derived from the value. */
export const BOX_STATE = {
  default: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.primary },
  filled: { borderColor: tokens.border.default.invert, backgroundColor: tokens.surface.default.primary },
  error: { borderColor: tokens.border.default.error, backgroundColor: tokens.surface.default.primary },
  disabled: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.secondary },
} as const satisfies Record<string, ViewStyle>;

/**
 * The focus pair, contained here the way `utils/focus-ring-classes.ts` contains it on the
 * web — which is what made UMK-872's rename a one-line change on each platform when it
 * landed (UMK-978). The strong stop is the published `border.focus.brand`; the pale one is
 * the overlay's `focus.halo`, which Ensyra publishes under no name at all.
 *
 * On the web the ring is a box-shadow. Here it is an outer View 2 wide that is transparent
 * until focus, so the box does not shift when the ring appears.
 */
export const FOCUS_RING = {
  border: tokens.border.focus.brand,
  ring: tokens.focus.halo,
  ringWidth: 2,
} as const;

/**
 * The tick/dot box: `CheckBox` and `Radio`. Figma's scale — Large 18, Medium 16, Small 14
 * (`01 Check Box` 121:1457) — with `xlarge` at 20 as our own rung above it, exactly as the
 * two web tables spell it. Three tables, no compile-time link (UMK-1091 KTD4).
 *
 * TWO RAW NUMBERS in a table that otherwise names only tokens. The measurement ladder runs
 * 16, 20, 22, 24, 26, 28 — it publishes no 18 and no 14, so there is no token to name for
 * Large or Small. Written as literals rather than rounded to a rung that exists, because the
 * wrong size is a worse answer than an unnamed one; design owes us `1-125` and `0-875`, and
 * this comment is the record of the ask.
 */
export const CONTROL_SIZE = {
  xlarge: measure['1-25'],
  large: 18,
  medium: measure['1'],
  small: 14,
} as const;

/**
 * The slider's track height and thumb diameter per size, from Figma `Slider` 1308:8026 —
 * Large a 12px track under a 20px thumb, Small an 8px track under an 18px one — the native
 * reading of the web's `SIZE` table in `primitives/Slider/Slider.tsx` (UMK-1091 R8). The
 * tracks already matched; both thumbs moved, from a 24px and a 16px dot.
 *
 * ONE RAW NUMBER, for the same reason `CONTROL_SIZE` carries two: the ladder publishes no 18.
 */
export const SLIDER_SIZE = {
  large: { track: measure['0-75'], thumb: measure['1-25'] },
  small: { track: measure['0-5'], thumb: 18 },
} as const;

/**
 * THE THUMB IS A RING, not a dot: a white disc with a 6px brand stroke (`Slider` 1308:8026).
 * The web names the same two tokens and the same width on both vendor pseudo-elements (its
 * class names are not spelled here: `inline-classes.purge.test.ts` counts a class written in
 * a comment as a live one). RN's border sits INSIDE the view's box, as the web's box-sizing rule
 * sizing does, so the diameter above is the outer one on both surfaces.
 */
export const SLIDER_THUMB = {
  backgroundColor: tokens.surface.default.primary,
  borderColor: tokens.border.default.brand,
  borderWidth: 6,
} as const satisfies ViewStyle;

export const CONTROL_BOX = {
  borderWidth: 2,
  borderColor: tokens.border.default.invert,
  backgroundColor: tokens.surface.default.primary,
} as const satisfies ViewStyle;

export const CONTROL_BOX_CHECKED = {
  borderColor: tokens.border.default.brand,
  backgroundColor: tokens.surface.default.brand,
} as const satisfies ViewStyle;

export const CONTROL_BOX_PRESSED = { borderColor: tokens.border.default.brand } as const satisfies ViewStyle;

/**
 * TWO disabled arms, because a lock must not erase a selection (UMK-1091).
 *
 * RN resolves a style array by last-wins, and the disabled entry sits last — so one arm
 * repainted a checked or indeterminate box as empty, and the control told the user the
 * opposite of its own state. The consumer picks the arm from the same condition it already
 * uses to decide whether to paint the glyph at all, so the fill and the tick cannot disagree.
 *
 * The web sibling expresses this as `disabled:checked:` / `disabled:indeterminate:` on one
 * class string. Different spelling, same two cases; neither surface's suite can see the
 * other's, which is why they move together.
 */
export const CONTROL_BOX_DISABLED = {
  borderColor: tokens.border.default.primary,
  backgroundColor: tokens.surface.default.secondary,
} as const satisfies ViewStyle;

export const CONTROL_BOX_DISABLED_CHECKED = {
  borderColor: tokens.border.disable.brand,
  backgroundColor: tokens.surface.disable.brand,
} as const satisfies ViewStyle;

export const CONTROL_BOX_ERROR = { borderColor: tokens.border.default.error } as const satisfies ViewStyle;

export const CONTROL_ROW = {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

/** The shared label line: every control renders its own, per the recorded divergence. */
export const CONTROL_LABEL = { role: 'paragraph', weight: 'regular' } as const;
export const FIELD_LABEL = { role: 'bodyLg', weight: 'medium' } as const;

export const FIELD_STACK = { gap: tokens.spacing['3xs'] } as const satisfies ViewStyle;

/** The input's own text colour per state; the box colours ride `BOX_STATE`. */
export const BOX_INK = {
  default: tokens.text.default.primary,
  disabled: tokens.text.disable.primary,
  placeholder: tokens.text.default.secondary,
} as const satisfies Record<string, TextStyle['color']>;

/**
 * The character counter under the box — the native reading of `FIELD_COUNTER` and
 * `FIELD_COUNTER_LIMIT`.
 *
 * `alignSelf: 'flex-end'` is the web's `self-end`, and the at-limit colour is a SEPARATE
 * entry rather than a modifier for the same reason it is on the web: two values a reader can
 * see side by side, not one with a condition buried in it.
 */
export const FIELD_COUNTER = {
  default: { alignSelf: 'flex-end', color: tokens.text.default.secondary },
  limit: { alignSelf: 'flex-end', color: tokens.text.default.error },
} as const satisfies Record<string, TextStyle>;

/**
 * THE SELECTABLE OPTION CARD — the native reading of `SELECTION_CARD_*`.
 *
 * The web hides a REAL radio or checkbox inside the label and lets the platform supply the
 * group role, the roving focus, the arrow keys and the selected state. React Native has no
 * such control to hide: there is no native radio, and `sr-only` has no equivalent. So the
 * card IS the control here — a `Pressable` carrying `radio`/`checkbox` and its own
 * `accessibilityState.checked`, which is the platform channel for exactly that.
 *
 * That is a construction divergence, not a behaviour one: selection still reaches assistive
 * technology through the control's state rather than through the card's colour, which is the
 * guarantee the web docblock is actually making.
 */
export const SELECTION_CARD_ROW = { alignSelf: 'stretch', gap: tokens.spacing['2xs'] } as const satisfies ViewStyle;

export const SELECTION_CARD_BASE = {
  flexDirection: 'row',
  alignItems: 'flex-start',
  borderWidth: 1,
  backgroundColor: tokens.surface.default.primary,
} as const satisfies ViewStyle;

export const SELECTION_CARD_SIZE = {
  large: { gap: tokens.spacing['2xs'], paddingHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing.sm, borderRadius: tokens.radius.lg },
  small: { gap: tokens.spacing['3xs'], paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing['2xs'], borderRadius: tokens.radius.md },
} as const satisfies Record<string, ViewStyle>;

export const SELECTION_CARD_STATE = {
  default: { borderColor: tokens.border.default.primary },
  selected: { borderColor: tokens.border.default.brand, backgroundColor: tokens.surface.weak.brand },
  disabled: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.secondary },
} as const satisfies Record<string, ViewStyle>;

/**
 * THE LAYOUT AXIS (UMK-1218) — the native reading of the web's `SELECTION_CARD_LAYOUT`. `tile` is a
 * centred stack with the control drawn in the top-right corner (Teman AI Page mobile coin cards
 * 14275:102539): 2px border in every state, 24 top / 12 sides and bottom, 6 between the icon and
 * the heading. `row` adds nothing.
 */
export const SELECTION_CARD_LAYOUT = {
  row: {},
  tile: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    gap: tokens.spacing['3xs'],
    paddingHorizontal: tokens.spacing.sm,
    paddingBottom: tokens.spacing.sm,
    paddingTop: tokens.spacing.xl,
  },
} as const satisfies Record<string, ViewStyle>;

/** The tile's text column: centred, 20 between the heading and the body. */
export const SELECTION_CARD_TILE_TEXT = { alignItems: 'center', gap: tokens.spacing.lg } as const satisfies ViewStyle;

/** A tile's own texts are centred, as the web's `text-center` centres them (a caller's label node aligns itself). */
export const SELECTION_CARD_TILE_TEXT_ALIGN = { textAlign: 'center' } as const satisfies TextStyle;

/** A tile's badge straddles its top edge, centred. */
export const SELECTION_CARD_TILE_BADGE = {
  position: 'absolute',
  top: -12,
  left: 0,
  right: 0,
  alignItems: 'center',
} as const satisfies ViewStyle;

/** The tile's corner control: an 18px ring, 8px in from the top and right. */
export const SELECTION_CARD_INDICATOR = {
  position: 'absolute',
  top: tokens.spacing['2xs'],
  right: tokens.spacing['2xs'],
  width: 18,
  height: 18,
  borderWidth: 1,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: tokens.surface.default.primary,
} as const satisfies ViewStyle;

export const SELECTION_CARD_INDICATOR_SHAPE = {
  radio: { borderRadius: tokens.radius.full },
  checkbox: { borderRadius: tokens.radius.xs },
} as const satisfies Record<string, ViewStyle>;

export const SELECTION_CARD_INDICATOR_STATE = {
  default: { borderColor: tokens.border.default.invert },
  selected: { borderColor: tokens.border.default.invert },
  disabled: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.secondary },
} as const satisfies Record<string, ViewStyle>;

/** The brand dot (radio) or square (checkbox) inside a selected indicator. */
export const SELECTION_CARD_INDICATOR_MARK = {
  width: 12,
  height: 12,
  backgroundColor: tokens.surface.default.brand,
} as const satisfies ViewStyle;

/** The ink each state gives the card's text; `disabled` is the only one that changes it. */
export const SELECTION_CARD_INK = {
  default: { heading: 'primary', body: 'secondary' },
  selected: { heading: 'primary', body: 'secondary' },
  disabled: { heading: 'disable', body: 'disable' },
} as const satisfies Record<string, Record<string, TextColor>>;

/**
 * THE SELECT TRIGGER AND ITS LIST — the native reading of `SELECT_*`.
 *
 * The trigger reuses the TEXT FIELD's box (`BOX_SIZE` / `BOX_STATE`), because on both
 * platforms a select is a field: same height, same border, same states. What differs is what
 * opens — a portalled list on the web, a bottom sheet here — and that lives in the component.
 */
export const SELECT_OPTION = {
  default: {},
  active: { backgroundColor: tokens.surface.weak.brand },
} as const satisfies Record<string, ViewStyle>;

export const SELECT_OPTION_ROW = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing['2xs'],
  paddingHorizontal: tokens.spacing.sm,
  paddingVertical: tokens.spacing['2xs'],
  borderRadius: tokens.radius.md,
} as const satisfies ViewStyle;

/** The empty and loading bodies — never a blank box. */
export const SELECT_MESSAGE = {
  paddingHorizontal: tokens.spacing.sm,
  paddingVertical: tokens.spacing.sm,
} as const satisfies ViewStyle;

/**
 * THE UPLOAD ZONE — the native reading of `UPLOAD_*`.
 *
 * `borderStyle` is a real React Native property and `dashed` renders, so the `border` axis
 * survives the port intact — which is not something to assume of RN borders generally.
 */
export const UPLOAD_BORDER = {
  solid: { borderStyle: 'solid' },
  dashed: { borderStyle: 'dashed' },
} as const satisfies Record<string, ViewStyle>;

export const UPLOAD_BASE = {
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
} as const satisfies ViewStyle;

export const UPLOAD_SIZE = {
  large: { gap: tokens.spacing['2xs'], paddingHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing.xl, borderRadius: tokens.radius.lg, role: 'paragraph' as TextRole },
  small: { gap: tokens.spacing['3xs'], paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing.sm, borderRadius: tokens.radius.md, role: 'bodyLg' as TextRole },
} as const;

/** `hover:` has no native counterpart, so each status carries only its resting treatment. */
export const UPLOAD_STATUS = {
  default: { borderColor: tokens.border.default.primary, ink: 'secondary' },
  filled: { borderColor: tokens.border.default.invert, ink: 'primary' },
  error: { borderColor: tokens.border.default.error, ink: 'error' },
  disabled: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.secondary, ink: 'disable' },
  busy: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.secondary, ink: 'secondary' },
} as const satisfies Record<string, ViewStyle & { ink: TextColor }>;
