import type { ViewStyle } from 'react-native';
import { measure, shadowStyle, tokens, withAlpha, type TextColor } from './theme';

/**
 * The style tables the chat composer shares — the native reading of
 * `primitives/composer-classes.ts`.
 *
 * THE ACTIVE FILL IS PER BUTTON, and that is the one thing a port must not collapse. Voice
 * active is RED because it is RECORDING; tools and attachment are BLUE because they are ARMED.
 * Reading "active" as one accent colour is exactly the collapse the web's own family guard
 * exists to prevent, and it is the kind of change that looks like a tidy-up.
 */
export const COMPOSER_BUTTON_BASE = {
  width: measure['2'],
  height: measure['2'],
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.full,
  borderWidth: 1,
} as const satisfies ViewStyle;

/**
 * The button's box, per the contract's `size` axis — the web's `COMPOSER_BUTTON_SIZE`.
 * `compact` is the in-chat 32 and repeats the base, so it adds no key; `landing` is the hero
 * composer's 36, the height of the voice bar it swaps with so the row does not jump.
 */
export const COMPOSER_BUTTON_SIZE = {
  compact: {},
  landing: { width: measure['2-25'], height: measure['2-25'] },
} as const satisfies Record<string, ViewStyle>;

/**
 * The corner dot — the web's `COMPOSER_BUTTON_BADGE`. A child of the button, placed past its
 * edge: the button sets no `overflow`, which is what keeps the dot from being clipped.
 */
export const COMPOSER_BUTTON_BADGE = {
  position: 'absolute',
  right: -measure['0-125'],
  top: -measure['0-125'],
  width: measure['0-75'],
  height: measure['0-75'],
  borderRadius: tokens.radius.full,
  borderWidth: 1,
  borderColor: tokens.border.default.primary,
  backgroundColor: tokens.surface.default.error,
} as const satisfies ViewStyle;

/** `send` RESTS FILLED — it is the composer's primary action, not one affordance among four. */
export const COMPOSER_BUTTON_IDLE = {
  tools: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.primary, ink: 'primary' },
  attachment: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.primary, ink: 'primary' },
  voice: { borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.primary, ink: 'primary' },
  send: { borderColor: 'transparent', backgroundColor: tokens.surface.default.brand, ink: 'invert' },
} as const satisfies Record<string, ViewStyle & { ink: TextColor }>;

export const COMPOSER_BUTTON_ACTIVE = {
  /** RED. Recording, not armed — see this file's docblock. */
  voice: { borderColor: 'transparent', backgroundColor: tokens.surface.default.error, ink: 'invert' },
  tools: { borderColor: 'transparent', backgroundColor: tokens.surface.default.brand, ink: 'invert' },
  attachment: { borderColor: 'transparent', backgroundColor: tokens.surface.default.brand, ink: 'invert' },
  send: { borderColor: 'transparent', backgroundColor: tokens.surface.default.brand, ink: 'invert' },
} as const satisfies Record<string, ViewStyle & { ink: TextColor }>;

/**
 * `send` DISABLES TO A FLAT NEUTRAL, not to a fade, and the three others fade.
 *
 * A faded blue circle still reads as blue — as an enabled primary action the user is failing
 * to press. The other three are outline buttons whose fade reads correctly as "off".
 */
export const COMPOSER_BUTTON_DISABLED = {
  tools: { opacity: 0.5 },
  attachment: { opacity: 0.5 },
  voice: { opacity: 0.5 },
  /* `secondary`, not `disable`: the web's disabled send ink is the secondary TEXT token, and
     the icon group's `secondary` carries the same hex where its `disable` is a paler one. */
  send: { borderColor: 'transparent', backgroundColor: tokens.surface.default.secondary, ink: 'secondary' },
} as const satisfies Record<string, ViewStyle & { ink?: TextColor }>;

/**
 * SEND'S OWN STATES over its resting fill — the native reading of the web's
 * `COMPOSER_SEND_STATE`. `stop` interrupts a streaming reply on the ERROR fill, the one the
 * recording mic takes, because both interrupt something already running; `waiting` stays blue
 * and only changes its glyph. A disabled send still goes flat neutral in every state, as on the
 * web, where the `disabled:` classes win over these.
 */
export const COMPOSER_SEND_STATE = {
  send: {},
  stop: { borderColor: 'transparent', backgroundColor: tokens.surface.default.error, ink: 'invert' },
  waiting: {},
} as const satisfies Record<string, ViewStyle & { ink?: TextColor }>;

/** THE ATTACHMENT CHIP — the native reading of the `COMPOSER_ATTACHMENT`/`COMPOSER_FILE_*` set. */
export const COMPOSER_ATTACHMENT = { flexShrink: 0 } as const satisfies ViewStyle;

