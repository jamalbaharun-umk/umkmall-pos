import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { A2UI_BADGE, A2UI_BADGE_COLOR } from '../a2ui-classes';
import { BADGE_BASE, BADGE_COLOR, BADGE_SIZE, ICON_SLOT } from '../content-classes';

type Axes = typeof contract.Badge.axes;

export type BadgeColor = Axes['color'][number];
export type BadgeSize = Axes['size'][number];

/**
 * DELIBERATELY NOT `extends React.HTMLAttributes<HTMLSpanElement>`.
 *
 * That would re-admit both props this rewrite exists to remove — `style`, which is how all
 * six call sites carried their hex, and `onClick`, which is what made five of them Chips. A
 * closed prop list is what turns each of those into a typecheck error instead of a silent
 * pass-through, and it is the whole reason the migration could be bounded at six sites.
 *
 * `className` survives because every component in this package takes one. It is not a licence
 * to re-specify the size axis: a call site that passes its own padding and radius has
 * reached past the axis rather than chosen a value on it.
 */
export interface BadgeProps {
  color?: BadgeColor;
  size?: BadgeSize;
  /** `a2ui` is the agent surface's pre-library pill (UMK-1307); only its adapter passes it. */
  appearance?: Axes['appearance'][number];
  /** Figma's `Show Icon Left` / `Show Icon Right` slots. Decorative — the label carries meaning. */
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * A label. NOT a control.
 *
 * It renders a `<span>`, takes no handler and has no focus ring, and that is the point rather
 * than an omission: five of this component's six call sites passed an `onClick` and were
 * interactive pills with a selected look — they are Chips, and they moved. A badge that
 * accepts a handler is a button nobody can reach with a keyboard.
 *
 * THE INDEX SIGNATURE IS GONE, and removing it is most of the value here. The old props
 * carried `[key: string]: any`, the only one in this package, which defeats excess-property
 * checking outright — `<Badge sizr="medium">` compiled, and so did an inline hex `style` on
 * every one of the six sites even though `style` was never declared. Nothing typechecked, so
 * nothing could drift into being wrong; it started wrong.
 *
 * The colour axis replaced a five-value `variant` (info, success, warning, error, default)
 * that shared not one value with what the contract has declared since slice 1. So no call
 * site's colour could be MAPPED across — each had to be chosen — and the prop is `color`
 * rather than `variant` because the axis is genuinely a colour, which is the package's own
 * rule for when to depart from `variant`.
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ color = 'primary', size = 'medium', appearance = 'default', iconLeft, iconRight, children, className }, ref) => (
    <span ref={ref} className={
        appearance === 'a2ui' && color in A2UI_BADGE_COLOR
          ? cn(A2UI_BADGE, A2UI_BADGE_COLOR[color as keyof typeof A2UI_BADGE_COLOR], className)
          : cn(BADGE_BASE, BADGE_COLOR[color], BADGE_SIZE[size], className)
      }>
      {iconLeft ? (
        <span aria-hidden className={ICON_SLOT}>
          {iconLeft}
        </span>
      ) : null}
      {children}
      {iconRight ? (
        <span aria-hidden className={ICON_SLOT}>
          {iconRight}
        </span>
      ) : null}
    </span>
  ),
);

Badge.displayName = 'Badge';
