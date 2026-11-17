'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn, FOCUS_RING, useQuietFocus } from '../../utils';
import {
  BARE_BOX,
  BARE_CONTROL,
  BOX_BASE,
  BOX_CONTROL,
  BOX_HEIGHT_COMPACT,
  BOX_SIZE,
  BOX_SIZE_COMPACT,
  BOX_SIZE_XSMALL,
  BOX_STATE,
  BOX_STATE_COMPACT,
  BOX_STATE_VALID,
  FIELD_ADORNMENT,
  FIELD_COUNTER,
  FIELD_COUNTER_LARGE,
  FIELD_COUNTER_LIMIT,
  FIELD_COUNTER_LIMIT_LARGE,
  FIELD_VALID_MARK,
} from '../field-classes';
import { A2UI_BOX_BASE, A2UI_BOX_CONTROL, A2UI_BOX_STATE, A2UI_FIELD_LABEL, A2UI_FIELD_STACK } from '../a2ui-classes';
import { Icon } from '../Icon';
import { Label } from '../Label';
import { FieldError, RequiredMark, resolveLabelling, useFieldIds, type LabelledProps } from '../field-support';

type Axes = typeof contract.TextField.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * The shared table, re-tied to THIS component's own size axis. Moving the classes out of the
 * file cost the `satisfies` link to the contract; asserting it here buys it back, so adding a
 * size to the entry reddens the table rather than silently rendering unsized.
 */
const SIZE = { ...BOX_SIZE, xsmall: BOX_SIZE_XSMALL, compact: BOX_SIZE_COMPACT } satisfies Record<Of<'size'>, string>;

/**
 * Figma's `Status` is a nine-value enum — Default, Active, Filled, Filled Label, Error
 * Filled, Error Not Filled, Disable, Disable Filled, Error Disable. Those are three
 * orthogonal booleans wearing an enum, so the contract records the divergence and the
 * component composes them instead: `error` x `disabled` x hasValue.
 *
 * "Filled" is DERIVED. A caller cannot pass it, because a caller passing it wrong is the
 * only way it can ever disagree with the value in the box.
 */

/**
 * `label` XOR `aria-label`, plus ONE deliberate third shape: a visible `label` WITH an
 * `aria-label`, where the string overrides the accessible name (the a2ui adapter's required
 * marker carries its own aria-label, which would otherwise leak into the name). The control
 * still gets exactly one name — the string — and the caption is still drawn.
 */
type TextFieldLabelling =
  | LabelledProps
  | { label: React.ReactNode; 'aria-label': string };

