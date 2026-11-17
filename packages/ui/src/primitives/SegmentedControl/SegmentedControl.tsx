'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn, FOCUS_RING } from '../../utils';
import {
  SEGMENTED_SEGMENT,
  SEGMENTED_SEGMENT_CHECKED,
  SEGMENTED_SEGMENT_SIZE,
  SEGMENTED_TRACK,
} from '../field-classes';

/** Every size the table carries, so a rung added to the contract cannot be left unstyled. */
const _sizes = SEGMENTED_SEGMENT_SIZE satisfies Record<Of<'size'>, string>;
void _sizes;

type Axes = typeof contract.SegmentedControl.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  /** Names the segment when `label` is a glyph or abbreviation (e.g. "A+"). */
  ariaLabel?: string;
}

export interface SegmentedControlProps<V extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'role'> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  size?: Of<'size'>;
  disabled?: boolean;
}

/**
 * ONE choice out of a few, all visible at once: a radiogroup, not tabs (nothing swaps below it).
 * Roving tabindex — Tab lands on the chosen segment, arrows move AND choose, as a native radio
 * group does. The group needs an accessible name from the caller (`aria-label`).
 */
export function SegmentedControl<V extends string = string>({
  options,
  value,
  onChange,
  size = 'medium',
  disabled,
  className,
  ...props
}: SegmentedControlProps<V>) {
  // A `value` that matches no option must not strand the group outside the tab order.
  const hasChecked = options.some((o) => o.value === value);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, step: 1 | -1) => {
    if (disabled) return;
    const next = (from + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div {...props} role="radiogroup" className={cn(SEGMENTED_TRACK, className)}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            disabled={disabled}
            tabIndex={checked || (!hasChecked && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(SEGMENTED_SEGMENT, SEGMENTED_SEGMENT_SIZE[size], FOCUS_RING.control, checked && SEGMENTED_SEGMENT_CHECKED)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
