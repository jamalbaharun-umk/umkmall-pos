import React from 'react';
import { cva } from 'class-variance-authority';
import { TEXT_ROLES, TEXT_ROLE_WEIGHTS, TEXT_WEIGHTS } from '../../contract';
import { cn, TEXT_COLOR_CLASSES, type TextColor } from '../../utils';

export type TextRole = (typeof TEXT_ROLES)[number];
export type TextWeight = (typeof TEXT_WEIGHTS)[number];
export type { TextColor };

/** The weights a given role actually publishes. `display` and `h1` have two. */
export type WeightFor<R extends TextRole> = (typeof TEXT_ROLE_WEIGHTS)[R][number];

/**
 * Role -> the `ds-*` fontSize key the token pipeline emits for it.
 *
 * Written out rather than derived from the role name, because the two vocabularies differ
 * on purpose: the contract uses camelCase identifiers (`bodyLg`) and the pipeline slugs
 * Figma's own names (`ds-body-lg-*`). A `role.replace(/([A-Z])/…)` bridge would work today
 * and break silently the first time either side renames — Tailwind emits NOTHING for a key
 * it does not know, so the text would simply render at the browser default with no error.
 */
const SCALE: Record<TextRole, string> = {
  display: 'text-ds-display-mobile',
  h1: 'text-ds-h1-mobile',
  h2: 'text-ds-h2-mobile',
  h3: 'text-ds-h3-mobile',
  h4: 'text-ds-h4-mobile',
  h5: 'text-ds-h5-mobile',
  h6: 'text-ds-h6-mobile',
  paragraph: 'text-ds-paragraph-mobile',
  bodyLg: 'text-ds-body-lg-mobile',
  bodyMd: 'text-ds-body-md-mobile',
  bodySm: 'text-ds-body-sm-mobile',
};

/**
 * ONE STEP AT EVERY VIEWPORT (UMK-1053 follow-up).
 *
 * The scale used to pair each role's Mobile utility with an `lg:` Desktop one, which is what
 * Figma publishes. Applying it to the live TemanAI surface enlarged every migrated heading
 * and paragraph above 976px — production renders the pre-migration fixed sizes, which are
 * the Mobile step — so the `lg:` half is dropped until the desktop redesign lands and the
 * two agree again. The Desktop tokens stay in the preset; nothing here reaches for them.
 *
 * Do NOT "fix" this by editing the Desktop values in `packages/ui/tokens.preset.js`: that
 * file is generated from the Figma export by `npm run tokens:build`, so a hand-edit is
 * overwritten by the next build and silently disagrees with the design file meanwhile.
 *
 * Each utility carries its line-height with it: the pipeline emits `fontSize` in Tailwind's
 * tuple form, so `text-ds-paragraph-desktop` sets 16px AND 24px leading in one class and
 * there is no way for a caller to take one without the other (UMK-910).
 */
const textVariants = cva('', {
  variants: {
    variant: SCALE,
    weight: {
      bold: 'font-bold',
      semibold: 'font-semibold',
      medium: 'font-medium',
      regular: 'font-normal',
    } satisfies Record<TextWeight, string>,
    color: TEXT_COLOR_CLASSES,
  },
  defaultVariants: { variant: 'paragraph', weight: 'regular', color: 'primary' },
});

/** The element each variant renders as when `as` is not given. */
const DEFAULT_ELEMENT: Record<TextRole, React.ElementType> = {
  display: 'h1',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  paragraph: 'p',
  bodyLg: 'p',
  bodyMd: 'p',
  bodySm: 'p',
};

export interface TextProps<R extends TextRole = 'paragraph'>
  extends Omit<React.HTMLAttributes<HTMLElement>, 'color'> {
  /**
   * Which step of the scale to render. Named `variant`, not `role`: `role` is an HTML
   * attribute with a meaning of its own, and taking that name made `role="status"`
   * unsayable on a `Text` — a real limitation, and a confusing one now the values are
   * named for elements. ARIA's `role` passes straight through to the DOM.
   */
  variant?: R;
  /**
   * Constrained to the weights `R` publishes. Offering `medium` on `display` would resolve
   * to a token that does not exist and render at the browser default — a styling bug that
   * looks like a CSS problem rather than a missing token.
   */
  weight?: WeightFor<R>;
  color?: TextColor;
  /** Render a different element while keeping the role's styles. */
  as?: React.ElementType;
  children?: React.ReactNode;
  ref?: React.Ref<HTMLElement>;
}

/**
 * Renders the Ensyra type scale.
 *
 * Weight is a SEPARATE axis from the variant, unlike the retired `Typography`, which baked weight
 * into the variant name (`h4` was always medium) and so could not express the scale.
 *
 * A plain generic function rather than `React.forwardRef`: React 19 takes `ref` as an
 * ordinary prop, and `forwardRef` erases the `R` type parameter that ties `weight` to
 * `role`. The rest of the primitives predate React 19 and still use `forwardRef`.
 */
export const Text = <R extends TextRole = 'paragraph'>({
  as,
  variant,
  weight,
  color,
  className,
  children,
  ref,
  ...props
}: TextProps<R>) => {
  const Component = as ?? DEFAULT_ELEMENT[variant ?? 'paragraph'];
  return (
    <Component ref={ref} className={cn(textVariants({ variant, weight, color }), className)} {...props}>
      {children}
    </Component>
  );
};

Text.displayName = 'Text';

export { textVariants };
