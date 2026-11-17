'use client';

import React from 'react';
import { DayPicker } from 'react-day-picker';
import { contract } from '../../contract';
import { cn, FOCUS_RING, useMergedRef, useQuietFocus } from '../../utils';
import { A2UI_BOX_BASE, A2UI_BOX_CONTROL, A2UI_BOX_STATE } from '../a2ui-classes';
import { BOX_BASE, BOX_CONTROL, BOX_SIZE, BOX_STATE } from '../field-classes';
import { Label } from '../Label';
import { Icon } from '../Icon';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../Popover';
import {
  FieldError,
  resolveLabelling,
  useFieldIds,
  type LabelledProps,
} from '../field-support';
import {
  formatDisplayDate,
  formatIsoDate,
  formatIsoDateTime,
  parseIsoDate,
  parseIsoDateTime,
} from '../../shared/date-input';

type Axes = typeof contract.DateTimeInput.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * The shared table, re-tied to THIS component's own size axis. Moving the classes out of the
 * file cost the `satisfies` link to the contract; asserting it here buys it back, so adding a
 * size to the entry reddens the table rather than silently rendering unsized.
 */
const SIZE = BOX_SIZE satisfies Record<Of<'size'>, string>;


  /**
   * EVERY slot the calendar needs, not just the leaves.
   *
   * react-day-picker v9 injects no stylesheet of its own, and this package ships
   * SOURCE — so importing its CSS would put a stylesheet import in every
   * consumer's bundler path. Styling the layout slots from tokens instead keeps
   * the calendar self-contained. Naming only the leaves left the month grid,
   * header and nav completely unstyled, and nothing could see it: the tests query
   * by role and the Storybook preview loads only our own two stylesheets.
   */
  
const CALENDAR_CLASSES = {
  months: 'relative',
  month: 'flex flex-col gap-ds-2xs',
  month_caption: 'flex h-8 items-center justify-center',
  caption_label: 'text-ds-body-lg-mobile font-semibold text-default-primary',
  nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
  button_previous:
    'inline-flex h-7 w-7 items-center justify-center rounded-ds-md text-default-secondary hover:bg-default-secondary',
  button_next:
    'inline-flex h-7 w-7 items-center justify-center rounded-ds-md text-default-secondary hover:bg-default-secondary',
  chevron: 'h-4 w-4 fill-current',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  weekday: 'w-8 text-ds-body-md-mobile font-normal text-default-secondary',
  week: 'flex w-full',
  /* `w-8`, the weekday header's width: an empty cell before the 1st carries no button, so
     without it the cell collapses and the month starts in the Sunday column. */
  day: 'w-8 p-0 text-center text-ds-body-lg-mobile text-default-primary',
  day_button:
    'inline-flex h-8 w-8 items-center justify-center rounded-ds-sm hover:bg-weak-brand',
  /**
   * THE SELECTION PAINTS THE BUTTON, NOT THE CELL AROUND IT (UMK-1091).
   *
   * `selected` lands on the day CELL while `day_button`'s hover lands on the
   * button inside it, so the hover tint painted over the selection fill and a
   * selected day went pale under the pointer — the reported bug, and a stacking
   * problem rather than a colour one. Reaching through to the button puts both
   * rules on one element; the hover arm here is more specific than the plain
   * `hover:` on `day_button`, so it wins without an `!important`.
   *
   * Figma `Date` 789:3310 `State=Clicked`: `#0074E7`, white text, a 6px radius.
   */
  /* `day-selected` is a MARKER, not a utility — it carries no rule of its own and
     exists so `today` below can scope itself out of a selected day. Without it the
     two ink rules are the same specificity on the same element and emission order
     decides, which on a selected day painted brand ink on the brand fill. */
  selected:
    'day-selected [&>button]:bg-default-brand [&>button]:text-default-invert [&>button]:hover:bg-default-brand',
  /**
   * EVERY INK RULE REACHES THE BUTTON TOO, for the same reason the selection does.
   *
   * These land on the day CELL, which already carries `text-default-primary` from
   * `day` above. Two plain classes on one element is a tie CSS breaks by emission
   * order — and `apps/main-website` compiles this with `important: true`, so both
   * sides are `!important` and specificity cannot break the tie either. That order
   * is the key order of the GENERATED token preset, which a future export may
   * reshuffle: a disabled day would then paint at full strength with every class
   * still resolving and every test still green.
   *
   * Setting the colour on the button instead of inheriting it removes the tie
   * altogether — a direct declaration always beats an inherited one, whatever the
   * order. Same shape as the selection fix below it.
   *
   * `today` is ink only. Figma's `State=Today` changes the colour and NOTHING else;
   * the bold was ours, and it made a day that is both today and selected read as a
   * different shape from every other selected day.
   *
   * IT ALSO SCOPES ITSELF OUT OF A SELECTED DAY. Today's ink and the selection's ink
   * are the same specificity on the same element, so the winner was emission order in
   * the generated preset — where `default-brand` follows `default-invert`, so brand
   * ink won and sat on the brand selection fill: the date number vanished. Ordinary
   * to reach (open the picker with today already chosen), and it survived the base
   * commit, where both arms were bare classes on the cell carrying the identical tie.
   * `:not()` removes the rule rather than out-ranking it, so no emission order and no
   * `important: true` can bring the collision back.
   */
  today: '[&:not(.day-selected)>button]:text-default-brand',
  outside: '[&>button]:text-default-secondary',
  /** Figma's `State=Disable` is `#93A2B0`, which is exactly `text-default-secondary`. */
  disabled: '[&>button]:text-default-secondary',
  hidden: 'invisible',
  /* Range mode (UMK-1185). The ends take the selection's fill through `selected` above; the
     days between them are tinted, so the span reads as one run. */
  range_middle: '[&>button]:bg-weak-brand [&>button]:text-default-primary [&>button]:rounded-none',
};

