import type { ViewStyle } from 'react-native';
import type { IconName } from './icon-registry';
import type { IconSize } from './Icon';
import type { AlertSize } from './Alert';
import { measure, tokens, type TextColor, type TextRole } from './theme';

/**
 * The style tables the feedback surfaces share — the native reading of
 * `primitives/feedback-classes.ts`. Every value there was read off Ensyra — DS (component
 * set `Alerts & Toast`, 191:1745); what is written here is the same token, not a
 * re-reading of the design.
 *
 * `Alert` and the `Toaster` are ONE visual — a toast is an `Alert` with `type="toast"` —
 * so their tables live together rather than being two lists that agree until they do not.
 */

/** Figma draws NO stroke on an alert — the tint alone carries it, and a toast is a solid fill. */
export const ALERT_BASE = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: tokens.spacing['2xs'],
  borderRadius: tokens.radius.md,
} as const satisfies ViewStyle;

/**
 * Padding, type role and glyph size per size. The web's `large` reads the DESKTOP paragraph
 * (16px); the mobile role at 16px is `h6`, and the rule everywhere in these tables is "the
 * mobile role with the same pixel size", not "the same role name".
 */
export const ALERT_SIZE = {
  large: { paddingHorizontal: tokens.spacing.md, paddingVertical: tokens.spacing.xs, role: 'h6' as TextRole, glyph: 'xl' as IconSize },
  medium: { paddingHorizontal: tokens.spacing.sm, paddingVertical: tokens.spacing['2xs'], role: 'paragraph' as TextRole, glyph: 'lg' as IconSize },
  small: { paddingHorizontal: tokens.spacing['2xs'], paddingVertical: tokens.spacing['2xs'], role: 'bodyLg' as TextRole, glyph: 'md' as IconSize },
} as const;

/** `type` is a real visual fork: an alert is a 10% tint of its function, a toast the solid colour. */
export const ALERT_SURFACE = {
  alert: {
    success: tokens.surface.weak.success,
    info: tokens.surface.weak.brand,
    warning: tokens.surface.weak.warning,
    danger: tokens.surface.weak.error,
  },
  toast: {
    success: tokens.surface.default.success,
    info: tokens.surface.default.brand,
    warning: tokens.surface.default.warning,
    danger: tokens.surface.default.error,
  },
} as const;

/**
 * Warning is the odd one out on both toast tables, and deliberately: the amber is light
 * enough that white copy fails contrast on it, so Figma draws that variant with the primary
 * ink. Do not "regularise" these to `invert`.
 */
export const ALERT_INK = {
  alert: { success: 'primary', info: 'primary', warning: 'primary', danger: 'primary' },
  toast: { success: 'invert', info: 'invert', warning: 'primary', danger: 'invert' },
} as const satisfies Record<string, Record<string, TextColor>>;

/** The glyph takes the function colour on an alert and the ink colour on a toast. */
export const ALERT_GLYPH_INK = {
  alert: { success: 'success', info: 'brand', warning: 'warning', danger: 'error' },
  toast: { success: 'invert', info: 'invert', warning: 'primary', danger: 'invert' },
} as const satisfies Record<string, Record<string, TextColor>>;

/**
 * THE TREATMENT AXIS — the native reading of `ALERT_TREATMENT`.
 *
 * `full` IS ABSENT FROM THIS TABLE ON PURPOSE, and that is the same guarantee the web makes
 * by deriving its `full` arm from the two tables above: an alert with no treatment must
 * render byte-identically to one from before the axis existed. Here that is expressed by
 * the component not consulting this table at all when `treatment` is `full`, which is a
 * stronger version of the same promise — there is no second copy of those values to drift.
 *
 * Every value is read off the published `callout` token group, whose keys are the app
 * callout's own variants. `good` and `coach` are two different greens, not a duplicate, and
 * `success` reaches for a different one in each arm.
 */
export const ALERT_TREATMENT = {
  accent: {
    success: { bg: tokens.callout.good.surface, edge: tokens.callout.good.border, ink: tokens.callout.good.text },
    info: { bg: tokens.callout.default.surface, edge: tokens.callout.default.border, ink: tokens.callout.default.text },
    warning: { bg: tokens.callout.warn.surface, edge: tokens.callout.warn.border, ink: tokens.callout.warn.text },
    danger: { bg: tokens.callout.neg.surface, edge: tokens.callout.neg.border, ink: tokens.callout.neg.text },
  },
  coach: {
    success: { bg: tokens.callout.coach.surface, edge: tokens.callout.coach.border, ink: tokens.callout.coach.text },
    info: { bg: tokens.callout.default.surface, edge: tokens.callout.default.border, ink: tokens.callout.default.text },
    warning: { bg: tokens.callout.warn.surface, edge: tokens.callout.warn.border, ink: tokens.callout.warn.text },
    danger: { bg: tokens.callout.neg.surface, edge: tokens.callout.neg.border, ink: tokens.callout.neg.text },
  },
  /**
   * `banner` DEGRADES TO ITS FIRST STOP, the rule this package already applies to `Spinner`
   * and `ProgressBar`'s `gradient`. The web draws `from-hover-brand to-hover-success`; React
   * Native draws no gradient without a native module, so the fill is `hover.brand` — the
   * first stop, read from the token rather than written as the hex it resolves to.
   *
   * A severity does not change a banner, so all four functions share the fill, exactly as on
   * the web.
   */
  banner: (() => {
    const fill = { bg: tokens.surface.hover.brand, edge: undefined, ink: tokens.text.default.invert };
    return { success: fill, info: fill, warning: fill, danger: fill };
  })(),
} as const satisfies Record<string, Record<string, { bg: string; edge?: string; ink: string }>>;

