/**
 * THE `a2ui` APPEARANCE of the primitives the agent surface renders (UMK-1307): the looks they had
 * BEFORE the UMK-877 adapter migration, reproduced value for value. A NAMED appearance per component,
 * not per-slot overrides — a caller `className` cannot override a `ds-` spacing rung (both ship and
 * the stylesheet's order decides, packages/ui/CLAUDE.md), and the default look of every component must
 * not move either. Same pattern, and same reason, as `selection-card-choice-classes.ts` (UMK-1296).
 *
 * WHY THIS IS NOT IN THE FAMILY TABLES. These looks keep the agent surface's own sizes, spacing and
 * structure, which the default look of the component must not take. Since UMK-1380 they carry NO raw
 * colour: every colour moved to the NEAREST token, so a hue shifts where the old one had none (the
 * shifts are listed on that PR). Delete a section when design adopts the default look.
 *
 * NATIVE READS THE SAME TOKENS, AND A TEST HOLDS IT (UMK-1317). `apps/mobile/src/temanai/a2ui/look.ts`
 * names one token path per colour class below, and
 * `apps/mobile/src/temanai/a2ui/__tests__/a2ui-look-web-parity.test.ts` parses THIS file and compares.
 * So changing, adding or removing a colour class here reds that suite — in the Mobile Quality Gates
 * job, not in this package's own tests — until `look.ts` and the test's map follow. A class it cannot
 * classify (an arbitrary value, a Tailwind palette colour) reds it too.
 *
 * `appearance="a2ui"` is read by the a2ui adapters ONLY. Nothing else may pass it.
 */

/* ---- TextField ---- */
export const A2UI_FIELD_STACK = 'flex w-full flex-col gap-0.5';
export const A2UI_FIELD_LABEL = 'text-ds-legacy-xs text-default-primary';
export const A2UI_BOX_BASE =
  'flex w-full items-center rounded-xl border border-default-primary bg-default-primary px-3 py-2 text-ds-paragraph-mobile text-default-primary focus-within:border-default-brand focus-within:ring-2 focus-within:ring-default-brand/30';
export const A2UI_BOX_STATE = {
  default: '',
  filled: '',
  error: 'border-default-error',
  disabled: 'cursor-not-allowed bg-default-subtle text-default-secondary',
} as const;
export const A2UI_BOX_CONTROL =
  'w-full min-w-0 bg-transparent outline-none placeholder:text-default-secondary disabled:cursor-not-allowed';

/* ---- CheckBox: the NATIVE box (natively tinted), not the drawn one ---- */
export const A2UI_CHECK_ROW = 'flex cursor-pointer items-center gap-2 text-ds-paragraph-mobile text-default-primary';
export const A2UI_CHECK_INPUT = 'shrink-0 accent-brand-primary';

/* ---- Upload: the dashed dropzone, its inline pill and its in-zone error ---- */
export const A2UI_UPLOAD_STACK = 'flex w-full flex-col';
export const A2UI_UPLOAD_LABEL = 'mb-2 text-ds-paragraph-mobile font-semibold text-default-primary';
export const A2UI_UPLOAD_ZONE =
  'flex w-full flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center transition-colors';
export const A2UI_UPLOAD_ZONE_STATE = { idle: 'border-default-invert bg-default-primary', over: 'border-default-brand bg-weak-brand' } as const;
export const A2UI_UPLOAD_PILL =
  'inline-flex cursor-pointer items-center rounded-full border border-default-brand px-6 py-2 text-ds-paragraph-mobile font-bold text-default-brand transition-colors hover:bg-weak-brand';
export const A2UI_UPLOAD_ERROR = 'text-ds-paragraph-mobile font-semibold text-default-error empty:hidden';

/* ---- Badge: the small uppercase status pill ---- */
/* ponytail: 11px has no type token, so rem here does NOT follow --ds-text-scale. */
export const A2UI_BADGE =
  'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-ds-legacy-11 font-bold uppercase tracking-wide';
/** Keyed by the library's colour axis, which is how the adapter maps the wire `variant`. */
export const A2UI_BADGE_COLOR = {
  light: 'bg-weak-neutral text-default-primary',
  primary: 'bg-weak-brand text-default-brand',
  success: 'bg-weak-success text-hover-success',
  warning: 'bg-weak-warning text-hover-warning',
  danger: 'bg-weak-error text-default-error',
} as const;

