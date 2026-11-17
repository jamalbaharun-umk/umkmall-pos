'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  SELECTION_CARD,
  SELECTION_CARD_BODY,
  SELECTION_CARD_EYEBROW,
  SELECTION_CARD_GRID,
  SELECTION_CARD_HEADING,
  SELECTION_CARD_INDICATOR,
  SELECTION_CARD_INDICATOR_MARK,
  SELECTION_CARD_INDICATOR_SHAPE,
  SELECTION_CARD_INDICATOR_STATE,
  SELECTION_CARD_INPUT,
  SELECTION_CARD_LAYOUT,
  SELECTION_CARD_TILE_BADGE,
  SELECTION_CARD_TILE_SIZE,
  SELECTION_CARD_TILE_TEXT,
  SELECTION_CARD_ROW,
  SELECTION_CARD_SIZE,
  SELECTION_CARD_STATE,
  FIELD_LABEL,
} from '../field-classes';
import { resolveLabelling, useFieldIds, type LabelledProps } from '../field-support';
import {
  CHOICE_BODY,
  CHOICE_CARD,
  CHOICE_DISABLED,
  CHOICE_EYEBROW,
  CHOICE_HEADING,
  CHOICE_ICON,
  CHOICE_ROW,
  CHOICE_STATE,
  CHOICE_TEXT,
  CHOICE_TITLE,
  CHOICE_TOP,
} from '../selection-card-choice-classes';

type Axes = typeof contract.SelectionCard.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const SIZE = SELECTION_CARD_SIZE satisfies Record<Of<'size'>, string>;
const STATE = SELECTION_CARD_STATE satisfies Record<Of<'state'>, string>;
const LAYOUT = SELECTION_CARD_LAYOUT satisfies Record<Of<'layout'>, string>;
const TILE_SIZE = SELECTION_CARD_TILE_SIZE satisfies Record<Of<'size'>, string>;

/**
 * The option shape, taken from the agent surface's own catalog types rather than from
 * preference — `{ label, value, icon?, description?, badge? }`. A field this component invents
 * is a field no payload can supply.
 */
export interface SelectionCardOption {
  label: React.ReactNode;
  value: string;
  icon?: React.ReactNode;
  description?: string;
  badge?: React.ReactNode;
  /**
   * Extra content drawn inside the option's card, below the description (UMK-1537). Unset, the
   * card renders exactly as it did before; set, it is one more child of the text column, in every
   * appearance and in activation mode. It is part of the option's label, so keep it non-interactive.
   */
  detail?: React.ReactNode;
}

export type SelectionCardProps = LabelledProps & {
  options: readonly SelectionCardOption[];
  /**
   * ALWAYS AN ARRAY, single-select included.
   *
   * A single-select that emitted a bare string and a multi-select that emitted an array would
   * be two return shapes behind one prop, and every consumer would branch on the mode to read
   * its own value. Single-select emits a one-element array.
   */
  value?: readonly string[];
  onValueChange?: (value: string[]) => void;
  /** Multi-select renders checkboxes; single-select renders radios. */
  multiple?: boolean;
  size?: Of<'size'>;
  /**
   * `row` (default): icon left, the control hidden. `tile`: a centred stack with the control drawn
   * in the top-right corner. The input is still the real one, hidden, so the semantics, the arrow
   * keys and the focus ring are unchanged; the corner mark is its picture (UMK-1218).
   */
  layout?: Of<'layout'>;
  disabled?: boolean;
  /** Multi-select only. At `value.length >= maxSelect` every UNSELECTED option is disabled; selected
      ones stay enabled so they can be cleared. Ignored in single-select or when not a positive integer. */
  maxSelect?: number;
  /** Renders the split description's title and body. Default: the string itself. */
  renderText?: (text: string) => React.ReactNode;
  /** 1 (default): a stacked column. 2: one column on a narrow screen, two from `sm` up. */
  columns?: 1 | 2;
  /**
   * `default`: the library's look. `choice`: the agent surface's pre-library option cards, reproduced
   * value for value (UMK-1296) — a named appearance, never a set of overrides. Row layout only; it
   * always lays out two columns from `sm` up, so `columns` does not apply to it.
   */
  appearance?: Of<'appearance'>;
  /**
   * ACTIVATION, NOT SELECTION: every option is a plain `<button>` that calls `onValueChange([value])`
   * when pressed and never holds a selected state (`value`, `multiple` and `maxSelect` are ignored).
   * A one-tap step submits an answer on the press, so it must not be a radio group: arrow keys in a
   * radio group move AND check the next radio, which would submit an answer with no press.
   */
  activation?: boolean;
  /**
   * `choice` appearance only, opt-in. A disabled group normally dims every card. With this set, the
   * SELECTED card keeps full strength and only the others dim, so a locked pick still reads as the
   * pick (UMK-1883). Unset, a disabled group looks as it always did.
   */
  emphasizeSelected?: boolean;
  /** Groups the radios. Generated when omitted, so two pickers on a page do not share a group. */
  name?: string;
  className?: string;
};

