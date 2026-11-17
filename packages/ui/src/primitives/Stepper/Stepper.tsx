'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  STEPPER_BASE,
  STEPPER_CONNECTOR,
  STEPPER_CONNECTOR_STATE,
  STEPPER_LABEL_STATE,
  STEPPER_MARK,
  STEPPER_MARK_STATE,
  STEPPER_ORIENTATION,
  STEPPER_SELECT,
  STEPPER_STEP,
} from '../content-classes';
import { Icon } from '../Icon';

type Axes = typeof contract.Stepper.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const MARK_STATE = STEPPER_MARK_STATE satisfies Record<Of<'state'>, string>;
const LABEL_STATE = STEPPER_LABEL_STATE satisfies Record<Of<'state'>, string>;
const ORIENTATION = STEPPER_ORIENTATION satisfies Record<Of<'orientation'>, string>;

export interface StepperStep {
  label: React.ReactNode;
  state?: Of<'state'>;
  /**
   * Where in the trail this step sits.
   *
   * DERIVABLE from the index, and kept as an explicit axis anyway: Figma publishes a single
   * step as its own component with this property, so one rendered in isolation has to be able
   * to say it has no leg behind it. Omitted, it is computed.
   */
  position?: Of<'position'>;
  /**
   * Makes the whole item (mark and label) one `<button type="button">` (UMK-1809). Omitted, the step
   * renders exactly as before: no button, no tab stop.
   */
  onSelect?: () => void;
  /**
   * On a step with `onSelect`: this item is the one on show, so its button carries `aria-current="step"`
   * even when the step is drawn `done` (tick, finished leg). `state: 'current'` carries it too.
   */
  selected?: boolean;
  /** The select button's accessible name; without it the button is named by its label text. */
  selectLabel?: string;
  /** `data-testid` of the select button. */
  testId?: string;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  orientation?: Of<'orientation'>;
  /** Names the trail for assistive technology; a bare list of numbers announces as nothing. */
  'aria-label'?: string;
  className?: string;
}

const positionOf = (index: number, total: number): Of<'position'> =>
  index === 0 ? 'first' : index === total - 1 ? 'last' : 'middle';

/**
 * A step trail, horizontal or vertical.
 *
 * ONE VOCABULARY RECONCILED FROM THREE. Ensyra publishes this idea three times under three
 * property names, and `Mid` means a POSITION in one set and a STATE in another. The library
 * takes `position` × `state` × `orientation`, spelling the middle value out, and records all
 * three published spellings as divergences so the reconciliation is cheap for design to
 * reject. The vertical set publishes no completed state; it renders here, and that too is
 * recorded rather than explained away.
 *
 * CONSUMERS: the journey run page's stage trail (`JourneyProgress`, with `onSelect` on finished
 * stages) and the account-deletion flow. The vocabulary was first validated against the design source
 * alone; the divergences recorded on the contract entry are what keep a revision cheap.
 *
 * `onSelect` WRAPS the mark and the label in one native button, and the connector stays a direct child of
 * the `li`, outside it: the leg is positioned against the `li`, so a positioned button would move it.
 *
 * THE CURRENT STEP IS EXPOSED, not merely coloured: `aria-current` is the only channel a
 * reader who cannot see the fill has.
 */
export const Stepper = React.forwardRef<HTMLOListElement, StepperProps>(
  ({ steps, orientation = 'horizontal', 'aria-label': ariaLabel, className }, ref) => (
    <ol
      ref={ref}
      aria-label={ariaLabel}
      className={cn(STEPPER_BASE, ORIENTATION[orientation], className)}
    >
      {steps.map((step, index) => {
        const state = step.state ?? 'default';
        const position = step.position ?? positionOf(index, steps.length);
        /* THE LEG BEHIND THIS STEP REPORTS THE PREVIOUS ONE, not this one. A leg is the
           journey already travelled, so the line into the current step is complete when the
           step before it is — keying it on this step's own state leaves a grey leg between two
           finished marks, which reads as a gap in the trail. */
        const legState = steps[index - 1]?.state ?? 'default';
        const markAndLabel = (
          <>
            <span
              aria-current={!step.onSelect && state === 'current' ? 'step' : undefined}
              className={cn(STEPPER_MARK, MARK_STATE[state])}
            >
              {/* A completed step swaps the numeral for the glyph; the number it replaces is
                  still the position in the list, which the ordered list itself carries. */}
              {/* `check-circle-filled`, NOT `check-circle`. The lucide name is an OUTLINE
                  circle, and drawn on an already-filled mark it reads as a circle inside a
                  circle; the house glyph is Figma's disc with a knocked-out tick. Pinned by
                  identity in `content.stories.test.tsx` because nothing in the rendered DOM
                  names an icon. NO `fill-*` CLASS anywhere on this subtree — the glyph paints
                  from `currentColor` and a Tailwind class beats the SVG attribute invisibly. */}
              {state === 'done' ? (
                <Icon name="check-circle-filled" className="h-5 w-5" aria-hidden />
              ) : (
                index + 1
              )}
            </span>
            <span className={LABEL_STATE[state]}>{step.label}</span>
          </>
        );
        return (
          <li key={index} className={STEPPER_STEP[orientation]}>
            {/* No connector on the first step — the absence of an element, not a zero-length
                one, which is also why `position` has to survive a step rendered alone. */}
            {position !== 'first' && (
              <span
                aria-hidden
                data-connector
                className={cn(STEPPER_CONNECTOR[orientation], STEPPER_CONNECTOR_STATE[legState])}
              />
            )}
            {step.onSelect ? (
              <button
                type="button"
                onClick={step.onSelect}
                aria-current={step.selected || state === 'current' ? 'step' : undefined}
                aria-label={step.selectLabel}
                data-testid={step.testId}
                className={STEPPER_SELECT[orientation]}
              >
                {markAndLabel}
              </button>
            ) : (
              markAndLabel
            )}
          </li>
        );
      })}
    </ol>
  ),
);

Stepper.displayName = 'Stepper';