/** Range mode's two months: side by side from `md`, one month below it. */
const RANGE_MONTHS = 'relative flex gap-ds-md [&>div+div]:hidden md:[&>div+div]:flex';

/** An inclusive pair of `YYYY-MM-DD` days. */
export interface DateTimeInputRange {
  from: string;
  to: string;
}

/** A one-click value offered in the calendar. `value` is called at click time, so "now" is now. */
export interface DateTimeInputPreset {
  label: string;
  value: () => string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * WHAT THE BOX SHOWS (UMK-955): a plain date reads `dd/mm/yyyy`, the day-first form an Indonesian user
 * types. DISPLAY AND TYPING ONLY - `value`/`onValueChange` still speak `YYYY-MM-DD`, and the shared value
 * rule (`shared/date-input.ts`, which native reads too) is untouched. A date with a time and a range keep
 * their ISO text.
 */
const DISPLAY_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const toDisplayDate = (iso: string) => {
  const date = parseIsoDate(iso);
  return date ? formatDisplayDate(date) : iso;
};
/** `undefined` for anything that is not a real `dd/mm/yyyy` day; `''` stays `''`. */
const fromDisplayDate = (text: string): string | undefined => {
  if (text === '') return '';
  const m = DISPLAY_DATE.exec(text);
  if (!m) return undefined;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return parseIsoDate(iso) ? iso : undefined;
};

/**
 * Open like its five siblings. A closed props interface left this the only control of the
 * six that could not take a `name` — so a plain form submitted without the date — nor a
 * `ref`, an `autoComplete` or a test id. `value`/`defaultValue`/`onChange` are dropped
 * because this component speaks ISO strings through `onValueChange` instead.
 *
 * A type alias rather than an interface: an interface cannot extend a union, and the
 * labelling pair IS a union (see `LabelledProps`). `aria-label` is omitted from the DOM
 * attributes first, or the inherited optional widens the arm that requires it straight back
 * into an optional.
 */
export type DateTimeInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type' | 'value' | 'defaultValue' | 'onChange' | 'aria-label'
> &
  LabelledProps & {
    size?: Of<'size'>;
    /** The caption's size, independent of the box: Figma draws a Large field's caption at 14/20 and a Small one's at 12/18. Defaults to the field's own `size`. Web only. */
    labelSize?: Of<'size'>;
    /** `a2ui` is the agent surface's pre-library look (UMK-1307); only its adapter passes it. */
    appearance?: Of<'appearance'>;
    error?: string;
    /** ISO `YYYY-MM-DD`; `HH:mm` with `timeOnly`. */
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    min?: string;
    max?: string;
    /** Render the calendar into `document.body` — see `PopoverContent`'s `portal`. */
    portal?: boolean;
  } & (
    | {
        selection?: Exclude<Of<'selection'>, 'range'>;
        /**
         * The value becomes `YYYY-MM-DDTHH:mm`, LOCAL time with no zone, and the calendar gains
         * hour and minute fields. A caller sending it to a server as UTC converts it itself.
         */
        withTime?: boolean;
        /**
         * UMK-1383. A time-of-day field: the platform `<input type="time">` inside the field box,
         * value `HH:mm`. No calendar, so `withTime`, `presets`, `min` and `max` do not apply.
         */
        timeOnly?: boolean;
        /** One-click values shown in the calendar. Each returns the field's own value format. */
        presets?: readonly DateTimeInputPreset[];
        rangeValue?: never;
        defaultRangeValue?: never;
        onRangeChange?: never;
      }
    | {
        /**
         * Pick a span. The calendar keeps a DRAFT: nothing is emitted until Apply, and closing
         * without Apply leaves the committed range as it was. Apply on an emptied draft emits
         * `undefined`.
         */
        selection: Extract<Of<'selection'>, 'range'>;
        /** Controlled. Omit it and pass `defaultRangeValue` to let the field hold its own range. */
        rangeValue?: DateTimeInputRange;
        defaultRangeValue?: DateTimeInputRange;
        onRangeChange?: (value: DateTimeInputRange | undefined) => void;
        withTime?: never;
        timeOnly?: never;
        presets?: never;
        value?: never;
        defaultValue?: never;
        onValueChange?: never;
      }
  );

/**
 * A text field with a popover calendar.
 *
 * TYPING IS A REQUIRED AFFORDANCE, not a fallback — keyboard users reach for it first, which
 * is why the calendar is an addition to the input rather than a replacement for it.
 *
 * THE TRAP THIS IS BUILT AROUND: disabling dates in the calendar does not stop anyone typing
 * one. The range is enforced on the typed path too, in `commit` below; a constraint applied
 * only to the picker is decorative.
 *
 * The calendar opens on a CLICK — on the field or on its own control — never on focus alone.
 * Opening on focus is a known weakness of the reference implementation that they intend to
 * replace; a Tab through the form must not throw a calendar over it. A click on the field
 * leaves focus in the field, so the typing affordance survives the calendar opening.
 *
 * The platform picker is the right answer away from the browser, which makes the native sibling
 * (`native/DateTimeInput.tsx`, UMK-1128) a design decision rather than a port of this file —
 * recorded as a divergence on the contract entry. What the two SHARE is the value: both parse and
 * emit through `shared/date-input.ts`.
 */
export const DateTimeInput = React.forwardRef<HTMLInputElement, DateTimeInputProps>((
  {
    label,
    'aria-label': ariaLabel,
    id,
    size = 'large',
    labelSize,
    appearance = 'default',
    error,
    disabled,
    required,
    value,
    defaultValue = '',
    onValueChange,
    min,
    max,
    portal,
    selection = 'single',
    rangeValue: rangeProp,
    defaultRangeValue,
    onRangeChange,
    withTime,
    timeOnly,
    presets,
    className,
    name,
    ...props
  },
  ref,
) => {
  const { fieldId, errorId } = useFieldIds(id);
  const labelling = resolveLabelling(label, ariaLabel);
  /**
   * TWO pieces of state, not one. `draft` is whatever is in the box mid-typing; `committed`
   * is the last value that passed. Collapsing them makes a rejected value its own fallback —
   * the field would revert to exactly what it just refused.
   */
  const [committed, setCommitted] = React.useState(defaultValue);
  const accepted = value ?? committed;
  /* The agent surface's `a2ui` look keeps its ISO text: it reproduces the pre-library field value for value. */
  const dmy = !withTime && selection !== 'range' && appearance !== 'a2ui';
  const show = (iso: string) => (dmy ? toDisplayDate(iso) : iso);
  const [draft, setDraft] = React.useState(show(accepted));
  React.useEffect(() => setDraft(dmy ? toDisplayDate(accepted) : accepted), [accepted, dmy]);
  const quiet = useQuietFocus();
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const openedFromField = React.useRef(false);
  /** The popover needs the element to return focus to, and the caller may also want it. */
  const setInputRef = useMergedRef(inputRef, ref);

  const lower = min ? parseIsoDate(min) : undefined;
  const upper = max ? parseIsoDate(max) : undefined;
  /* By DAY: `min`/`max` are dates, so a time on the bound's own day is inside it. */
  const inRange = (date: Date) => {
    const day = parseIsoDate(formatIsoDate(date))!;
    return !(lower && day < lower) && !(upper && day > upper);
  };
  const parse = withTime ? parseIsoDateTime : parseIsoDate;
  const format = withTime ? formatIsoDateTime : formatIsoDate;
  const isRange = selection === 'range';

  /* Range mode's draft, reset from the committed range each time the calendar opens. */
  const [rangeDraft, setRangeDraft] = React.useState<{ from?: Date; to?: Date }>({});
  /* Controlled or not, like the single value: the committed range is the prop when one is
     passed, else the field's own. Without the uncontrolled arm, Clear and Apply on a field
     nobody wired an owner to changed nothing. */
  const [ownRange, setOwnRange] = React.useState(defaultRangeValue);
  const rangeValue = rangeProp ?? ownRange;
  const commitRange = (next: DateTimeInputRange | undefined) => {
    setOwnRange(next);
    onRangeChange?.(next);
  };
  const openCalendar = (next: boolean) => {
    if (next && isRange)
      setRangeDraft({
        from: rangeValue ? parseIsoDate(rangeValue.from) : undefined,
        to: rangeValue ? parseIsoDate(rangeValue.to) : undefined,
      });
    setOpen(next);
  };
  const applyRange = () => {
    const { from, to } = rangeDraft;
    commitRange(from ? { from: formatIsoDate(from), to: formatIsoDate(to ?? from) } : undefined);
    setOpen(false);
  };
  const rangeText = rangeValue ? `${rangeValue.from} – ${rangeValue.to}` : '';

  const commit = (next: string) => {
    const parsed = parse(next);
    /* An out-of-range or unparseable typed value is refused, not stored — the same rule the
       calendar enforces by greying the day out. */
    const ok = next === '' || Boolean(parsed && inRange(parsed));
    /* In the CONTROLLED path the owner decides, so the box may only show what it has
       accepted. Echoing `next` locally would leave the field displaying a value its owner
       refused, and `accepted` would not have changed — so the sync effect never fires and
       the mismatch is permanent. */
    const settled = value !== undefined ? accepted : ok ? next : accepted;
    setDraft(show(settled));
    if (ok) {
      if (value === undefined) setCommitted(next);
      onValueChange?.(next);
    }
  };

  const selected = parse(accepted);
  const filled = isRange ? Boolean(rangeValue) : Boolean(accepted);
  const state = disabled ? 'disabled' : error ? 'error' : filled ? 'filled' : 'default';

  /** A day picked in single mode keeps the time already chosen, and stays open to set one. */
  const pickDay = (date: Date) => {
    if (withTime) {
      date.setHours(selected?.getHours() ?? 0, selected?.getMinutes() ?? 0);
      commit(format(date));
      return;
    }
    commit(format(date));
    setOpen(false);
  };
  const setTime = (part: 'hours' | 'minutes', raw: string) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > (part === 'hours' ? 23 : 59)) return;
    const base = selected ? new Date(selected) : new Date(new Date().setHours(0, 0, 0, 0));
    if (part === 'hours') base.setHours(n);
    else base.setMinutes(n);
    commit(format(base));
  };
  const disabledDays = [...(lower ? [{ before: lower }] : []), ...(upper ? [{ after: upper }] : [])];