export type TextFieldProps = TextFieldLabelling &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type' | 'onChange' | 'prefix' | 'aria-label'> & {
  /**
   * Widened on purpose: in `multiline` the event target really is a textarea, and declaring
   * it as an input would have handed every multiline caller a type that lies about what it
   * receives.
   */
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /* `label` XOR `aria-label` (LabelledProps): a name is still never optional, but a surface with no
     visible caption (a search box, a "lainnya" free-text) may give it as a string instead. */
  size?: Of<'size'>;
  /** The caption's size, independent of the box: Figma draws a Large field's caption at 14/20 and a Small one's at 12/18. Defaults to the field's own `size`. Web only. */
  labelSize?: Of<'size'>;
  /**
   * `a2ui` is the agent surface's pre-library look (UMK-1307); only its adapter passes it.
   * `bare` (UMK-955) drops ALL the chrome - border, fill, padding, radius, focus ring and the size's type -
   * for a field that sits inside a surface of its own (the chat composer, an expandable card). The type is
   * then the caller's `className` on the box, which the control inherits.
   */
  appearance?: Of<'appearance'>;
  /**
   * The value passed validation (UMK-955). Figma publishes no Success state, so this is the nearest token:
   * a success border and a trailing tick (the tick yields to a `trailingAdornment`). `error` and
   * `disabled` win over it. A flag the caller computes - the field never validates anything itself.
   */
  valid?: boolean;
  /**
   * `disabled` means "this cannot be changed": the grey Disable Filled box with the value at full ink; it is
   * not focusable and not submitted. `readOnly` means "selectable and copyable" and keeps the plain filled
   * look. There is no third state.
   *
   * Multiline only. `false` removes the drag handle (`resize-none`); `autoResize` and `bare` imply it.
   */
  resize?: boolean;
  /**
   * Where `showCounter` draws `used / limit`: `below` the box (default) or `inside` it, in a row under the
   * control at the box's right edge, 10px. Works on a single-line field too.
   */
  counterPlacement?: Of<'counterPlacement'>;
  /**
   * Where `prefix` sits: `inside` the box (default) or `outside`, in its OWN box to the left that shares the
   * field's border and mirrors its error / valid / disabled state - the old two-box phone field.
   */
  prefixPlacement?: Of<'prefixPlacement'>;
  /**
   * The message itself, not a flag. Rendering is unconditional — see `FieldError` for why the
   * region has to exist before the text lands in it.
   */
  error?: string;
  /** Renders a textarea. A prop, not a second component: it changes the element, not the look. */
  multiline?: boolean;
  rows?: number;
  /**
   * Grows the textarea with its content, up to `maxRows` (then it scrolls). Multiline only;
   * ignored on a single-line field.
   */
  autoResize?: boolean;
  maxRows?: number;
  /**
   * Plain props, not contract booleans (KTD4). `readOnly` has no distinct styling in the
   * reference design system, and the reveal affordance is not a visual variant.
   */
  type?: React.HTMLInputTypeAttribute;
  showReveal?: boolean;
  /**
   * An INTERACTIVE slot inside the box, before the adornment and the input (UMK-1186) — a
   * country picker in front of a phone number. Unlike `leadingAdornment` it is NOT hidden
   * from assistive technology, because a control inside it must stay reachable; its
   * accessible name is the caller's. Order when both are set: prefix, adornment, input.
   */
  prefix?: React.ReactNode;
  /**
   * Slots inside the box, before and after the control.
   *
   * PLAIN PROPS, not contract booleans (KTD13, and slice 2's KTD4 before it): a contract
   * boolean is a visual variant, and "there is a currency symbol here" is content. The
   * contract's own guard pins `booleans` to `['error','disabled']` by exact equality, so
   * adding to it would fail — but the reason is the rule, not the lock.
   *
   * DECORATIVE BY DEFAULT. An adornment that is interactive is the caller's own element and
   * the caller owns its accessible name; this component will not invent one.
   */
  leadingAdornment?: React.ReactNode;
  trailingAdornment?: React.ReactNode;
  /**
   * Shows `used / limit` under the box. DRIVEN BY `maxLength`, never by its own number — two
   * sources for one limit is how a counter ends up saying 200 while the field stops at 180.
   * Passing it without a `maxLength` renders nothing rather than a half-counter.
   */
  showCounter?: boolean;
  /** Escape hatch for a2ui, whose journey authors supply a border colour Tailwind cannot see. */
  accentColor?: string;
};

