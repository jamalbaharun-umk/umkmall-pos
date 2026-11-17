'use client';

import React from 'react';
import { contract } from '../../contract';
import { canCreateOption, filterSelectOptions } from '../../shared/select';
import { cn, useMergedRef, useQuietFocus, vouchForFocus } from '../../utils';
import {
  BOX_SIZE,
  BOX_STATE,
  SELECT_DISABLED_HINT,
  SELECT_EMPTY,
  SELECT_LIST,
  SELECT_LIST_SIZE,
  SELECT_OPTION,
  SELECT_OPTION_HINT,
  SELECT_ROW_SIZE,
  SELECT_SEARCH,
  SELECT_SEARCH_INPUT,
  SELECT_TRIGGER,
} from '../field-classes';
import { FieldError, resolveLabelling, useFieldIds, type LabelledProps } from '../field-support';
import { Icon } from '../Icon';
import { Label } from '../Label';
import { Popover, PopoverAnchor, PopoverContent } from '../Popover';

type Axes = typeof contract.Select.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * THE TEXT FIELD'S OWN TABLES, not copies of them. A select trigger is the same box as a text
 * field — same padding ramp, same border states — and this file exists precisely because two
 * controls once carried byte-identical box tables in two places. Re-tied to this component's
 * axes here so a divergence between the shared table and this contract entry reddens.
 */
const SIZE = BOX_SIZE satisfies Record<Of<'size'>, string>;
const STATE = BOX_STATE satisfies Record<Of<'status'>, string>;

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
  /**
   * Secondary text rendered muted after the label — a city's province, a plan's price.
   *
   * SEARCHED ALONGSIDE THE LABEL, because a hint the user can see but not type is a trap: two
   * cities of the same name are told apart only by their province, so filtering that ignores it
   * makes them indistinguishable in exactly the case the hint exists for.
   */
  hint?: string;
  /**
   * A second column in the row at FULL weight (a ratio's platforms), where `hint` is the muted
   * trailing aside. The trigger still shows only `label`. Web only; not searched.
   */
  detail?: React.ReactNode;
}

/**
 * The value pair, discriminated on `multiple` (UMK-1185). Single mode's type is untouched, so
 * every existing caller compiles unchanged.
 */
type SelectValueProps =
  | {
      multiple?: false;
      /** The pair `Menu` lacks, and the reason this is not an extension of it. */
      value?: string;
      onValueChange?: (value: string) => void;
    }
  | {
      /** Pick several. The list stays open between picks; picking a chosen option removes it. */
      multiple: true;
      value?: readonly string[];
      onValueChange?: (value: string[]) => void;
    };

export type SelectProps = LabelledProps & SelectValueProps & {
  options: readonly SelectOption[];
  size?: Of<'size'>;
  /** The caption's size, independent of the box: Figma draws a Large field's caption at 14/20 and a Small one's at 12/18. Defaults to the field's own `size`. Web only. */
  labelSize?: Of<'size'>;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Type-to-search, as an affordance rather than a second component.
   *
   * The three live implementations are a plain select twice and a searchable one once; they
   * are one component with the search on or off, and shipping them as two would be two
   * keyboard patterns to keep in step.
   */
  showSearch?: boolean;
  /**
   * Hand filtering to the caller.
   *
   * Without it the component filters `options` itself on label and hint, which is right for a
   * list it already holds. A caller that fetches per keystroke needs the query instead — so
   * passing `onSearch` means "I own the filtering", and `options` is then rendered verbatim.
   * Making that ONE prop decide both is what stops a caller half-filtering: a component that
   * also filtered a remotely-searched list would drop rows the server deliberately returned.
   */
  onSearch?: (query: string) => void;
  /** Replaces the list body while options are in flight. Never a blank box. */
  loading?: boolean;
  loadingMessage?: string;
  /**
   * Shown under a DISABLED field to say why — "pick a province first". Not an error: it is not
   * announced as an alert and it goes away when the field becomes usable.
   */
  disabledHint?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /**
   * Offer `Tambah "<query>"` when a search matches nothing (UMK-1119). The caller creates the
   * option and returns it; the component selects it at once. The OPTIONS STAY CALLER-OWNED —
   * the component never appends to them — so the caller must add the returned option to
   * `options` itself. A rejection keeps the list open and selects nothing; surfacing the error
   * is the caller's.
   */
  onCreate?: (query: string) => SelectOption | Promise<SelectOption>;
  /** Trimmed characters before the create row appears. */
  createMinLength?: number;
  createLabel?: (query: string) => string;
  /**
   * Render the list into `document.body` — see `PopoverContent`'s `portal` for when in place
   * is clipped. Default `false`.
   */
  portal?: boolean;
  id?: string;
  className?: string;
};