/**
 * The glyph's colour per treatment, as a resolved token VALUE rather than an `IconColor`.
 *
 * The callout borders are not in the icon ramp — `#087660` against the ramp's `#0ea06e` —
 * so this cannot be spelled as the closed colour vocabulary and reaches `Icon` through its
 * `tint` channel. On the web the same colours arrive by `currentColor` inheritance, which
 * native has no equivalent for.
 */
export const ALERT_TREATMENT_GLYPH_TINT = {
  accent: {
    success: tokens.callout.good.border,
    info: tokens.callout.default.border,
    warning: tokens.callout.warn.border,
    danger: tokens.callout.neg.border,
  },
  coach: {
    success: tokens.callout.coach.border,
    info: tokens.callout.default.border,
    warning: tokens.callout.warn.border,
    danger: tokens.callout.neg.border,
  },
  banner: (() => {
    const ink = tokens.text.default.invert;
    return { success: ink, info: ink, warning: ink, danger: ink };
  })(),
} as const satisfies Record<string, Record<string, string>>;

/** The stroke each treatment draws: a left rule, a full border, or none. */
export const ALERT_TREATMENT_EDGE = {
  accent: { borderLeftWidth: 4 },
  coach: { borderWidth: 1 },
  banner: {},
} as const satisfies Record<string, ViewStyle>;

/** Colour is not a channel every reader has, so each function also carries a word. */
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
} as const satisfies Record<string, IconName>;

/**
 * THE TOAST'S TWO SIZES, AND THE WIDTH THAT CHOOSES BETWEEN THEM — the native reading of the web
 * host's `sizeForViewport` (UMK-1039 on the web, UMK-1057 here).
 *
 * Figma publishes the toast at Medium (14/20 text, 24px glyph, 12px side padding) on the 1440
 * desktop frame and Small (12/18, 20px glyph, 8px padding) on the 360 phone, and nothing but the
 * width chooses between them. The web reads `(min-width: 768px)` when the toast is raised; this is
 * the same number, so both platforms make the same choice at the same width — rather than native
 * simply "being Small" and the two agreeing by coincidence.
 *
 * On every device this app ships to it resolves to Small: `app.config.ts` sets
 * `supportsTablet: false`, and no phone is 768 wide. The RULE is kept rather than the answer, so
 * that a tablet in scope finds the toast already right, and so that a test can pin a rule with one
 * injection (force Medium) where a constant offers nothing to inject.
 */
export const TOAST_MEDIUM_MIN_WIDTH = 768;

export type ToastSize = Extract<AlertSize, 'medium' | 'small'>;

export const toastSizeForWidth = (width: number): ToastSize =>
  width >= TOAST_MEDIUM_MIN_WIDTH ? 'medium' : 'small';

/**
 * The close glyph beside each size, in PIXELS — 20 beside Medium, 18 beside Small. Figma's two
 * Close instances, and the only place a glyph on this surface does not follow `Alert`'s own size.
 *
 * 18 is on no ladder: not the measurement scale (`1-25` is 20, `0-75` is 12), not `Icon`'s five
 * steps, and not the web's spacing scale either — which is why the web spells it `h-[18px]` rather
 * than rounding the design to 16 or 20. The same honesty here: a number, with the reason, in one
 * place. `Toaster` draws it through the registry at this size rather than through `Icon`, whose
 * `size` is deliberately a closed vocabulary.
 *
 * `large` falls in with Medium, as it does on the web (`size === 'small' ? 18 : 20`): Figma
 * publishes a Large toast but draws its close at the same 20, and the width rule above never
 * chooses it — only a caller asking for `size: 'large'` reaches that row.
 */
export const TOAST_CLOSE_GLYPH = {
  large: 20,
  medium: 20,
  small: 18,
} as const satisfies Record<AlertSize, number>;

/**
 * The skeleton base and its sweep. Both colours are published — there is no skeleton
 * token, because the values it needs already have names.
 */
export const SKELETON_BASE = {
  overflow: 'hidden',
  backgroundColor: tokens.surface.weak.neutral,
} as const satisfies ViewStyle;

export const SKELETON_SHEEN = tokens.surface.default.primary;

export const SKELETON_SHAPE = {
  text: { height: tokens.spacing.md, alignSelf: 'stretch', borderRadius: tokens.radius.xs },
  circle: { height: tokens.spacing['2xl'], width: tokens.spacing['2xl'], borderRadius: tokens.radius.full },
  rect: { height: measure['5-25'], alignSelf: 'stretch', borderRadius: tokens.radius.md },
} as const satisfies Record<string, ViewStyle>;