/* THE TITLE/BODY SPLIT moved to `src/shared/selection-card.ts` so the native sibling reads
   the same rule rather than a second copy of it — two implementations of one rule agree until
   they do not. Re-exported here, and from this directory's `index.ts`, so every existing
   import path still resolves and `form-controls.test.tsx` still covers it. */
import { splitDescription } from '../../shared/selection-card';

export { splitDescription };

/**
 * A group of selectable option cards.
 *
 * A REAL RADIO OR CHECKBOX INSIDE A LABEL, visually hidden. The group role, the roving focus,
 * the arrow keys and the selected state all come from the platform, and the selection reaches
 * assistive technology through the control rather than through the card's colour — which is
 * not a channel every reader has. Building this out of buttons and `aria-pressed` would mean
 * hand-writing all of that, and getting the arrow keys wrong is the usual result.
 *
 * NO CHIP RENDERING HERE. `Chip` already covers the badge-shaped affordance and says so.
 */
export const SelectionCard = React.forwardRef<HTMLFieldSetElement, SelectionCardProps>(
  (
    {
      label,
      'aria-label': ariaLabel,
      options,
      value = [],
      onValueChange,
      multiple,
      size = 'large',
      layout = 'row',
      disabled,
      maxSelect,
      renderText = (t) => t,
      columns = 1,
      appearance = 'default',
      activation,
      emphasizeSelected,
      name,
      className,
    },
    ref,
  ) => {
    const { fieldId } = useFieldIds(name);
    const labelling = resolveLabelling(label, ariaLabel);
    const selected = new Set(value);
    const capReached =
      !!multiple && Number.isInteger(maxSelect) && maxSelect! > 0 && selected.size >= maxSelect!;

    const toggle = (optionValue: string) => {
      if (!multiple) return onValueChange?.([optionValue]);
      const next = new Set(selected);
      if (next.has(optionValue)) next.delete(optionValue);
      else if (!capReached) next.add(optionValue);
      else return;
      /* Ordered by the OPTION list, not by click order — a set's iteration order would make
         the emitted array depend on what the user happened to tap first. */
      onValueChange?.(options.map((o) => o.value).filter((v) => next.has(v)));
    };

    return (
      <fieldset
        ref={ref}
        aria-label={labelling.ariaLabel}
        className={cn(appearance === 'choice' ? CHOICE_ROW : columns === 2 ? SELECTION_CARD_GRID : SELECTION_CARD_ROW, className)}
      >
        {labelling.visible !== undefined && (
          <legend className={FIELD_LABEL}>{labelling.visible}</legend>
        )}
        {options.map((option) => {
          const { title, body } = splitDescription(option.description);
          const isSelected = selected.has(option.value);
          const optionDisabled = disabled || (capReached && !isSelected);
          const state = optionDisabled ? 'disabled' : isSelected ? 'selected' : 'default';
          if (appearance === 'choice') {
            const inverted = !!title;
            const badge = option.badge !== undefined && option.badge !== null ? option.badge : null;
            const inner = (
              <>
                {option.icon !== undefined && option.icon !== null && (
                  <span aria-hidden className={CHOICE_ICON}>
                    {option.icon}
                  </span>
                )}
                <span className={CHOICE_TEXT}>
                  <span className={CHOICE_TOP}>
                    <span className={inverted ? CHOICE_EYEBROW : CHOICE_HEADING}>{option.label}</span>
                    {badge}
                  </span>
                  {inverted && <span className={CHOICE_TITLE}>{renderText(title)}</span>}
                  {body ? <span className={CHOICE_BODY}>{renderText(body)}</span> : null}
                  {option.detail !== undefined && option.detail !== null && option.detail}
                </span>
              </>
            );
            if (activation) {
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onValueChange?.([option.value])}
                  className={cn(CHOICE_CARD, CHOICE_STATE.default, disabled && CHOICE_DISABLED)}
                >
                  {inner}
                </button>
              );
            }
            return (
              <label key={option.value} className={cn(CHOICE_CARD, CHOICE_STATE[isSelected ? 'selected' : 'default'], optionDisabled && (emphasizeSelected && isSelected ? 'cursor-default' : CHOICE_DISABLED))}>
                <input
                  className={SELECTION_CARD_INPUT}
                  type={multiple ? 'checkbox' : 'radio'}
                  name={multiple ? undefined : (name ?? fieldId)}
                  value={option.value}
                  checked={isSelected}
                  disabled={optionDisabled}
                  onChange={() => toggle(option.value)}
                />
                {inner}
              </label>
            );
          }
          if (activation) {
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => onValueChange?.([option.value])}
                className={cn(SELECTION_CARD, SIZE[size], STATE[disabled ? 'disabled' : 'default'], LAYOUT.row)}
              >
                {option.icon !== undefined && option.icon !== null && <span aria-hidden>{option.icon}</span>}
                <span className="flex min-w-0 flex-1 flex-col">
                  {title !== undefined ? (
                    <>
                      <span className={SELECTION_CARD_EYEBROW}>{option.label}</span>
                      <span className={SELECTION_CARD_HEADING}>{renderText(title)}</span>
                    </>
                  ) : (
                    <span className={SELECTION_CARD_HEADING}>{option.label}</span>
                  )}
                  {body !== undefined && <span className={SELECTION_CARD_BODY}>{renderText(body)}</span>}
                  {option.detail !== undefined && option.detail !== null && option.detail}
                </span>
                {option.badge !== undefined && option.badge !== null && <span>{option.badge}</span>}
              </button>
            );
          }
          return (
            <label
              key={option.value}
              /* ONE step, selected — the tile's or the size's, never both (a `ds-` rung beside
                 another is not resolved by `cn`). */
              className={cn(SELECTION_CARD, layout === 'tile' ? TILE_SIZE[size] : SIZE[size], STATE[state], LAYOUT[layout])}
              data-layout={layout}
            >
              <input
                className={SELECTION_CARD_INPUT}
                type={multiple ? 'checkbox' : 'radio'}
                name={multiple ? undefined : (name ?? fieldId)}
                value={option.value}
                checked={isSelected}
                disabled={optionDisabled}
                onChange={() => toggle(option.value)}
              />
              {layout === 'tile' && (
                <span
                  aria-hidden
                  data-testid="selection-card-indicator"
                  className={cn(
                    SELECTION_CARD_INDICATOR,
                    SELECTION_CARD_INDICATOR_SHAPE[multiple ? 'checkbox' : 'radio'],
                    SELECTION_CARD_INDICATOR_STATE[state],
                  )}
                >
                  {isSelected && (
                    <span
                      className={cn(
                        SELECTION_CARD_INDICATOR_MARK,
                        SELECTION_CARD_INDICATOR_SHAPE[multiple ? 'checkbox' : 'radio'],
                      )}
                    />
                  )}
                </span>
              )}
              {option.icon !== undefined && option.icon !== null && (
                <span aria-hidden>{option.icon}</span>
              )}
              <span className={cn('flex min-w-0 flex-col', layout === 'tile' ? SELECTION_CARD_TILE_TEXT : 'flex-1')}>
                {/* THE INVERSION: with a split-out title, the authored label becomes the
                    eyebrow and the title becomes the heading. */}
                {title !== undefined ? (
                  <>
                    <span className={SELECTION_CARD_EYEBROW}>{option.label}</span>
                    <span className={SELECTION_CARD_HEADING}>{renderText(title)}</span>
                  </>
                ) : (
                  <span className={SELECTION_CARD_HEADING}>{option.label}</span>
                )}
                {body !== undefined && <span className={SELECTION_CARD_BODY}>{renderText(body)}</span>}
                {option.detail !== undefined && option.detail !== null && option.detail}
              </span>
              {option.badge !== undefined && option.badge !== null && (
                <span className={layout === 'tile' ? SELECTION_CARD_TILE_BADGE : undefined}>{option.badge}</span>
              )}
            </label>
          );
        })}
      </fieldset>
    );
  },
);

SelectionCard.displayName = 'SelectionCard';
