'use client';

import React from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { POPOVER_ALIGN, POPOVER_CONTENT } from '../overlay-classes';

type Axes = typeof contract.Popover.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** The contract's one axis, read here and carried by `PopoverContent`. */
export type PopoverAlign = Of<'align'>;

export interface PopoverProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

/**
 * Arbitrary interactive content anchored to a trigger — what `Tooltip` (hover-only text) and
 * `Menu` (items with handlers) cannot hold (UMK-1185). Compose it from `Popover` (the open
 * state), `PopoverTrigger` or `PopoverAnchor`, and `PopoverContent` (the surface, the
 * `align` axis and the `portal` choice).
 *
 * A declared component rather than Radix's `Root` re-exported: an alias of an imported symbol
 * in this file cost it its docgen entry, which `apps/design`'s `docgen.test.ts` catches.
 */
export function Popover(props: PopoverProps) {
  return <RadixPopover.Root {...props} />;
}

Popover.displayName = 'Popover';

const ALIGN = POPOVER_ALIGN satisfies Record<Of<'align'>, string>;

export type PopoverContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof RadixPopover.Content>,
  'align'
> & {
  align?: Of<'align'>;
  /**
   * Render into `document.body` instead of in place. Default `false`.
   *
   * IN PLACE BY DEFAULT for the reason `Select` gives: a portalled panel inside a modal dialog
   * runs into the standing conflict between the dialog guidance and the overlay guard. The
   * opt-in exists because in place is not always reachable (UMK-1185 U1): Radix positions the
   * panel `fixed`, and an ancestor with a transform, a filter or a backdrop filter becomes the
   * containing block for it — so an `overflow: hidden` ancestor such a host carries clips it.
   * A caller inside one passes `portal`.
   */
  portal?: boolean;
};

/** The panel: the shared overlay surface, the `align` axis and the in-place/portal choice. */
export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof RadixPopover.Content>,
  PopoverContentProps
>(({ align = 'center', sideOffset = 4, portal = false, className, ...props }, ref) => {
  const content = (
    <RadixPopover.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(POPOVER_CONTENT, ALIGN[align], className)}
      {...props}
    />
  );
  return portal ? <RadixPopover.Portal>{content}</RadixPopover.Portal> : content;
});

PopoverContent.displayName = 'PopoverContent';
