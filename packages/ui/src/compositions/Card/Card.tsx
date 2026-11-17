import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { A2UI_CARD_HERO } from '../../primitives/a2ui-classes';
import { CARD_BASE, CARD_PADDING, CARD_ROUNDED, CARD_VARIANT } from '../../primitives/content-classes';

type Axes = typeof contract.Card.axes;

export type CardPadding = Axes['padding'][number];
export type CardVariant = Axes['variant'][number];

/** The corner rung a caller may pick. `lg` is the default radius, `full` a pill or a circle. */
export type CardRounded = keyof typeof CARD_ROUNDED;

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * How the card separates itself from the page: a shadow (`elevated`), a border (`outlined`),
   * or nothing at all (`plain`, for a card whose surface supplies its own chrome).
   */
  variant?: CardVariant;
  padding?: CardPadding;
  /** Picks one radius token in place of the default (`lg`, 24px): none 0, sm 12, md 16, lg 24, full a pill. */
  rounded?: CardRounded;
  /** `a2ui` is the agent surface's bare container, `a2ui-hero` its gradient banner (UMK-1290); only its adapter passes them. Both ignore `variant`/`padding`. */
  appearance?: Axes['appearance'][number];
  children: React.ReactNode;
}

/**
 * A container.
 *
 * THE `variant` AXIS WAS DROPPED AND THEN RESTORED, and that round trip is the lesson. It was
 * dropped because no consumer passed it — true, and the wrong conclusion: no consumer passed
 * anything, because the component was unused. A survey of the TemanAI surfaces then found all
 * three treatments live, with `outlined` (a border, no shadow) the most common by far. "No
 * consumer" is evidence about adoption, never about need.
 *
 * `elevated` stays the default so the two existing call sites render exactly what they did.
 *
 * Figma's published Card set is a course card — a `Type` of Mobile Search, Homepage and
 * Search, plus booleans for a rating, a struck-through price and tags. Adopting it would make
 * this container refuse to hold anything that is not a course, so the contract records it as
 * a divergence instead.
 *
 * The padding steps are spelled out. They shipped as `sm | md | lg`, which is the same
 * abbreviation slice 3 already reverted once as a defect.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'elevated', padding = 'medium', rounded, appearance = 'default', children, ...props }, ref) => (
    <div
      ref={ref}
      className={
        appearance === 'default'
          ? cn(rounded ? CARD_BASE.replace(/rounded-ds-\w+/, '') : CARD_BASE, rounded && CARD_ROUNDED[rounded], CARD_VARIANT[variant], CARD_PADDING[padding], className)
          : cn(appearance === 'a2ui-hero' ? A2UI_CARD_HERO : undefined, className)
      }
      {...props}
    >
      {children}
    </div>
  ),
);

Card.displayName = 'Card';
