'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { SKELETON_BASE, SKELETON_SHAPE, SKELETON_SHEEN } from '../feedback-classes';

type Axes = typeof contract.Skeleton.axes;

export type SkeletonShape = Axes['shape'][number];

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `text` is a line, `circle` an avatar, `rect` a block. Size the rest with `className`. */
  shape?: SkeletonShape;
}

/**
 * One shape primitive and one shimmer.
 *
 * Replaces five separate skeleton components plus 25 loose `animate-pulse` across 13 files,
 * none of which respected reduced motion. Per-surface skeletons stay with their surfaces —
 * this is the piece they compose from, not a replacement for each layout.
 *
 * DELIBERATELY SILENT. A skeleton is a placeholder, and a live region firing on every page
 * load is noise that trains people to ignore it; the surface owning the loading state does
 * the announcing. `aria-hidden` is the feature here, not an omission — which is why the
 * contract records it as a divergence rather than leaving it to be "fixed" later.
 *
 * Ensyra publishes no skeleton at all, so the Storybook story is what a designer works
 * against — the story is a deliverable here, not documentation.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ shape = 'text', className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden
      data-skeleton={shape}
      className={cn(SKELETON_BASE, SKELETON_SHAPE[shape], className)}
      {...props}
    >
      {/* A separate sweeping element rather than a pulsing opacity on the block: pulsing a
          tint reads as a flashing element rather than as loading, which is what the 25
          `animate-pulse` sites in the app do today. */}
      <span aria-hidden className={SKELETON_SHEEN} />
    </div>
  ),
);

Skeleton.displayName = 'Skeleton';
