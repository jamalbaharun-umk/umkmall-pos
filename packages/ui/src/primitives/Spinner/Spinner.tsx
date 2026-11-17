import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  SPINNER_BASE,
  SPINNER_GRADIENT_FILL,
  SPINNER_GRADIENT_MASK,
  SPINNER_SIZE,
  SPINNER_VARIANT,
} from '../feedback-classes';

type Axes = typeof contract.Spinner.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** Re-tied to the contract, for the same reason as `ProgressBar`'s tables. */
const VARIANT = SPINNER_VARIANT satisfies Record<Of<'variant'>, string>;
const SIZE = SPINNER_SIZE satisfies Record<Of<'size'>, string>;

export interface SpinnerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
  variant?: Of<'variant'>;
  size?: Of<'size'>;
  /**
   * The busy state as a WORD, because the movement is not a channel every reader has — and
   * under reduced motion there is no movement at all.
   *
   * An empty string is a real choice, distinct from not passing one: a spinner inside a button
   * would otherwise concatenate "Loading..." into that button's accessible name.
   */
  label?: string;
}

/**
 * A loading spinner.
 *
 * BROUGHT ONTO TOKENS AND UNDER A GUARD (UMK-961 U10), alongside `ProgressBar`. It shipped
 * `border-t-z-primary`, `border-t-white` and `border-t-gray-500` with no table and no coverage
 * in any family guard. Slice 6 owns reconciling it with its native sibling — including whether
 * the abbreviated size words stay — so this change stops at tokens, a table, guard coverage
 * and the reduced-motion form.
 */
export const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, variant = 'primary', size = 'md', label = 'Loading...', ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-label={label || undefined}
      className={cn(
        SPINNER_BASE,
        VARIANT[variant],
        SIZE[size],
        /* A border cannot carry a gradient, so this variant is a filled disc with its middle
           punched out by the mask below — `relative` is what the mask positions against. */
        variant === 'gradient' && `relative ${SPINNER_GRADIENT_FILL}`,
        className,
      )}
      {...props}
    >
      {variant === 'gradient' && <span aria-hidden className={SPINNER_GRADIENT_MASK} />}
      <span className="sr-only">{label}</span>
    </div>
  ),
);

Spinner.displayName = 'Spinner';
