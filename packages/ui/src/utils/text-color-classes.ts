import { TEXT_COLORS } from '../contract';

export type TextColor = (typeof TEXT_COLORS)[number];

/**
 * The semantic text colours, as the Tailwind classes that render them.
 *
 * Lives here rather than in `contract/` because the contract declares VOCABULARY and may not
 * name a Tailwind class — that is what keeps it consumable by a future `.native.tsx` sibling,
 * and a guard test enforces it. This is the web mapping of that vocabulary, so both `Text` and
 * `Icon` read the same one instead of each hand-keeping a copy that nothing compares.
 */
export const TEXT_COLOR_CLASSES = {
  primary: 'text-default-primary',
  secondary: 'text-default-secondary',
  disable: 'text-disable-primary',
  invert: 'text-default-invert',
  brand: 'text-default-brand',
  success: 'text-default-success',
  error: 'text-default-error',
  warning: 'text-default-warning',
  muted: 'text-default-muted',
} satisfies Record<TextColor, string>;
