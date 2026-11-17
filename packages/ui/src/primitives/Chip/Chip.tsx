'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { A2UI_CHIP, A2UI_CHIP_STATE } from '../a2ui-classes';
import { CHIP_BASE, CHIP_COMPACT_IDLE_BORDER, CHIP_COMPACT_WEIGHT, CHIP_SIZE, CHIP_STATE, ICON_SLOT } from '../content-classes';

type Axes = typeof contract.Chip.axes;

export type ChipState = Axes['state'][number];
export type ChipSize = Axes['size'][number];

export interface ChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'style'> {
  /**
   * Selection state, not a treatment — which is why this is `state` rather than the package's
   * usual `variant`. `active` composes badly with a treatment name, and the contract already
   * calls the axis this.
   *
   * NO DEFAULT, deliberately. Omitting it says "this chip is an action, not a toggle" and
   * suppresses `aria-pressed` entirely; passing it opts into toggle semantics. Do not reach
   * for `active` to mean "this one is special" — it means "this one is selected", and a chip
   * announcing a selection nobody made is worse than one that announces nothing.
   */
  state?: ChipState;
  size?: ChipSize;
  /** `a2ui` is the agent surface's pre-library chip (UMK-1307); only its adapter passes it. */
  appearance?: Axes['appearance'][number];
  /** Figma's `Show Icon Left` / `Show Icon Right` slots. Decorative — the label carries meaning. */
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * An interactive pill.
 *
 * The counterpart to `Badge`, and the split between them is the point: a badge labels, a chip
 * is pressed. Five of `Badge`'s six call sites passed a handler and moved here, which is both
 * what made removing `Badge`'s index signature safe and this component's proof that its API
 * carries a real call site.
 *
 * It renders a `<button>` — so it is reachable by keyboard, announced as a control and
 * disableable — and takes its focus ring from `FOCUS_RING.control` rather than hand-rolling
 * one. The pills it replaces were `<span>`s with an `onClick`: clickable by mouse, invisible
 * to everything else.
 *
 * `htmlType` is NOT offered and `type` is omitted from the passthrough, so the DOM attribute
 * is pinned to `button`. A chip inside a form that defaulted to `submit` would submit it,
 * which is the failure a filter row makes on its first Enter press.
 *
 * COVERS `CHIP_BASE` / `CHIP_IDLE` / `CHIP_SELECTED` in `a2ui/components/shared.tsx` — read
 * for the shape, never imported, and none of their hex copied. Deleting those constants and
 * migrating their one consumer is UMK-877's; this only has to cover the case.
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ state, size = 'medium', appearance = 'default', iconLeft, iconRight, children, className, ...props }, ref) => (
    <button
      /* Spread first: JSX is last-wins, and `ButtonHTMLAttributes` legally carries
         `aria-pressed` and `type`. A passthrough placed after these would silently replace the
         selection semantics below with nothing failing to compile. */
      {...props}
      ref={ref}
      type="button"
      /**
       * THE SELECTION, ANNOUNCED — but ONLY when the caller says there is one.
       *
       * A chip that merely looks selected tells a screen-reader user nothing, and every pill
       * this replaces was in exactly that state. The inverse is a real error too: emitting
       * `aria-pressed="false"` on a chip that is an ACTION rather than a toggle announces an
       * unpressed switch that can never be pressed. A "+2 show more" pill is not a toggle.
       *
       * So `state` has no default. Omit it and the chip is an action with the idle treatment
       * and no pressed semantics; pass it and the chip is a toggle whose state is announced.
       */
      aria-pressed={state === undefined ? undefined : state === 'active'}
      className={
        appearance === 'a2ui'
          ? cn(A2UI_CHIP, A2UI_CHIP_STATE[state ?? 'default'], className)
          : cn(CHIP_BASE, CHIP_STATE[state ?? 'default'], CHIP_SIZE[size], size === 'compact' && CHIP_COMPACT_WEIGHT[state ?? 'default'], size === 'compact' && (state ?? 'default') === 'default' && CHIP_COMPACT_IDLE_BORDER, className)
      }
    >
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
    </button>
  ),
);

Chip.displayName = 'Chip';