/* ---- Chip: the choice-picker chip ---- */
export const A2UI_CHIP = 'rounded-full border px-5 py-2.5 text-ds-paragraph-mobile font-bold transition-colors disabled:opacity-60';
export const A2UI_CHIP_STATE = {
  default: 'border-default-primary bg-default-primary text-default-primary hover:border-default-brand hover:text-default-brand',
  active: 'border-default-brand bg-weak-brand text-default-brand',
} as const;

/* ---- Divider ---- */
export const A2UI_DIVIDER = { horizontal: 'my-1 w-full', vertical: 'mx-1 self-stretch' } as const;
export const A2UI_DIVIDER_RULE = {
  horizontal: 'w-full border-t border-default-primary',
  vertical: 'h-full border-l border-default-primary',
} as const;

/* ---- Disclosure ---- */
export const A2UI_DISCLOSURE = 'rounded-lg border border-default-primary bg-default-primary';
export const A2UI_DISCLOSURE_SUMMARY = 'cursor-pointer px-3 py-2 text-ds-paragraph-mobile font-bold text-default-primary marker:text-default-secondary';
export const A2UI_DISCLOSURE_PANEL = 'px-3 pb-3 pt-1';

/* ---- Image ---- */
export const A2UI_IMAGE =
  'flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-default-primary bg-default-primary';
export const A2UI_IMAGE_PLACEHOLDER = 'border-dashed text-ds-legacy-xs text-default-secondary';

/* ---- CodeBlock: the light copy card ---- */
export const A2UI_CODE_BLOCK = 'overflow-hidden rounded-lg border border-default-primary bg-default-primary';
export const A2UI_CODE_BAR = 'flex items-center justify-between border-b border-default-primary px-3 py-1.5';
export const A2UI_CODE_LABEL = 'text-ds-legacy-xs font-medium text-default-primary';
export const A2UI_CODE_ACTION = 'text-ds-legacy-xs text-hover-warning hover:text-active-warning';
export const A2UI_CODE_BODY = 'block whitespace-pre-wrap break-words px-3 py-2 font-mono text-ds-paragraph-mobile text-default-primary';

/* ---- Alert: the Callout note box ---- */
export const A2UI_ALERT = 'flex w-full items-center rounded-lg px-3 py-2 text-ds-paragraph-mobile';
/** Keyed `<treatment>-<function>`: the six looks the Callout adapter enumerates. */
export const A2UI_ALERT_LOOK = {
  'coach-info': 'border border-default-brand/20 bg-weak-brand text-hover-brand',
  'coach-success': 'border border-default-success/30 bg-weak-success text-hover-success',
  'accent-success': 'border-l-4 border-default-success bg-weak-success text-default-primary',
  'accent-warning': 'border-l-4 border-default-warning bg-weak-warning text-default-primary',
  'accent-danger': 'border-l-4 border-default-error bg-weak-error text-default-primary',
  'banner-success': 'bg-gradient-to-r from-default-brand to-hover-success text-default-invert',
} as const;

/* ---- Tabs: one rule under the whole list, natural-width triggers (UMK-1290) ---- */
export const A2UI_TAB_LIST = 'flex gap-1 border-b border-default-primary';
export const A2UI_TAB_TRIGGER = 'px-3.5 py-2 text-ds-paragraph-mobile font-bold -mb-px border-b-2';
export const A2UI_TAB_STATE = {
  default: 'text-default-secondary border-transparent',
  active: 'text-default-primary border-default-brand',
} as const;
export const A2UI_TAB_PANEL = 'pt-3.5';

/* ---- Card: the plain container has NO classes; the hero is the journey-completion banner ---- */
// `[&_*]:text-default-invert` forces the child Text white over the gradient (Text hardcodes a dark colour).
// The gradient runs on the brand and success tokens (UMK-1380): `gradientColorStops` publishes both.
export const A2UI_CARD_HERO =
  'rounded-2xl bg-gradient-to-r from-default-brand to-hover-success text-default-invert shadow-md px-5 py-6 sm:px-7 sm:py-8 text-center leading-snug [&_*]:text-default-invert [&_h2]:text-ds-h4-desktop sm:[&_h2]:text-ds-legacy-3xl [&_h2]:font-bold';
