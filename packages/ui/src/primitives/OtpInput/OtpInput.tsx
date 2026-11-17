'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  BOX_STATE,
  FIELD_LABEL,
  OTP_BOX,
  OTP_BOX_ACTIVE,
  OTP_BOX_SIZE,
  OTP_INPUT,
  OTP_ROW,
} from '../field-classes';
import { FieldError, resolveLabelling, useFieldIds, type LabelledProps } from '../field-support';

type Axes = typeof contract.OtpInput.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/* Re-tied to this component's own size axis, as `DateTimeInput` does with the box table. */
const SIZE = OTP_BOX_SIZE satisfies Record<Of<'size'>, string>;

export type OtpInputSize = Of<'size'>;

export type OtpInputProps = LabelledProps & {
  /** How many digits. Default 6. */
  length?: number;
  /** Digits only; anything else is dropped on the way in. */
  value: string;
  onChange: (value: string) => void;
  /** Fires on every change that leaves a full code: a fill, a retype, or a different code replacing it. */
  onComplete?: (value: string) => void;
  size?: OtpInputSize;
  /** The message itself, not a flag — see `FieldError` for why the region is always mounted. */
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  name?: string;
  className?: string;
};

/**
 * A one-time code, as ONE input drawn as boxes (UMK-1186).
 *
 * Mirrors the native `apps/mobile/src/auth/views/OtpInput.tsx`, and for its reason: the OS
 * delivers an SMS/WhatsApp code as ONE autofill into ONE field, so the six-`<input>` shape
 * both web apps ship receives nothing. `autoComplete="one-time-code"` sits on the single real
 * input; the boxes are `aria-hidden`, because six boxes announcing "1", "", "" is noise over a
 * control that already reads its value as a string.
 *
 * NO `maxLength` on the input, deliberately: a browser truncates a paste to `maxLength` BEFORE
 * the change handler sees it, so a code pasted as "12 34-56" would lose its last digits to the
 * separators. The handler strips and clamps instead.
 */
export const OtpInput = React.forwardRef<HTMLInputElement, OtpInputProps>(
  (
    {
      length = 6,
      value,
      onChange,
      onComplete,
      size = 'large',
      error,
      disabled,
      autoFocus,
      id,
      name,
      className,
      label,
      'aria-label': ariaLabel,
    },
    ref,
  ) => {
    const { fieldId, errorId } = useFieldIds(id);
    const labelling = resolveLabelling(label, ariaLabel);
    const [focused, setFocused] = React.useState(false);
    const digits = value.replace(/\D/g, '').slice(0, length);
    const state = disabled ? 'disabled' : error ? 'error' : digits ? 'filled' : 'default';

    /**
     * The next code from whatever the input now holds.
     *
     * A WHOLE CODE ARRIVING replaces what is there, however it arrives: a paste, the OS
     * one-time-code suggestion, SMS Retriever or a password manager. None of the last three fire
     * `paste` — they reach `onChange` as text spliced in at the caret, so "123456" landing after a
     * typed "12" reads "12123456" and a plain clamp keeps "121234". The inserted run is recovered
     * by stripping what was already there from both ends; if it alone is a full code, it wins.
     */
    const apply = (raw: string) => {
      const incoming = raw.replace(/\D/g, '');
      let head = 0;
      while (head < digits.length && incoming[head] === digits[head]) head += 1;
      const inserted = incoming.slice(head, incoming.length - (digits.length - head));
      const clean = (inserted.length >= length ? inserted : incoming).slice(0, length);
      if (clean === digits) return;
      onChange(clean);
      /* Any CHANGE that leaves a full code completes — including one full code replacing another,
         which is the retry after a failed verify. A parent holding a full value is not asked
         twice: an unchanged code returned above. */
      if (clean.length === length) onComplete?.(clean);
    };

    /* The caret lives at the end. The input spans the whole row, so a tap or an arrow key could
       otherwise park it mid-code, where typing splices while the highlighted box says "next". */
    const pinCaret = (event: React.SyntheticEvent<HTMLInputElement>) => {
      const el = event.currentTarget;
      const end = el.value.length;
      /* Select-all is left alone, so Ctrl/Cmd+A then a digit or a paste replaces the code. */
      if (el.selectionStart === 0 && el.selectionEnd === end && end > 0) return;
      if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
    };

    return (
      <div className={cn('flex flex-col gap-ds-3xs', className)}>
        {labelling.visible !== undefined && (
          <label htmlFor={fieldId} className={FIELD_LABEL}>
            {labelling.visible}
          </label>
        )}
        <div className={OTP_ROW} data-filled={digits ? true : undefined}>
          {Array.from({ length }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                OTP_BOX,
                SIZE[size],
                BOX_STATE[state],
                focused && !disabled && i === Math.min(digits.length, length - 1) && OTP_BOX_ACTIVE,
              )}
            >
              {digits[i] ?? ''}
            </span>
          ))}
          <input
            ref={ref}
            id={fieldId}
            name={name}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={labelling.ariaLabel}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            value={digits}
            onChange={(event) => apply(event.target.value)}
            onSelect={pinCaret}
            onFocus={(event) => {
              setFocused(true);
              pinCaret(event);
            }}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            autoFocus={autoFocus}
            className={OTP_INPUT}
          />
        </div>
        <FieldError id={errorId} message={error} />
      </div>
    );
  },
);

OtpInput.displayName = 'OtpInput';
