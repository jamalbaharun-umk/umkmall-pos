'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn, FOCUS_RING } from '../../utils';
import { CONTROL_BOX_ERROR, CONTROL_FIRST_LINE, CONTROL_LABEL, CONTROL_ROW, RADIO_BOX } from '../field-classes';
import { FieldError, RequiredMark, useFieldIds } from '../field-support';

type Axes = typeof contract.Radio.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * `CheckBox`'s scale minus the largest step — the radio set does not publish it. The two
 * share their markup and their box classes; what differs is this scale, the round corner,
 * the dot instead of a tick, and the absence of an indeterminate state.
 */
/**
 * THE SAME THREE RUNGS `CheckBox` publishes — 18 / 16 / 14, Figma's scale. A person reading
 * a form sees one control size, not two, so these values and the checkbox's are one decision
 * written twice; nothing links them at compile time (UMK-1091 KTD4).
 */
const CONTROL_SIZE = {
  large: 'h-4.5 w-4.5',
  medium: 'h-4 w-4',
  small: 'h-3.5 w-3.5',
} satisfies Record<Of<'size'>, string>;

export interface RadioProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label: React.ReactNode;
  size?: Of<'size'>;
  error?: string;
}

export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  ({ label, id, size = 'medium', error, required, className, ...props }, ref) => {
    const { fieldId, errorId } = useFieldIds(id);

    return (
      <div className="flex flex-col gap-ds-3xs">
        <label htmlFor={fieldId} className={cn(CONTROL_ROW, 'cursor-pointer')}>
          <span className={cn('relative inline-flex', CONTROL_FIRST_LINE[size])}>
            <input
              {...props}
              ref={ref}
              id={fieldId}
              type="radio"
              required={required}
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
              className={cn(
                RADIO_BOX,
                'rounded-ds-full',
                CONTROL_SIZE[size],
                error && CONTROL_BOX_ERROR,
                FOCUS_RING.control,
                className,
              )}
            />
            {/* A dot rather than a glyph: the radio mark is a filled circle at every size,
                and an icon would need its own scale table to stay round. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 m-auto h-1/3 w-1/3 rounded-ds-full bg-default-primary opacity-0 peer-checked:opacity-100"
            />
          </span>
          <span className={CONTROL_LABEL}>
            {label}
            {required && <RequiredMark />}
          </span>
        </label>
        <FieldError id={errorId} message={error} />
      </div>
    );
  },
);

Radio.displayName = 'Radio';
