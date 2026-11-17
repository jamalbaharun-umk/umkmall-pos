/**
 * THE `choice` APPEARANCE of `SelectionCard` (UMK-1296): the agent surface's ChoicePicker cards as
 * they rendered BEFORE the library owned them, reproduced value for value. A NAMED variant, not a
 * set of per-slot overrides: the default appearance (coin and credit purchase screens) must not
 * move, and the choice cards must not move either.
 *
 * WHY THIS IS NOT IN `field-classes.ts`. The default look differs from these cards in size and
 * spacing, and the purge guards read that file's tables. Two colours had no token and UMK-1380 moved
 * them to the nearest one, a DELIBERATE shift: `#E6E9ED` (the idle border) is now
 * `border-default-primary` #F0F0F0, and `#7A8794` (the body and eyebrow ink) is now
 * `text-default-secondary` #93A2B0. The other colours have a token with the exact value:
 * `#042648` is `text-default-primary`, `#0074E7` is `default-brand`, `#F0F7FF` is `bg-weak-brand`,
 * and white is `bg-default-primary`. Selected stays distinct from idle by its brand border and wash.
 *
 * NO FONT SIZE ON THE HEADING: the old card inherited its surroundings' size, and so does this.
 */
export const CHOICE_ROW = 'grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2';

export const CHOICE_CARD =
  'relative flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:border-default-brand';

export const CHOICE_STATE = {
  default: 'border-default-primary bg-default-primary',
  selected: 'border-default-brand bg-weak-brand',
} as const;

/* The old card only dimmed; it kept its idle or selected paint, so this is added to a state, never one. */
export const CHOICE_DISABLED = 'opacity-60 cursor-default';

export const CHOICE_ICON =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-weak-brand text-ds-h6-desktop';
export const CHOICE_TEXT = 'min-w-0 flex-1';
export const CHOICE_TOP = 'flex items-start justify-between gap-2';
export const CHOICE_EYEBROW = 'text-ds-legacy-xs font-semibold uppercase tracking-wide text-default-secondary';
export const CHOICE_HEADING = 'font-bold text-default-primary';
export const CHOICE_TITLE = 'mt-0.5 block font-bold text-default-primary';
export const CHOICE_BODY = 'mt-0.5 block text-ds-paragraph-mobile text-default-secondary';