  if (timeOnly) {
    const a2ui = appearance === 'a2ui';
    return (
      <div className="flex w-full flex-col gap-ds-3xs">
        {labelling.visible !== undefined && (
          <Label htmlFor={fieldId} look={`field-${labelSize ?? size}`} required={required}>
            {labelling.visible}
          </Label>
        )}
        <div
          {...quiet}
          className={
            a2ui
              ? cn(A2UI_BOX_BASE, A2UI_BOX_STATE[state], className)
              : cn(BOX_BASE, SIZE[size], BOX_STATE[state], FOCUS_RING.field, className)
          }
        >
          <input
            {...props}
            name={name}
            ref={setInputRef}
            id={fieldId}
            type="time"
            disabled={disabled}
            required={required}
            aria-label={labelling.ariaLabel}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            value={accepted}
            onChange={(e) => {
              if (value === undefined) setCommitted(e.target.value);
              onValueChange?.(e.target.value);
            }}
            className={a2ui ? A2UI_BOX_CONTROL : BOX_CONTROL}
          />
        </div>
        <FieldError id={errorId} message={error} size={size === 'large' ? 'large' : 'small'} />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-ds-3xs">
      {labelling.visible !== undefined && (
        <Label htmlFor={fieldId} look={`field-${labelSize ?? size}`} required={required}>
          {labelling.visible}
        </Label>
      )}

      <Popover open={open} onOpenChange={openCalendar}>
        {/* The whole box anchors the panel, so a click on the field or the icon opens it under
            the same edge. */}
        <PopoverAnchor asChild>
        <div
          {...quiet}
          ref={boxRef}
          data-filled={filled || undefined}
          className={
            appearance === 'a2ui'
              ? cn(A2UI_BOX_BASE, A2UI_BOX_STATE[state], className)
              : cn(BOX_BASE, SIZE[size], BOX_STATE[state], FOCUS_RING.field, className)
          }
        >
          <input
            {...props}
            /* Day-first, the box holds `dd/mm/yyyy`; a form must post the ISO value, so `name` moves
               to a hidden input below instead. */
            name={dmy ? undefined : name}
            ref={setInputRef}
            id={fieldId}
            type="text"
            inputMode="numeric"
            placeholder={isRange ? 'YYYY-MM-DD – YYYY-MM-DD' : withTime ? 'YYYY-MM-DDTHH:mm' : dmy ? 'dd/mm/yyyy' : 'YYYY-MM-DD'}
            /* A range is picked, never typed: two dates in one box is a format nobody types. */
            readOnly={isRange || undefined}
            disabled={disabled}
            required={required}
            aria-label={labelling.ariaLabel}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            value={isRange ? rangeText : draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={() => {
              if (disabled || open) return;
              openedFromField.current = true;
              openCalendar(true);
            }}
            onBlur={(e) => {
              if (isRange) return;
              if (!dmy) return commit(e.target.value);
              /* Typed day-first; an unreal date is refused exactly like an unreal ISO one (the box reverts). */
              const iso = fromDisplayDate(e.target.value);
              if (iso === undefined) setDraft(show(accepted));
              else commit(iso);
            }}
            className={appearance === 'a2ui' ? A2UI_BOX_CONTROL : BOX_CONTROL}
          />
          {dmy && name && <input type="hidden" name={name} value={accepted} disabled={disabled} />}

          {(isRange ? rangeText : draft) && !disabled && (
            <button
              type="button"
              aria-label="Kosongkan tanggal"
              onClick={() => (isRange ? commitRange(undefined) : commit(''))}
              className="shrink-0 text-default-secondary hover:text-default-primary"
            >
              <Icon name="x" size="sm" />
            </button>
          )}

          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Buka kalender"
              disabled={disabled}
              className="shrink-0 text-default-secondary hover:text-default-primary"
            >
              <Icon name="calendar" size="md" />
            </button>
          </PopoverTrigger>
        </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          portal={portal}
          onOpenAutoFocus={(e) => {
            /* Opened from the field: focus stays where the user is typing. */
            if (openedFromField.current) e.preventDefault();
            openedFromField.current = false;
          }}
          onInteractOutside={(e) => {
            /* The field is outside the panel but is not "elsewhere": a click on it must not
               close the calendar only for its own click to reopen it. */
            if (boxRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            /* Escape and an outside click both land here. Focus goes back to the field
               rather than to the trigger, so the typing affordance stays one key away. */
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          {isRange ? (
            <>
              <DayPicker
                mode="range"
                numberOfMonths={2}
                selected={rangeDraft.from ? { from: rangeDraft.from, to: rangeDraft.to } : undefined}
                defaultMonth={rangeDraft.from}
                startMonth={lower}
                endMonth={upper}
                disabled={disabledDays}
                /* Draft only: nothing leaves the component until Apply. */
                onSelect={(range) => setRangeDraft({ from: range?.from, to: range?.to })}
                classNames={{ ...CALENDAR_CLASSES, months: RANGE_MONTHS }}
              />
              <div className="mt-ds-2xs flex justify-end gap-ds-2xs">
                <button
                  type="button"
                  onClick={() => setRangeDraft({})}
                  className="rounded-ds-md px-ds-sm py-ds-4xs text-ds-body-lg-mobile text-default-secondary hover:bg-default-secondary"
                >
                  Hapus
                </button>
                <button
                  type="button"
                  onClick={applyRange}
                  disabled={Boolean(rangeDraft.from) !== Boolean(rangeDraft.to)}
                  className="rounded-ds-md bg-default-brand px-ds-sm py-ds-4xs text-ds-body-lg-mobile text-default-invert disabled:opacity-50"
                >
                  Terapkan
                </button>
              </div>
            </>
          ) : (
            <>
          <DayPicker
            mode="single"
            selected={selected}
            /* `defaultMonth`, NOT `month`. A defined `month` makes the calendar CONTROLLED,
               and without an `onMonthChange` it is then inert — so opening the picker on a
               field that already holds a date pinned the view and the prev/next buttons did
               nothing. The empty-field case passes `undefined` and worked, which is exactly
               why no test caught it. */
            defaultMonth={selected}
            startMonth={lower}
            endMonth={upper}
            disabled={disabledDays}
            onSelect={(date) => {
              if (date) pickDay(date);
            }}
            classNames={CALENDAR_CLASSES}
          />
          {withTime && (
            <div className="mt-ds-2xs flex items-center gap-ds-3xs text-ds-body-lg-mobile text-default-primary">
              <input
                type="number"
                min={0}
                max={23}
                aria-label="Jam"
                value={pad(selected?.getHours() ?? 0)}
                onChange={(e) => setTime('hours', e.target.value)}
                className="w-12 rounded-ds-sm border border-default-primary px-ds-3xs py-ds-4xs text-center"
              />
              :
              <input
                type="number"
                min={0}
                max={59}
                aria-label="Menit"
                value={pad(selected?.getMinutes() ?? 0)}
                onChange={(e) => setTime('minutes', e.target.value)}
                className="w-12 rounded-ds-sm border border-default-primary px-ds-3xs py-ds-4xs text-center"
              />
            </div>
          )}
          {presets && presets.length > 0 && (
            <div className="mt-ds-2xs flex flex-wrap gap-ds-3xs">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    commit(preset.value());
                    setOpen(false);
                  }}
                  className="rounded-ds-md border border-default-primary px-ds-2xs py-ds-4xs text-ds-body-md-mobile text-default-primary hover:bg-default-secondary"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
            </>
          )}
        </PopoverContent>
      </Popover>

      <FieldError id={errorId} message={error} size={size === 'large' ? 'large' : 'small'} />
    </div>
  );
});

DateTimeInput.displayName = 'DateTimeInput';
