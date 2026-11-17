import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { RequiredMark } from '../field-support';

type Axes = typeof contract.Label.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * Label Variants.
 *
 * BOTH TABLES ARE PINNED TO THE CONTRACT, the shape `Button.tsx` already uses. `cva` is not the
 * problem and was not removed (UMK-900) — an UNPINNED variant table is: without the `satisfies`
 * these keys WERE the vocabulary, and a fourth colour added here would have been a variant the
 * contract never heard of and native could never mirror.
 */
const labelVariants = cva(
  'block text-ds-paragraph-mobile font-semibold mb-2 transition-colors',
  {
    variants: {
      /**
       * Color variant
       */
      variant: {
        default: 'text-z-text-primary',
        error: 'text-default-error',
        success: 'text-default-success',
      } satisfies Record<Of<'variant'>, string>,
      /**
       * Size variant
       */
      size: {
        sm: 'text-ds-legacy-xs',
        md: 'text-ds-paragraph-mobile',
        lg: 'text-ds-paragraph-desktop',
      } satisfies Record<Of<'size'>, string>,
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

/**
 * THE FIELD LOOKS (UMK-955): the caption a form control draws over its own box, exact to Figma's
 * `Field Input` 127:1459 — Large 14/20, Small 12/18, regular weight (w400), `default-primary`, and NO
 * bottom margin (the control's own stack spaces it).
 *
 * A SEPARATE BASE STRING, not overrides on the standalone one: `cn` cannot reconcile two `ds-`
 * font sizes, so a merged override would ship both. `size` and `variant` apply to
 * `look='default'` only; a field look ignores both.
 */
const FIELD_LOOK = {
  'field-large': 'block text-ds-paragraph-mobile font-normal text-default-primary',
  'field-small': 'block text-ds-body-lg-mobile font-normal text-default-primary',
} satisfies Record<Exclude<Of<'look'>, 'default'>, string>;

/**
 * Label Props
 */
export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement>,
    VariantProps<typeof labelVariants> {
  /**
   * `field-large` and `field-small` are the looks a web form control gives its own caption;
   * `default` is the standalone label. A field look ignores `size` and `variant`.
   */
  look?: Of<'look'>;
  /**
   * Whether the field is required. The default look draws its own red asterisk; a field look
   * draws the shared `RequiredMark` (decorative, error token).
   */
  required?: boolean;
}

/**
 * Label Component
 *
 * A form label component with variant support.
 *
 * @example
 * ```tsx
 * // Default label
 * <Label htmlFor="email">Email</Label>
 *
 * // Required label
 * <Label htmlFor="email" required>Email</Label>
 *
 * // Error label
 * <Label htmlFor="email" variant="error">Email</Label>
 *
 * // Custom size
 * <Label htmlFor="email" size="lg">Email</Label>
 * ```
 */
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, variant, size, look = 'default', required, children, ...props }, ref) => {
    if (look !== 'default') {
      return (
        <label ref={ref} className={cn(FIELD_LOOK[look], className)} {...props}>
          {children}
          {required && <RequiredMark />}
        </label>
      );
    }
    return (
      <label
        ref={ref}
        className={cn(labelVariants({ variant, size }), className)}
        {...props}
      >
        {children}
        {required && <span className="text-default-error ml-1">*</span>}
      </label>
    );
  }
);

Label.displayName = 'Label';

export { labelVariants };