/**
 * The image box, per the contract's `size` axis — the web's `COMPOSER_PREVIEW_SIZE`. `default`
 * is the published 80; `large` is the 96 the web picker draws, which the measurement ladder has
 * no step for (80, then 84), so it is the 80 step plus the 16 one rather than a typed number.
 * The `tile` treatment and the caption's width read the same table, as on the web.
 */
export const COMPOSER_PREVIEW_SIZE = {
  default: { width: measure['5'], height: measure['5'] },
  large: { width: measure['5'] + measure['1'], height: measure['5'] + measure['1'] },
} as const satisfies Record<string, ViewStyle>;

export const COMPOSER_PREVIEW = {
  overflow: 'hidden',
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.surface.default.secondary,
} as const satisfies ViewStyle;

/**
 * The square non-image TILE — the web's `COMPOSER_FILE_TILE`: a file glyph over the extension,
 * sized by `COMPOSER_PREVIEW_SIZE`.
 */
export const COMPOSER_FILE_TILE = {
  alignItems: 'center',
  justifyContent: 'center',
  gap: tokens.spacing['4xs'],
  borderRadius: tokens.radius.md,
  borderWidth: 2,
  borderColor: tokens.border.default.primary,
  backgroundColor: tokens.surface.default.secondary,
  padding: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

/** The filename under a preview — as wide as the preview, so a long name truncates instead of widening the tile. */
export const COMPOSER_CAPTION = { marginTop: tokens.spacing['3xs'] } as const satisfies ViewStyle;

/**
 * Per-attachment upload status, drawn INSIDE the attachment it belongs to — the web's
 * `COMPOSER_STATUS`. The three veils cover the tile; `done` is a corner badge. Both veil fills
 * are a TOKEN at the alpha the web's opacity modifier gives it — the overlay surface at 40%,
 * the error surface at 60% — never a typed colour. The modifier REPLACES a colour's own alpha
 * rather than multiplying it, so the overlay token's published `99` is dropped for the 40.
 *
 * THE WEB'S CLASS NAMES ARE NOT QUOTED HERE, on purpose: Tailwind scans this file as text, and
 * a class spelled in a comment is compiled and counted (`inline-classes.purge.test.ts` names
 * every file that contributes one).
 * `idle` draws nothing, and is absent rather than an empty entry so nothing can render it.
 */
const COMPOSER_STATUS_VEIL = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  alignItems: 'center',
  justifyContent: 'center',
  gap: tokens.spacing['4xs'],
  borderRadius: tokens.radius.md,
} as const satisfies ViewStyle;