export const TextField = React.forwardRef<HTMLInputElement | HTMLTextAreaElement, TextFieldProps>(
  (
    {
      label,
      'aria-label': ariaLabel,
      id,
      size = 'large',
      labelSize,
      appearance = 'default',
      valid,
      resize = true,
      counterPlacement = 'below',
      prefixPlacement = 'inside',
      error,
      disabled,
      required,
      multiline,
      rows = 3,
      autoResize,
      maxRows,
      type = 'text',
      showReveal = true,
      prefix,
      leadingAdornment,
      trailingAdornment,
      showCounter,
      maxLength,
      accentColor,
      className,
      value,
      defaultValue,
      onChange,
      ...props
    },
    ref,
  ) => {
    const { fieldId, errorId } = useFieldIds(id);
    const labelling = resolveLabelling(label, ariaLabel);
    const accessibleName = ariaLabel;
    const [revealed, setRevealed] = React.useState(false);
    /**
     * The LENGTH, not a dirty flag: the counter needs the number and "is it filled" is
     * derivable from it, where the reverse is not. Tracked rather than read off the DOM so an
     * uncontrolled field still knows both.
     */
    const [typed, setTyped] = React.useState(() => String(defaultValue ?? '').length);
    const length = value !== undefined ? String(value).length : typed;
    const filled = length > 0;
    const counterId = `${fieldId}-counter`;
    const counting = Boolean(showCounter && maxLength !== undefined);
    const atLimit = counting && length >= Number(maxLength);

    const area = React.useRef<HTMLTextAreaElement | null>(null);
    const grow = React.useCallback(() => {
      const el = area.current;
      if (!el || !autoResize) return;
      el.style.height = 'auto';
      const cap = maxRows ? parseFloat(getComputedStyle(el).lineHeight) * maxRows || Infinity : Infinity;
      el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
      el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
    }, [autoResize, maxRows]);
    React.useLayoutEffect(grow, [grow, value, length]);

    const isPassword = type === 'password';
    const state = disabled ? 'disabled' : error ? 'error' : valid ? 'valid' : filled ? 'filled' : 'default';
    /* The agent surface's own table has no `valid`: it is Figma-less there too. */
    const a2uiState = state === 'valid' ? (filled ? 'filled' : 'default') : state;

    /* The compact box's two rest states take the n40 border; error, valid, focus and disabled keep theirs. */
    const compactRest = size === 'compact' && (state === 'default' || state === 'filled') ? state : undefined;
    const boxState = state === 'valid' ? BOX_STATE_VALID : BOX_STATE[state];
    const a2ui = appearance === 'a2ui';
    const bare = appearance === 'bare';
    const controlClass = a2ui ? A2UI_BOX_CONTROL : bare ? BARE_CONTROL : BOX_CONTROL;
    /* Helper-row type follows Figma's two tiers: Large 12/18, everything smaller 10/16. */
    const tier = size === 'large' ? 'large' : 'small';
    const inside = counting && counterPlacement === 'inside' && !a2ui && !bare;
    const outsidePrefix =
      prefixPlacement === 'outside' && prefix !== undefined && prefix !== null && !a2ui && !bare;
    const quiet = useQuietFocus();

    const shared = {
      id: fieldId,
      disabled,
      required,
      'aria-label': accessibleName,
      'aria-invalid': error ? true : undefined,
      /* Both regions, space-joined. Replacing the error pointer with the counter's would trade
         the one association this component exists to make un-forgettable for a nicety. */
      'aria-describedby': [errorId, counting && counterId, props['aria-describedby']].filter(Boolean).join(' '),
      maxLength,
      className: controlClass,
      value,
      defaultValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
        setTyped(e.target.value.length);
        onChange?.(e);
      },
    };

    const hasSlot = (node: React.ReactNode) => node !== undefined && node !== null;
    const boxSize = inside ? SIZE[size].replace(/\bgap-\S+\s*/, '').trim() : SIZE[size];
    const rowGap = inside ? (SIZE[size].match(/\bgap-\S+/)?.[0] ?? '') : '';

    const counter = counting && (
      /* Not a live region. Announcing a new count on every keystroke is noise; the value
         is reachable on focus because the control points at it through
         `aria-describedby`. */
      <span
        id={counterId}
        className={
          inside || tier === 'small'
            ? atLimit
              ? FIELD_COUNTER_LIMIT
              : FIELD_COUNTER
            : atLimit
              ? FIELD_COUNTER_LIMIT_LARGE
              : FIELD_COUNTER_LARGE
        }
      >
        {`${length}/${maxLength}`}
      </span>
    );

    const row = (
      <>
        {hasSlot(prefix) && !outsidePrefix && (
          <span data-field-prefix className="flex shrink-0 items-center">
            {prefix}
          </span>
        )}

        {hasSlot(leadingAdornment) && (
          <span aria-hidden className={FIELD_ADORNMENT}>
            {leadingAdornment}
          </span>
        )}

        {multiline ? (
          <textarea
            /* Caller props FIRST. Spread last, a caller-supplied `aria-describedby` would
               silently replace the pointer at the error region — the one association this
               component exists to make un-forgettable. The other five spread in this
               order already. */
            {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            {...(shared as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            ref={(node) => {
              area.current = node;
              if (typeof ref === 'function') ref(node);
              else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
            }}
            rows={rows}
            className={cn(controlClass, a2ui || bare || autoResize || !resize ? 'resize-none' : 'resize-y')}
          />
        ) : (
          <input
            {...props}
            {...shared}
            ref={ref as React.Ref<HTMLInputElement>}
            type={isPassword && revealed ? 'text' : type}
          />
        )}

        {/* THE TRAILING SLOT AND THE REVEAL CO-EXIST; they do not replace one another.
            Absorbing would mean a caller adding a currency symbol silently removes the
            password toggle, which is a behaviour change disguised as a layout prop. Both sit
            in the box's flex row in a fixed order — the reveal stays closest to the edge,
            where a caller of a password field expects to find it — so there is never a
            second independently-positioned element to collide with. */}
        {hasSlot(trailingAdornment) ? (
          <span aria-hidden className={FIELD_ADORNMENT}>
            {trailingAdornment}
          </span>
        ) : (
          state === 'valid' &&
          !a2ui &&
          !bare && (
            <span aria-hidden className={FIELD_VALID_MARK}>
              <Icon name="check" size="md" />
            </span>
          )
        )}

        {isPassword && showReveal && !multiline && (
          <button
            type="button"
            /* The absorbed `PasswordInput` shipped this toggle with no accessible name at
               all — a bare icon button announcing as "button". Fixed while absorbing. */
            aria-label={revealed ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
            aria-pressed={revealed}
            onClick={() => setRevealed((v) => !v)}
            disabled={disabled}
            className="shrink-0 text-default-secondary hover:text-default-primary"
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} size="md" />
          </button>
        )}
      </>
    );

    const box = (
      <div
        {...quiet}
        data-filled={filled || undefined}
        className={
          a2ui
            ? cn(A2UI_BOX_BASE, A2UI_BOX_STATE[a2uiState], className)
            : bare
              ? cn(BARE_BOX, className)
              : cn(
                  BOX_BASE,
                  boxSize,
                  boxState,
                  compactRest && BOX_STATE_COMPACT[compactRest],
                  size === 'compact' && BOX_HEIGHT_COMPACT[multiline ? 'multiline' : 'single'],
                  FOCUS_RING.field,
                  inside && 'flex-col items-stretch',
                  outsidePrefix && 'min-w-0 flex-1',
                  className,
                )
        }
        style={accentColor ? { borderColor: accentColor } : undefined}
      >
        {inside ? <div className={cn('flex w-full items-center', rowGap)}>{row}</div> : row}
        {inside && counter}
      </div>
    );

    return (
      <div className={cn('group', a2ui ? cn(A2UI_FIELD_STACK, multiline && 'pb-1.5') : cn('flex w-full flex-col', size === 'compact' ? 'gap-ds-4xs' : 'gap-ds-3xs'))}>
        {labelling.visible === undefined ? null : a2ui ? (
          /* The old markup: a block label (16/24 line) around a 12/16 span, which is what gives the field its 24px label row. */
          <label htmlFor={fieldId} className="block">
            <span className={A2UI_FIELD_LABEL}>
              {labelling.visible}
              {required && <RequiredMark />}
            </span>
          </label>
        ) : (
          <Label
            htmlFor={fieldId}
            look={(labelSize ?? size) === 'large' ? 'field-large' : 'field-small'}
            className={size === 'compact' ? 'text-default-muted' : undefined}
            required={required}
          >
            {labelling.visible}
          </Label>
        )}

        {outsidePrefix ? (
          <div className="flex w-full items-stretch gap-ds-2xs">
            {/* Its OWN box: the field's border, size and state, mirrored - the old two-box phone field.
                No focus ring of its own; the ring belongs to the field. */}
            <div
              data-field-prefix
              className={cn(BOX_BASE, boxSize, boxState, 'w-auto shrink-0')}
            >
              {prefix}
            </div>
            {box}
          </div>
        ) : (
          box
        )}

        {!inside && counter}

        <FieldError id={errorId} message={error} size={tier} focusWithinParent />
      </div>
    );
  },
);

TextField.displayName = 'TextField';
