'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn, FOCUS_RING } from '../../utils';
import { resolveLabelling, useFieldIds, type LabelledProps } from '../field-support';

type Axes = typeof contract.Slider.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * Track height and thumb diameter per size, from Figma `Slider` 1308:8026: Large is a 12px
 * track under a 20px thumb, Small an 8px track under an 18px one. The track heights already
 * matched; both thumb diameters moved.
 */
const SIZE = {
  large:
    'h-3 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5',
  small:
    'h-2 [&::-webkit-slider-thumb]:h-4.5 [&::-webkit-slider-thumb]:w-4.5 [&::-moz-range-thumb]:h-4.5 [&::-moz-range-thumb]:w-4.5',
} satisfies Record<Of<'size'>, string>;

/**
 * A STYLED NATIVE RANGE INPUT, deliberately. The browser supplies the slider role, the
 * min/max/now values and the whole keyboard pattern — arrows step, Home and End reach the
 * bounds — so there is no key handler here and adding one would fight the platform.
 *
 * THE FILLED TRACK IS THE ONE ESCAPE FROM THE CLASS-ONLY RULE. Only Gecko publishes a
 * pseudo-element for the progressed portion; everywhere else it has to be a gradient whose
 * stop is computed from the current value, and a computed stop cannot be a static class. So
 * the percentage travels as an inline custom property and the gradient reads it — the inline
 * style carries a number, never a colour.
 *
 * THE THUMB IS A RING, and every vendor selector has to say so separately. Figma draws a
 * white disc with a 6px brand stroke (`Slider` 1308:8026); a rule written for one prefix is
 * simply absent in the other engine, so the two lists below stay in step or the thumb is a
 * ring in Chromium and a white dot in Firefox. Gecko's arm had an explicit `border-0` that
 * had to be REPLACED rather than merely joined — a zero width beside a colour paints nothing.
 *
 * `border-solid` IS LOAD-BEARING, and finding out took a browser. Tailwind's preflight sets
 * a solid border STYLE to `*`, `::before` and `::after` only, which does NOT reach a vendor-prefixed
 * slider-thumb pseudo-element. Without it the width and the colour both land on a border
 * whose style is still `none`, so the ring paints NOTHING and the thumb renders as a plain
 * white blob — with every class resolving, every rule in the stylesheet, and the right values
 * in all of them. No assertion over class names can see that; only looking at it can.
 *
 * The property is named in WORDS above rather than in its CSS spelling on purpose. This file
 * is scanned by `inline-classes.purge.test.ts`, which counts classes written in COMMENTS
 * because Tailwind emits rules for them — writing it the other way turned this very docblock
 * into a live class that resolves to nothing, and redded that guard.
 */
const TRACK =
  'w-full cursor-pointer appearance-none rounded-ds-full bg-default-secondary [background:linear-gradient(to_right,rgb(var(--surface-default-brand))_var(--slider-fill),rgb(var(--surface-default-secondary))_var(--slider-fill))] disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:box-border [&::-webkit-slider-thumb]:rounded-ds-full [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-6 [&::-webkit-slider-thumb]:border-default-brand [&::-webkit-slider-thumb]:bg-default-primary [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:rounded-ds-full [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-6 [&::-moz-range-thumb]:border-default-brand [&::-moz-range-thumb]:bg-default-primary';

/**
 * UMK-1383. `scrubber` is the video player's seek bar, reproduced value for value: a 4px track
 * split by a hard stop into the played part (the inverse surface) and the unplayed part (the
 * same colour at 30%), a 12px thumb that is LAID OUT but transparent until hover or keyboard
 * focus (opacity, not display, so a drag works on the gesture that reveals it). No ring, no
 * focus outline: the thumb appearing IS the focus indicator, as it was before the axis existed.
 * Ours; Figma publishes no thin slider.
 */
const SCRUBBER =
  'h-1 w-full cursor-pointer appearance-none rounded-full [background:linear-gradient(to_right,rgb(var(--surface-default-primary))_var(--slider-fill),rgb(var(--surface-default-primary)/0.3)_var(--slider-fill))] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-default-primary [&::-webkit-slider-thumb]:opacity-0 [&::-webkit-slider-thumb]:transition-opacity hover:[&::-webkit-slider-thumb]:opacity-100 focus-visible:[&::-webkit-slider-thumb]:opacity-100 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-default-primary [&::-moz-range-thumb]:opacity-0 hover:[&::-moz-range-thumb]:opacity-100 focus-visible:[&::-moz-range-thumb]:opacity-100';

/**
 * A type alias rather than an interface, because an interface cannot extend a union and the
 * labelling pair IS a union — see `LabelledProps`. `aria-label` is omitted from the DOM
 * attributes first: the inherited optional would otherwise widen the arm that requires it
 * back into an optional, and the whole guarantee with it.
 */
export type SliderProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type' | 'aria-label'
> &
  LabelledProps & {
    size?: Of<'size'>;
    /** UMK-1383. `scrubber` is the video player's thin seek bar; `size` does not apply to it. */
    appearance?: Of<'appearance'>;
    min?: number;
    max?: number;
    step?: number;
    /**
     * Turns the raw number into something worth hearing, and only then is `aria-valuetext`
     * set. The reference design system never sets it at all, so a percentage announces there
     * as a bare integer — this is the one place we are deliberately ahead of it. Without a
     * formatter no `aria-valuetext` is emitted, rather than a redundant copy of the number.
     */
    formatValue?: (value: number) => string;
  };

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  (
    {
      label,
      'aria-label': ariaLabel,
      id,
      size = 'large',
      appearance = 'default',
      min = 0,
      max = 100,
      step = 1,
      formatValue,
      value,
      defaultValue,
      onChange,
      className,
      style,
      ...props
    },
    ref,
  ) => {
    const { fieldId } = useFieldIds(id);
    const labelling = resolveLabelling(label, ariaLabel);
    /**
     * A bare range input defaults to the MIDDLE of its range, not to `min`. Starting at
     * `min` left the fill track empty under a centred thumb and announced a value the
     * browser disagreed with — and no test could see it, because happy-dom reports an empty
     * value and every story passes a `defaultValue`.
     */
    const [internal, setInternal] = React.useState(
      defaultValue !== undefined ? Number(defaultValue) : (min + max) / 2,
    );
    const current = value !== undefined ? Number(value) : internal;
    const span = max - min || 1;
    const pct = Math.min(100, Math.max(0, ((current - min) / span) * 100));

    return (
      <div className="flex w-full flex-col gap-ds-2xs">
        {labelling.visible !== undefined && (
          <label htmlFor={fieldId} className="text-ds-body-lg-mobile font-medium text-default-primary">
            {labelling.visible}
          </label>
        )}
        <input
          {...props}
          ref={ref}
          id={fieldId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          defaultValue={value === undefined ? internal : undefined}
          aria-label={labelling.ariaLabel}
          aria-valuetext={formatValue ? formatValue(current) : undefined}
          onChange={(e) => {
            if (value === undefined) setInternal(Number(e.target.value));
            onChange?.(e);
          }}
          /* Merged, not replaced: `className` composes through `cn`, so a `style` that
             silently vanished would be an asymmetry a caller could only find by looking. */
          style={{ ...style, '--slider-fill': `${pct}%` } as React.CSSProperties}
          className={cn(
            appearance === 'scrubber' ? SCRUBBER : [TRACK, SIZE[size], FOCUS_RING.control],
            className,
          )}
        />
      </div>
    );
  },
);

Slider.displayName = 'Slider';
