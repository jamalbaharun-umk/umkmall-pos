'use client';

import React from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import {
  DISMISS_BUTTON,
  TOOLTIP_ARROW_FILL,
  TOOLTIP_SIZE,
  TOOLTIP_SURFACE,
} from '../feedback-classes';

type Axes = typeof contract.Tooltip.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type TooltipColor = Of<'color'>;
export type TooltipSize = Of<'size'>;
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';
export type TooltipAlign = 'start' | 'center' | 'end';

export interface TooltipProps {
  /** What the tip says. */
  content: React.ReactNode;
  /**
   * The element the tip describes. Rendered AS the trigger, not wrapped in one.
   *
   * `ReactElement`, not `ReactNode`: `asChild` hands this to Radix's `Slot`, which calls
   * `Children.only`. A string, a fragment, an array or `null` type-checks fine under the
   * wider type and then fails at runtime — the narrower type is the only compile-time
   * signal there is.
   */
  children: React.ReactElement;
  color?: TooltipColor;
  size?: TooltipSize;
  /**
   * Preferred placement. The tip FLIPS away from this when the trigger is near a viewport
   * edge, and the arrow follows wherever it lands — which is why there is no `arrow` prop.
   * Figma publishes six arrow values; they are the consequence of a resolved placement, and
   * pinning one lets a tip point away from its own trigger while rendering perfectly.
   */
  side?: TooltipSide;
  align?: TooltipAlign;
  /** Figma's `Icon Left`. Omit for no glyph. */
  icon?: React.ReactNode;
  /**
   * Figma's `Show Close`. Defaults OFF, unlike Figma: a tip that closes on pointer-leave
   * has nothing for a close button to do, so it belongs to the click-to-open case a caller
   * opts into.
   */
  showClose?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hover delay before the tip appears, in ms. */
  delayDuration?: number;
}

/**
 * Wraps `@radix-ui/react-tooltip`.
 *
 * Replaces 219 hand-rolled lines whose defect was compute-once positioning: it measured on
 * open and never again, so the tip drifted off its trigger on any scroll, and it never
 * linked the trigger to the tip at all. Collision detection, flipping, scroll
 * repositioning, `aria-describedby` and the arrow all arrive with the library — and the
 * arrow deriving from the resolved placement is precisely what compute-once cannot do.
 *
 * On scroll Radix does BOTH things, depending on what moved: the popper follows a scrolling
 * viewport, and the tooltip closes when a scrolling ancestor contains its own trigger.
 * Either way the tip cannot end up detached from what it describes, which is the failure
 * the replaced component shipped.
 *
 * Provider is INTERNAL so one import works. Radix allows nesting, so an app that adds its
 * own provider at the root is not broken by this one.
 */
export const Tooltip = ({
  content,
  children,
  color = 'dark',
  size = 'large',
  side = 'top',
  align = 'center',
  icon,
  showClose = false,
  open,
  defaultOpen = false,
  onOpenChange,
  delayDuration = 200,
}: TooltipProps) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  /**
   * A controlled `open` passed WITHOUT its handler works for as long as the value stays
   * `undefined` — which is where every test starts — and then silently stops responding.
   * Keeping both halves means the uncontrolled path still updates and the controlled one
   * still reports.
   */
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  /**
   * Track the controlled value while it exists, so HANDING CONTROL BACK resumes from the
   * true last state. Without this, `setOpen` never writes `internalOpen` during the
   * controlled phase, and a caller that later passes `open={undefined}` snaps the tip to
   * whatever it was before control began.
   */
  React.useEffect(() => {
    if (open !== undefined) setInternalOpen(open);
  }, [open]);

  const { box, glyph } = TOOLTIP_SIZE[size];

  return (
    <RadixTooltip.Provider delayDuration={delayDuration}>
      <RadixTooltip.Root open={isOpen} onOpenChange={setOpen}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            align={align}
            /**
             * Radix duplicates `children` into a visually-hidden `role="tooltip"` element —
             * that copy IS what `aria-describedby` points at. So a close button inside the
             * tip is announced twice unless the accessible text is supplied separately.
             * Passing `aria-label` replaces the copy with the label instead of the markup.
             * Node content still duplicates; put chrome in the tip only alongside a string.
             */
            aria-label={typeof content === 'string' ? content : undefined}
            sideOffset={8}
            collisionPadding={8}
            className={cn(
              'z-ds-overlay flex max-w-xs items-center gap-ds-2xs rounded-ds-md',
              box,
              TOOLTIP_SURFACE[color],
            )}
          >
            {icon !== undefined && (
              <span aria-hidden className={cn('flex shrink-0 items-center', glyph)}>
                {icon}
              </span>
            )}
            <span className="min-w-0">{content}</span>
            {showClose && (
              /* Radix Tooltip publishes no `Close` part — unlike Popover, which is the
                 shape this reads like. A plain button routed through the same `setOpen`
                 keeps the uncontrolled and controlled paths in step. */
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setOpen(false)}
                className={DISMISS_BUTTON}
              >
                <Icon name="x" className={glyph} />
              </button>
            )}
            {/* The arrow takes the tip's own FILL. Radix renders it as an `<svg>`, so a
                `bg-*` class resolves to nothing here and the arrow renders black — which
                looks like a z-index bug rather than a missing fill. */}
            <RadixTooltip.Arrow width={12} height={8} className={TOOLTIP_ARROW_FILL[color]} />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
};

Tooltip.displayName = 'Tooltip';