/** The trigger's summary of a multi selection. */
const multiSummary = (count: number) => `${count} dipilih`;

/**
 * A value-bearing listbox.
 *
 * NO NEW DEPENDENCY, and that is a decision rather than an accident. This package declares four
 * Radix packages and NOT the select one, so adding it would reach every consumer's bundle —
 * and no guard would say so, because the native-purity check classifies that scope by prefix
 * and only walks the native entry graph, which a web-only component never enters. The keyboard
 * pattern below is about forty lines; a package for that is not worth a new edge in the
 * dependency graph. A plain native control was the first choice and cannot do the filtering
 * half of this at all.
 *
 * THE LIST RENDERS IN PLACE. A portalled list would run into the standing conflict between the
 * dialog guidance (make the parent non-modal when a child overlay opens inside it) and the
 * overlay guard (a non-modal dialog reddens). An absolutely-positioned list inside a relative
 * wrapper never poses the question.
 */
export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (props, ref) => {
    const {
      label,
      'aria-label': ariaLabel,
      options,
      size = 'large',
      labelSize,
      error,
      disabled,
      placeholder = 'Pilih',
      showSearch,
      onSearch,
      loading,
      loadingMessage = 'Memuat…',
      disabledHint,
      searchPlaceholder = 'Cari',
      emptyMessage = 'Tidak ada pilihan',
      onCreate,
      createMinLength,
      createLabel = (q) => `Tambah "${q}"`,
      portal,
      id,
      className,
    } = props;
    /* Read off `props` rather than destructured, so the discriminant keeps narrowing. */
    const values: readonly string[] = props.multiple ? (props.value ?? []) : props.value === undefined ? [] : [props.value];
    const isChosen = (v: string) => values.includes(v);
    /** Emits the new selection in the shape the caller's mode speaks. */
    const emit = (next: string) => {
      if (props.multiple) {
        props.onValueChange?.(isChosen(next) ? values.filter((v) => v !== next) : [...values, next]);
      } else {
        props.onValueChange?.(next);
      }
    };
    const { fieldId, errorId } = useFieldIds(id);
    const labelling = resolveLabelling(label, ariaLabel);
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [active, setActive] = React.useState(0);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const rootRef = React.useRef<HTMLDivElement>(null);
    /* The list, which a portalled render puts OUTSIDE `rootRef`: every "is this inside?" check
       asks both. */
    const listRef = React.useRef<HTMLDivElement>(null);
    const inside = (node: Node | null) =>
      Boolean(node && (rootRef.current?.contains(node) || listRef.current?.contains(node)));
    const listId = `${fieldId}-listbox`;
    /* The virtual cursor's id, published so assistive technology can follow a selection that
       moves while DOM focus stays on the trigger. */
    const optionId = (index: number) => `${listId}-opt-${index}`;
    /* Exactly ONE element carries the combobox pattern, and it is the one focus is on. */
    const comboboxOnTrigger = !(open && showSearch);

    const setTriggerRef = useMergedRef(triggerRef, ref);
    const quiet = useQuietFocus();

    /**
     * A CALLER THAT OWNS THE SEARCH OWNS ALL OF IT. With `onSearch` the options arrive already
     * filtered — often by a server that matched on more than the label — so filtering them again
     * here would silently drop rows it deliberately returned.
     */
    /* The rule itself lives in `shared/select.ts` so the native sibling reads the same one
       rather than a second copy — see that file for why `onSearch` decides both halves. */
    const visible = React.useMemo(
      () => filterSelectOptions(options, query, { showSearch, callerFilters: Boolean(onSearch) }),
      [options, query, showSearch, onSearch],
    );

    const [creating, setCreating] = React.useState(false);
    /* THE LABEL BRIDGE. The trigger resolves its label from `options`; the caller's `options` may
       not have re-rendered with the created row yet, or a remote search (`onSearch`) may have
       replaced them with results that no longer contain the chosen row (UMK-955) — without this the trigger
       would show the placeholder over a value that is set. */
    const [created, setCreated] = React.useState<SelectOption>();
    const showCreate = canCreateOption(visible.length, query, {
      enabled: Boolean(onCreate),
      showSearch,
      loading,
      minLength: createMinLength,
    });

    const selected =
      options.find((o) => o.value === values[0]) ?? (created && created.value === values[0] ? created : undefined);
    const summary = props.multiple
      ? values.length > 1
        ? multiSummary(values.length)
        : selected?.label
      : selected?.label;
    /* `filled` is DERIVED, never passed — the same rule TextField's own divergence note sets.
       A caller-supplied status is a second source of truth for something the component can see,
       and the only way it can ever disagree with the value in the box. */
    const state = disabled ? 'disabled' : error ? 'error' : selected ? 'filled' : 'default';

    /**
     * CLOSING ON AN OUTSIDE CLICK, which Escape and selection alone do not cover — a list left
     * open behind whatever the user clicked next is the failure every dropdown has.
     *
     * `mousedown`, not `click`: a click that starts inside the list and finishes outside it
     * would otherwise close the list out from under its own handler. And focus is NOT returned
     * to the trigger here, unlike Escape — the user has already chosen where to go.
     */
    React.useEffect(() => {
      if (!open) return;
      const dismiss = () => {
        setOpen(false);
        setQuery('');
        /* The cursor resets here too. `close()` does it for Escape and selection; leaving it
           behind on the pointer path means the next opening starts on a stale hover. */
        setActive(0);
      };
      const onDown = (e: MouseEvent) => {
        if (!inside(e.target as Node)) dismiss();
      };
      /* Tab moves focus without a pointer event, so a mousedown listener alone leaves the list
         open behind a user who has already moved on. `focusout` fires as focus leaves; the
         related target tells us whether it landed inside the list or outside it. */
      const onFocusOut = (e: FocusEvent) => {
        /* Only focus leaving THIS component, for somewhere outside it. */
        if (inside(e.target as Node) && !inside(e.relatedTarget as Node | null)) dismiss();
      };
      document.addEventListener('mousedown', onDown);
      /* On the DOCUMENT, not on the two elements: a portalled list mounts a render after this
         effect runs (Radix's Portal waits for its own layout effect), so a listener attached to
         `listRef.current` here would attach to nothing and Tab would leave the list open. */
      document.addEventListener('focusout', onFocusOut);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('focusout', onFocusOut);
      };
    }, [open]);

    /**
     * ESCAPE STAYS HERE. A Radix `Dialog` listens for Escape on the document in the CAPTURE phase,
     * so a React `onKeyDown` stopPropagation runs too late and the enclosing dialog closes with the
     * list. A `window` capture listener runs before it: swallow the key and close only the list.
     * Mounted only while open, so Escape on a closed Select still reaches the dialog.
     */
    React.useEffect(() => {
      if (!open) return;
      const onEscape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        e.preventDefault();
        close();
      };
      window.addEventListener('keydown', onEscape, true);
      return () => window.removeEventListener('keydown', onEscape, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `close` only touches setters and a ref
    }, [open]);

    const close = () => {
      setOpen(false);
      /* A caller that owns the filtering is told the query is gone too, or its list stays cut down
         to the last search and the trigger can no longer find the selected row's label. */
      /* Unconditional: the Escape listener holds the `close` of the render that opened the list, so
         a `query` read here would be stale. */
      onSearch?.('');
      setQuery('');
      /* Reset the cursor too, or a hover from the previous opening decides what Enter selects
         the next time the list is opened with the mouse. */
      setActive(0);
      /* Focus goes back to the trigger, or a keyboard user is returned to the top of the
         document with no idea where they were. */
      vouchForFocus();
      triggerRef.current?.focus();
    };

    const choose = (option: SelectOption) => {
      if (option.disabled) return;
      /* Remembered so the trigger keeps its label if a remote search later drops this option. */
      setCreated(option);
      emit(option.value);
      /* Multi stays open, query and all: the next pick is usually the reason it was opened. */
      if (!props.multiple) close();
    };

    const create = async () => {
      if (!onCreate || creating) return;
      setCreating(true);
      try {
        const option = await onCreate(query.trim());
        setCreated(option);
        emit(option.value);
        if (props.multiple) setQuery('');
        else close();
      } catch {
        /* Deliberately swallowed: the list stays open and nothing is selected, and the caller
           that rejected is the one that knows what to tell the user. */
      } finally {
        setCreating(false);
      }
    };

    /**
     * In place, the list is an absolutely-positioned child of the wrapper. Portalled, it rides a
     * `Popover` anchored to that wrapper and takes the wrapper's width; focus stays under this
     * component's own management, so Radix's open and close focus moves are refused.
     */
    const listIn = (list: React.ReactElement) =>
      portal ? (
        <PopoverContent
          portal
          align="start"
          sideOffset={0}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] rounded-none border-0 bg-transparent p-0 shadow-none"
        >
          {list}
        </PopoverContent>
      ) : (
        list
      );

    const onKeyDown = (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(true);
          setActive(Math.max(0, visible.findIndex((o) => isChosen(o.value))));
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        /* Clamped at BOTH ends. An empty filtered list makes `visible.length - 1` equal -1,
           which drives the cursor to a non-existent option and publishes an id nothing owns. */
        setActive((i) => Math.max(0, Math.min(visible.length - 1, i + 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const option = visible[active];
        if (option) choose(option);
        /* The create row is the cursor's only position when shown — the list is empty. */
        else if (showCreate) void create();
      }
    };

    return (
      <div className="flex w-full flex-col gap-ds-3xs">
        {labelling.visible !== undefined && (
          <Label htmlFor={fieldId} look={`field-${labelSize ?? size}`}>
            {labelling.visible}
          </Label>
        )}

        <Popover open={portal ? open : false}>
        <PopoverAnchor asChild>
        <div ref={rootRef} className="relative w-full" onKeyDown={onKeyDown}>
          <button
            {...quiet}
            ref={setTriggerRef}
            id={fieldId}
            type="button"
            /**
             * THE COMBOBOX FOLLOWS FOCUS. In search mode `autoFocus` puts focus on the input
             * below, so publishing the cursor here would announce it on an element the user is
             * not on — the trigger becomes a plain button and the input carries the pattern.
             */
            role={comboboxOnTrigger ? 'combobox' : undefined}
            aria-controls={comboboxOnTrigger ? listId : undefined}
            aria-expanded={comboboxOnTrigger ? open : undefined}
            aria-haspopup={comboboxOnTrigger ? 'listbox' : undefined}
            /* THE VIRTUAL CURSOR, published. Focus stays on this button while `active` moves,
               so without this a screen-reader user pressing an arrow key hears nothing change —
               the highlight is a colour, and colour is not a channel every reader has. */
            aria-activedescendant={
              comboboxOnTrigger && open && (visible.length > 0 || showCreate) ? optionId(active) : undefined
            }
            aria-label={labelling.ariaLabel}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            disabled={disabled}
            data-filled={selected ? true : undefined}
            onClick={() => setOpen((v) => !v)}
            className={cn(SELECT_TRIGGER, SIZE[size], STATE[state], className)}
          >
            <span className={selected ? undefined : 'text-default-secondary'}>
              {summary ?? placeholder}
            </span>
            <Icon name="chevron-down" size="sm" aria-hidden />
          </button>

          {open && listIn(
            <div ref={listRef} className={cn(SELECT_LIST, SELECT_LIST_SIZE[size], portal && 'static mt-0 w-full max-w-none')}>
              {showSearch && (
                <div className={cn(SELECT_SEARCH, SELECT_ROW_SIZE[size])}>
                  <Icon name="search" size="sm" aria-hidden />
                  <input
                  autoFocus
                  role="combobox"
                  aria-controls={listId}
                  aria-expanded
                  aria-haspopup="listbox"
                  aria-activedescendant={visible.length > 0 || showCreate ? optionId(active) : undefined}
                  value={query}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    onSearch?.(e.target.value);
                    /* Reset, or the active index points past the end of a shorter list and
                       Enter selects nothing while looking like it should. */
                    setActive(0);
                  }}
                  className={SELECT_SEARCH_INPUT}
                  />
                </div>
              )}
              <ul
                id={listId}
                role="listbox"
                aria-multiselectable={props.multiple || undefined}
                aria-label={summary ?? placeholder}
              >
                {visible.map((option, index) => (
                  /* `presentation`, so the listbox OWNS its options directly. A plain `li`
                     between them makes the options grandchildren, and a listbox whose options
                     are not its children exposes none of them. */
                  <li key={option.value} role="presentation">
                    <button
                      id={optionId(index)}
                      type="button"
                      role="option"
                      /* `tabIndex={-1}` is load-bearing: a focusable option's Enter bubbles to
                         the wrapper handler below, which preventDefaults the native click and
                         selects `visible[active]` — a DIFFERENT option than the focused one.
                         The virtual cursor is the only cursor. */
                      tabIndex={-1}
                      aria-selected={isChosen(option.value)}
                      /* `aria-disabled`, not `disabled`: a disabled button leaves the
                         accessibility tree entirely and fires no `mouseenter`, so the option
                         would be both unannounced and unreachable by the hover cursor. The
                         refusal itself lives in `choose`. */
                      aria-disabled={option.disabled || undefined}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(option)}
                      className={cn(SELECT_OPTION[index === active ? 'active' : 'default'], SELECT_ROW_SIZE[size])}
                    >
                      {props.multiple ? (
                        <Icon
                          name="check"
                          size="sm"
                          aria-hidden
                          className={isChosen(option.value) ? undefined : 'invisible'}
                        />
                      ) : null}
                      {option.label}
                      {option.detail ? <span className="ml-ds-sm">{option.detail}</span> : null}
                      {option.hint ? (
                        /* A NO-BREAK space leads: the row is a flex box, which drops an ordinary
                           leading space and ran the label into the dot ("+62· Indonesia"). */
                        <span className={SELECT_OPTION_HINT}>{`\u00a0· ${option.hint}`}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
                {showCreate && (
                  <li role="presentation">
                    <button
                      id={optionId(0)}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={false}
                      aria-disabled={creating || undefined}
                      onClick={() => void create()}
                      className={cn(SELECT_OPTION.active, SELECT_ROW_SIZE[size])}
                    >
                      {createLabel(query.trim())}
                    </button>
                  </li>
                )}
              </ul>
              {/* A message, never a blank box: an empty result with no words in it reads as a
                  component that broke rather than a search that found nothing — and "loading"
                  and "found nothing" are different answers, so they get different words. */}
              {loading ? (
                <p className={cn(SELECT_EMPTY, SELECT_ROW_SIZE[size])}>{loadingMessage}</p>
              ) : visible.length === 0 && !showCreate ? (
                <p className={cn(SELECT_EMPTY, SELECT_ROW_SIZE[size])}>{emptyMessage}</p>
              ) : null}
            </div>,
          )}
        </div>
        </PopoverAnchor>
        </Popover>

        {/* Before the error region, and only while disabled: it explains the state rather than
            reporting a failure, so it must not be mistaken for one. */}
        {disabled && disabledHint ? <p className={SELECT_DISABLED_HINT}>{disabledHint}</p> : null}

        <FieldError id={errorId} message={error} size={size === 'large' ? 'large' : 'small'} />
      </div>
    );
  },
);

Select.displayName = 'Select';
