'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn, FOCUS_RING } from '../../utils';
import { A2UI_CHECK_INPUT, A2UI_CHECK_ROW } from '../a2ui-classes';
import { Icon } from '../Icon';
import {
  CONTROL_BOX,
  CONTROL_BOX_ERROR,
  CONTROL_FIRST_LINE,
  CONTROL_GLYPH,
  CONTROL_LABEL,
  CONTROL_ROW,
} from '../field-classes';
import { FieldError, RequiredMark, resolveLabelling, useFieldIds, type LabelledProps } from '../field-support';

type Axes = typeof contract.CheckBox.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * FIGMA'S SCALE: Large 18, Medium 16, Small 14 (`01 Check Box` 121:1457). Every step was two
 * pixels wider than that and the whole ladder moved (UMK-1091).
 *
 * `xlarge` at 20 is OURS, one rung above Large on the same two-pixel rhythm. Figma does
 * publish a `Size=XL`, but its BOX is 18px — identical to Large — and only the label's type
 * scale changes, which this component does not vary by size. Adopting that literally would
 * make two of our four sizes pixel-identical, so the divergence is deliberate and recorded on
 * the contract entry rather than left to be rediscovered.
 *
 * `Radio` keeps its own copy of the three shared rungs; the two tables and native's third
 * have no compile-time link, so they move together or the controls disagree silently (KTD4).
 */
const CONTROL_SIZE = {
  xlarge: 'h-5 w-5',
  large: 'h-4.5 w-4.5',
  medium: 'h-4 w-4',
  small: 'h-3.5 w-3.5',
} satisfies Record<Of<'size'>, string>;

export type CheckBoxProps = LabelledProps &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type' | 'aria-label'> & {
  size?: Of<'size'>;
  /** `native` keeps the browser's own natively tinted box (the agent surface's pre-library look, UMK-1307); only its adapter passes it. */
  appearance?: Of<'appearance'>;
  error?: string;
  /**
   * A DOM PROPERTY, not an attribute — it cannot be set from JSX and is assigned to the
   * element below. It also styles the box without making the input checked: a partly
   * selected parent is neither checked nor unchecked, which is why it is its own boolean
   * rather than a third value of `checked`.
   */
  indeterminate?: boolean;
};

export const CheckBox = React.forwardRef<HTMLInputElement, CheckBoxProps>(
  ({ label, 'aria-label': ariaLabel, id, size = 'medium', appearance = 'default', error, indeterminate, required, className, ...props }, ref) => {
    const { fieldId, errorId } = useFieldIds(id);
    const labelling = resolveLabelling(label, ariaLabel);
    const inner = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inner.current!, []);
    /**
     * The prop is authoritative, and keeping it so takes BOTH of these.
     *
     * The browser clears `indeterminate` on user activation without the prop changing, and
     * an uncontrolled click re-renders nothing — so neither an effect keyed on the prop nor
     * a bare dependency-free effect gets a chance to put it back. Left alone the input then
     * reports checked while the glyph still paints the dash. The DOM write is idempotent,
     * so re-asserting it after every render AND after every change is the cheap answer;
     * clearing the state is the parent's job, by dropping the prop.
     */
    const assertIndeterminate = () => {
      const el = inner.current;
      if (!el) return;
      el.indeterminate = Boolean(indeterminate);
      /* A click flips `checked` as well, and restoring only `indeterminate` leaves the box
         painting the dash while submitting as checked — half the bug. While the prop says
         indeterminate the control is neither checked nor unchecked, so an uncontrolled box
         goes back to unchecked; a controlled one is React's to own. */
      if (indeterminate && props.checked === undefined) el.checked = false;
    };
    React.useEffect(assertIndeterminate);

    const native = appearance === 'native';

    return (
      <div className="flex flex-col gap-ds-3xs">
        {/* The label is part of the clickable target, not a caption beside it — a hit-area
            requirement rather than a styling preference. */}
        <label htmlFor={fieldId} className={native ? A2UI_CHECK_ROW : cn(CONTROL_ROW, 'cursor-pointer')}>
          <span className={cn('relative inline-flex', !native && labelling.visible !== undefined && CONTROL_FIRST_LINE[size])}>
            <input
              {...props}
              ref={inner}
              id={fieldId}
              type="checkbox"
              aria-label={labelling.ariaLabel}
              required={required}
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
              onChange={(e) => {
                props.onChange?.(e);
                assertIndeterminate();
              }}
              className={
                native
                  ? cn(A2UI_CHECK_INPUT, CONTROL_SIZE[size], className)
                  : cn(
                      CONTROL_BOX,
                      'rounded-ds-xs',
                      CONTROL_SIZE[size],
                      error && CONTROL_BOX_ERROR,
                      FOCUS_RING.control,
                      className,
                    )
              }
            />
            {!native && (
            <Icon
              name={indeterminate ? 'minus' : 'check'}
              aria-hidden
              className={cn(
                CONTROL_GLYPH,
                indeterminate ? 'opacity-100' : 'opacity-0 peer-checked:opacity-100',
              )}
            />
            )}
          </span>
          {labelling.visible !== undefined && (
            <span className={native ? undefined : CONTROL_LABEL}>
              {labelling.visible}
              {required && <RequiredMark />}
            </span>
          )}
        </label>
        <FieldError id={errorId} message={error} />
      </div>
    );
  },
);

CheckBox.displayName = 'CheckBox';