export const COMPOSER_STATUS = {
  uploading: { ...COMPOSER_STATUS_VEIL, backgroundColor: withAlpha(tokens.surface.default.overlay, 40) },
  compressing: { ...COMPOSER_STATUS_VEIL, backgroundColor: withAlpha(tokens.surface.default.overlay, 40) },
  error: { ...COMPOSER_STATUS_VEIL, backgroundColor: withAlpha(tokens.surface.default.error, 60) },
  done: {
    position: 'absolute',
    right: tokens.spacing['4xs'],
    bottom: tokens.spacing['4xs'],
    width: measure['1-25'],
    height: measure['1-25'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.surface.default.success,
  },
} as const satisfies Record<string, ViewStyle>;

/**
 * The remove control sits OUTSIDE the box on both platforms — `-right-2 -top-2` on the web.
 * React Native clips a child that overflows a parent with `overflow: 'hidden'`, so the chip
 * itself must not set it; only the preview box does, and the control is a sibling of that box
 * rather than a child of it.
 */
export const COMPOSER_CLOSE = {
  position: 'absolute',
  right: -tokens.spacing['2xs'],
  top: -tokens.spacing['2xs'],
  width: 22,
  height: 22,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.full,
  borderWidth: 1,
  borderColor: tokens.border.default.primary,
  backgroundColor: tokens.surface.default.primary,
} as const satisfies ViewStyle;

export const COMPOSER_FILE_CHIP = {
  flexDirection: 'row',
  alignItems: 'flex-end',
  gap: tokens.spacing['2xs'],
  borderRadius: tokens.radius.lg,
  borderWidth: 1,
  borderColor: tokens.border.default.primary,
  backgroundColor: tokens.surface.default.primary,
  paddingVertical: tokens.spacing['3xs'],
  paddingLeft: tokens.spacing['3xs'],
  paddingRight: tokens.spacing.md,
} as const satisfies ViewStyle;

export const COMPOSER_FILE_BADGE = {
  width: measure['2-25'],
  height: measure['2-25'],
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.xs,
  backgroundColor: tokens.surface.default.success,
} as const satisfies ViewStyle;

/** THE SHELL — the native reading of `COMPOSER_OUTER` / `COMPOSER_TRAY` / `COMPOSER_BASE`. */
export const COMPOSER_OUTER = { alignSelf: 'stretch' } as const satisfies ViewStyle;

/**
 * THE TRAY carries NO PADDING of its own — it tucks UNDER the box rather than framing it, and
 * whatever room a slot needs is that slot's padding, so a slot that wants to sit flush can.
 * Its radius is the box's, so the two move together.
 */
export const COMPOSER_TRAY = { borderRadius: tokens.radius.xl } as const satisfies ViewStyle;

/**
 * ONE tinted surface, ONE place to tint it. Filling `header` or `footer` turns the outer column
 * into a single tinted panel running behind the white editor box and showing as a margin around
 * it. That costs a composer the ability to say danger at the top and warning at the bottom, and
 * that is the trade: two tints on one panel is the doubling this shape was corrected out of.
 */
export const COMPOSER_TRAY_TONE = {
  neutral: { backgroundColor: tokens.surface.default.secondary, ink: 'primary' },
  info: { backgroundColor: tokens.callout.default.surface, ink: 'primary' },
  warning: { backgroundColor: tokens.callout.warn.surface, ink: 'primary' },
  danger: { backgroundColor: tokens.callout.neg.surface, ink: 'primary' },
} as const satisfies Record<string, ViewStyle & { ink: TextColor }>;

export const COMPOSER_BASE = {
  alignSelf: 'stretch',
  borderWidth: 1,
  borderColor: tokens.border.default.primary,
  backgroundColor: tokens.surface.default.primary,
  borderRadius: tokens.radius.xl,
  padding: tokens.spacing.md,
  gap: tokens.spacing.lg,
} as const satisfies ViewStyle;

/**
 * The hero's lift — the web's `COMPOSER_RAISED` (UMK-1041). The web writes Tailwind's own
 * `shadow-xl`, which is no token; `10Pct` is the largest shadow the tokens publish and the one
 * `Dialog`'s panel and the scroll pill already read. The resting box carries NO shadow here,
 * where the web's carries `shadow-sm` — a difference this file had before `raised` existed.
 */
export const COMPOSER_RAISED = shadowStyle(tokens.shadow['10Pct']);

export const COMPOSER_ROW = {
  flexDirection: 'row',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

export const COMPOSER_GROUP = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing['2xs'],
} as const satisfies ViewStyle;

/** THE DRAWER — a transparent ROW inside the tray, OUTSIDE the bordered box. */
export const COMPOSER_DRAWER = {
  alignSelf: 'stretch',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: tokens.spacing.sm,
  borderRadius: tokens.radius.xl,
  padding: tokens.spacing.sm,
} as const satisfies ViewStyle;

/**
 * `inherit` PAINTS NOTHING and is the default. The four fills exist only for a drawer used
 * OUTSIDE a composer, where nothing supplies a surface — drawing a filled drawer inside a
 * filled tray is the doubling this vocabulary was corrected out of.
 */
export const COMPOSER_DRAWER_VARIANT = {
  inherit: {},
  neutral: { borderWidth: 1, borderColor: tokens.border.default.primary, backgroundColor: tokens.surface.default.secondary },
  info: { borderWidth: 1, borderColor: tokens.callout.default.border, backgroundColor: tokens.callout.default.surface },
  warning: { borderWidth: 1, borderColor: tokens.callout.warn.border, backgroundColor: tokens.callout.warn.surface },
  danger: { borderWidth: 1, borderColor: tokens.callout.neg.border, backgroundColor: tokens.callout.neg.surface },
} as const satisfies Record<string, ViewStyle>;

export const COMPOSER_DRAWER_TOGGLE = {
  alignSelf: 'stretch',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.md,
  paddingVertical: tokens.spacing['5xs'],
} as const satisfies ViewStyle;

export const COMPOSER_DRAWER_HANDLE = {
  height: 3,
  width: measure['1-5'],
  borderRadius: tokens.radius.full,
  backgroundColor: tokens.border.default.invert,
} as const satisfies ViewStyle;

export const COMPOSER_DRAWER_SUMMARY = {
  alignSelf: 'stretch',
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing.sm,
} as const satisfies ViewStyle;

export const COMPOSER_DRAWER_DISMISS = {
  marginLeft: 'auto',
  width: measure['1-25'],
  height: measure['1-25'],
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.full,
} as const satisfies ViewStyle;

export const COMPOSER_EDITOR_BOX = { alignSelf: 'stretch' } as const satisfies ViewStyle;
export const COMPOSER_EDITOR_AFFORDANCE = { position: 'absolute', right: 0, top: 0 } as const satisfies ViewStyle;
