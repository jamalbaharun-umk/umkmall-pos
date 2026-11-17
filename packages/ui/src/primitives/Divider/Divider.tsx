import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { A2UI_DIVIDER, A2UI_DIVIDER_RULE } from '../a2ui-classes';
import {
  DIVIDER_BASE,
  DIVIDER_LABEL,
  DIVIDER_ORIENTATION,
  DIVIDER_RULE,
  DIVIDER_VARIANT,
} from '../content-classes';

type Axes = typeof contract.Divider.axes;

export type DividerVariant = Axes['variant'][number];
export type DividerOrientation = Axes['orientation'][number];

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: DividerVariant;
  /**
   * Which way the rule runs. A `vertical` divider separates items inside a row and takes its
   * height from that row, so it needs a flex parent to stretch against.
   */
  orientation?: DividerOrientation;
  /** `a2ui` is the agent surface's pre-library rule (UMK-1307); only its adapter passes it. */
  appearance?: Axes['appearance'][number];
  /** An optional label, centred on the rule. Horizontal only — see the docblock. */
  children?: React.ReactNode;
}

/**
 * A rule, with an optional centred label.
 *
 * THE WRAPPER AXIS IS GONE. The legacy component declared `variant` twice — once on the rule,
 * where the two values genuinely differ, and once on the wrapper, where both mapped to the
 * empty string. That second one did nothing at all while reading as a real choice, which is
 * the shape a reader "fixes" by adding classes to it. Only the rule's axis survives.
 *
 * A VERTICAL DIVIDER IS NOT A ROTATED HORIZONTAL ONE. It separates items inside a row, takes
 * its height from that row rather than spanning a width, and carries horizontal margin. This
 * component could only ever be horizontal until the a2ui renderer — which has had `axis` since
 * it was written, pinned there by the upstream A2UI Basic spec — proved the library could not
 * serve that migration at all.
 *
 * `role="separator"` and `aria-orientation` are set even when there is a label: a rule that
 * divides content but announces nothing leaves a screen-reader user with no sense of the
 * break. `aria-orientation` follows the prop, so the announcement cannot disagree with the
 * render.
 *
 * A LABEL IS HORIZONTAL-ONLY, and passing one on a vertical divider is ignored rather than
 * stacked: the design has no vertical-with-label form, and inventing one here would put a
 * rotated or wrapped word in the middle of a 1px rule.
 *
 * The label's background is what punches the rule, so it takes the same surface token as the
 * page beneath it. A divider dropped onto a tinted surface needs the caller's own background
 * class — the alternative is a label floating over a line through its own middle.
 */
export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ className, variant = 'default', orientation = 'horizontal', appearance = 'default', children, ...props }, ref) => {
    const a2ui = appearance === 'a2ui';
    const rule = a2ui ? A2UI_DIVIDER_RULE[orientation] : cn(DIVIDER_RULE[orientation], DIVIDER_VARIANT[variant]);
    const labelled = orientation === 'horizontal' && !!children;

    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation={orientation}
        className={cn(DIVIDER_BASE, a2ui ? A2UI_DIVIDER[orientation] : DIVIDER_ORIENTATION[orientation], className)}
        {...props}
      >
        {labelled ? (
          <>
            <div aria-hidden className="absolute inset-0 flex items-center">
              <div className={rule} />
            </div>
            <div className="relative flex justify-center">
              <span className={DIVIDER_LABEL}>{children}</span>
            </div>
          </>
        ) : (
          <div className={rule} />
        )}
      </div>
    );
  },
);

Divider.displayName = 'Divider';
