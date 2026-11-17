'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn, FOCUS_RING } from '../../utils';
import { Spinner } from '../Spinner';
import { useFieldIds } from '../field-support';

type Axes = typeof contract.Switch.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/** track / thumb / thumb travel, per size. */
const SIZE = {
  large: { track: 'h-8 w-14', thumb: 'h-6 w-6', on: 'translate-x-6' },
  medium: { track: 'h-6 w-11', thumb: 'h-4 w-4', on: 'translate-x-5' },
  small: { track: 'h-5 w-9', thumb: 'h-3 w-3', on: 'translate-x-4' },
} satisfies Record<Of<'size'>, { track: string; thumb: string; on: string }>;

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  /**
   * The label does NOT change with state — "Notifikasi" stays "Notifikasi" whether the
   * switch is on or off. A label that flips reads as the action rather than the setting, and
   * the accessible state already says which way it is set.
   */
  label: React.ReactNode;
  size?: Of<'size'>;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /**
   * A contract boolean and a first-class state: a switch applies its change immediately
   * rather than behind a submit, so an in-flight change has to be visible AND perceivable —
   * `aria-busy`, not colour alone.
   */
  loading?: boolean;
}

/**
 * Figma and the reference design system both call this Toggle. Same component, different
 * word — see the recorded divergence.
 *
 * NO `error`, NO `required`. A control that applies instantly has nothing to validate
 * against; a setting that needs a save button is a checkbox.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      label,
      id,
      size = 'medium',
      checked,
      defaultChecked = false,
      onCheckedChange,
      loading,
      disabled,
      className,
      onClick,
      ...props
    },
    ref,
  ) => {
    const { fieldId } = useFieldIds(id);
    const labelId = `${fieldId}-label`;
    const [internal, setInternal] = React.useState(defaultChecked);
    const isOn = checked ?? internal;
    const { track, thumb, on } = SIZE[size];
    /**
     * THE ONE SOURCE for "this switch cannot be pressed". Both the track colour and the
     * `disabled` attribute read it, so what the control looks like and what the browser will
     * actually let you press cannot disagree — by shared reference, not by two expressions
     * happening to be typed the same way.
     */
    const isOff = disabled || loading;
    /**
     * ONE resolution from both dimensions, deliberately — not a base colour with a `disabled:`
     * override layered on it. The override was unconditional (`disabled:bg-default-secondary`),
     * so a switch that was ON but locked painted as OFF: the user was told the setting was off
     * when it was on. Two variants on one property are not a conflict `cn` can resolve, so the
     * later one simply won, and nothing in the suite could see a wrong colour.
     */
    const trackColor = isOff
      ? isOn
        ? 'bg-disable-brand'
        : 'bg-disable-primary'
      : isOn
        ? 'bg-default-brand'
        : 'bg-default-secondary';

    return (
      <span className="inline-flex items-center gap-ds-2xs">
        <button
          {...props}
          ref={ref}
          id={fieldId}
          type="button"
          role="switch"
          aria-checked={isOn}
          /* `htmlFor` alone does not name a button in every screen reader — the
             association has to be explicit for a non-form-control element. */
          aria-labelledby={labelId}
          aria-busy={loading || undefined}
          disabled={isOff}
          onClick={(e) => {
            if (checked === undefined) setInternal(!isOn);
            onCheckedChange?.(!isOn);
            onClick?.(e);
          }}
          className={cn(
            'relative inline-flex shrink-0 items-center rounded-ds-full border-2 border-transparent p-ds-5xs transition-colors ring-0',
            track,
            trackColor,
            'disabled:cursor-not-allowed',
            FOCUS_RING.control,
            className,
          )}
        >
          <span
            aria-hidden
            className={cn(
              'inline-flex items-center justify-center rounded-ds-full bg-default-primary transition-transform',
              thumb,
              isOn ? on : 'translate-x-0',
            )}
          >
            {loading && <Spinner size="sm" variant="primary" label="" aria-hidden className="h-full w-full" />}
          </span>
        </button>
        {/* The LABEL goes pale too. Figma's `05 Toggle` 775:3361 paints it `#c3cbd3` in both
            disabled variants — which is `text-disable-primary` — and a locked control whose
            label still reads at full strength is the half of the state nobody notices is
            missing. Keyed on the same `isOff` the track and the `disabled` attribute use. */}
        <label
          id={labelId}
          htmlFor={fieldId}
          className={cn(
            'text-ds-paragraph-mobile',
            isOff ? 'text-disable-primary' : 'text-default-primary',
          )}
        >
          {label}
        </label>
      </span>
    );
  },
);

Switch.displayName = 'Switch';
