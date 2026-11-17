'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn, useMergedRef } from '../../utils';
import {
  FIELD_LABEL,
  UPLOAD_BASE,
  UPLOAD_BORDER,
  UPLOAD_DRAG_OVER,
  UPLOAD_INPUT,
  UPLOAD_SIZE,
  UPLOAD_STATUS,
} from '../field-classes';
import {
  FieldError,
  FieldHelp,
  RequiredMark,
  resolveLabelling,
  useFieldIds,
  type LabelledProps,
} from '../field-support';
import {
  A2UI_UPLOAD_ERROR,
  A2UI_UPLOAD_LABEL,
  A2UI_UPLOAD_PILL,
  A2UI_UPLOAD_STACK,
  A2UI_UPLOAD_ZONE,
  A2UI_UPLOAD_ZONE_STATE,
} from '../a2ui-classes';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Tooltip } from '../Tooltip';

type Axes = typeof contract.Upload.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const SIZE = UPLOAD_SIZE satisfies Record<Of<'size'>, string>;
const STATUS = UPLOAD_STATUS satisfies Record<Of<'status'>, string>;
const BORDER = UPLOAD_BORDER satisfies Record<Of<'border'>, string>;

/**
 * Does a dropped file satisfy an `accept` list?
 *
 * Implements the three token forms the attribute defines, because the browser only applies them
 * to the picker: a `.ext` suffix (case-insensitive), a `type/*` wildcard, and an exact
 * `type/subtype`. An empty or absent `accept` accepts everything, which is the attribute's own
 * meaning rather than a fallback.
 *
 * A file whose `type` the browser could not determine is empty-string, so it matches only a
 * `.ext` token — which is the honest answer: without a MIME type there is nothing for a
 * `type/*` rule to test.
 */
export const matchesAccept = (file: File, accept?: string): boolean => {
  const tokens = (accept ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return type.startsWith(`${token.slice(0, -1)}`);
    return type === token;
  });
};

export type UploadProps = LabelledProps & {
  size?: Of<'size'>;
  /** The message itself, not a flag — see `FieldError` for why the region is always mounted. */
  error?: string;
  disabled?: boolean;
  required?: boolean;
  /** Fires for a drop and for a picker choice alike, with the same payload. */
  onFilesChange?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Whether a file has been chosen. Presentation only — this component holds no file state. */
  filled?: boolean;
  /**
   * An upload is in flight. GIVEN, never derived — this component reads no files and starts no
   * requests. It refuses the picker and the drop while set, exactly as `disabled` does: the
   * caller owns file handling, so one mid-upload has no safe way to take a second file without
   * its own queueing.
   */
  busy?: boolean;
  /**
   * What was chosen, rendered in place of the placeholder and the glyph. A SLOT, not a status:
   * the component creates no object URL and holds no file, so the caller supplies the element.
   * Normally paired with `filled`, which is the status this visual belongs to.
   */
  preview?: React.ReactNode;
  /** The instruction inside the zone, and an optional glyph beside it. */
  children?: React.ReactNode;
  icon?: React.ReactNode;
  /**
   * Figma's `Input helper text` row. Standing guidance, not a message channel — an `error`
   * REPLACES it, which is the one text row Figma publishes rather than two stacked ones.
   */
  helperText?: React.ReactNode;
  /**
   * Figma's `Show Tooltip`, as the slot itself: the tip beside the label, absent when not
   * given. There is no boolean, because "no tooltip, but here is the tooltip" is not a state.
   */
  tooltip?: React.ReactNode;
  /** The browse button's label. Figma writes `Browse`; a caller with its own copy overrides it. */
  browseLabel?: React.ReactNode;
  /**
   * The zone's stroke. `solid` is Figma's and the default; `dashed` is ours, recorded as a
   * divergence. Say it here rather than through `className` — see `UPLOAD_BORDER`.
   */
  border?: Of<'border'>;
  /** `a2ui` is the agent surface's pre-library dropzone (UMK-1307); only its adapter passes it. */
  appearance?: Of<'appearance'>;
  id?: string;
  className?: string;
};

/**
 * A dropzone.
 *
 * PRESENTATION ONLY. Reading the file, enforcing a size limit and compressing belong to the
 * caller: a component that read files would have to take a limit, an error vocabulary and a
 * compression policy, and every caller has a different one.
 *
 * IT COMPOSES THE TEXT FIELDS' LABEL WIRING rather than re-implementing it. Figma's upload area
 * and its text area share nine property IDs because they are one shell seen twice; two copies
 * of `useFieldIds` and the error region would be two things to keep in step for no gain.
 */
export const Upload = React.forwardRef<HTMLInputElement, UploadProps>(
  (
    {
      label,
      'aria-label': ariaLabel,
      size = 'large',
      error,
      disabled,
      required,
      onFilesChange,
      accept,
      multiple,
      filled,
      busy,
      preview,
      children,
      icon,
      helperText,
      tooltip,
      browseLabel = 'Browse',
      border = 'solid',
      appearance = 'default',
      id,
      className,
    },
    ref,
  ) => {
    const { fieldId, errorId } = useFieldIds(id);
    const helpId = `${fieldId}-help`;
    const labelling = resolveLabelling(label, ariaLabel);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = React.useState(false);

    /** ONE source of truth for "refuses a file", named once rather than rewritten per site. */
    const blocked = disabled || busy;

    /**
     * Whether the helper row is on screen — ONE fact, because two conditions expressing it is
     * how `aria-describedby` ends up citing an id that never rendered.
     *
     * TRUTHINESS ON BOTH HALVES, matching `FieldError`'s own `empty:hidden`. `!error` because
     * an empty-string error is falsy everywhere else here (the status chain, `aria-invalid`),
     * so treating it as "in error" would hide the helper row and show nothing in its place.
     * `!!helperText` because the prop is a `ReactNode`: the ordinary
     * `helperText={showHelp && '…'}` idiom passes `false` when off, which is neither `null`
     * nor `''` — a null check mounts an empty `<p>` and then names it as the input's
     * description.
     */
    const helpVisible = !error && !!helperText;

    /**
     * THE PRECEDENCE, FIXED RATHER THAN DISCOVERED. Blocking states rank above transient ones:
     * a control mid-upload is not "filled" by whatever it last held. An under-specified chain
     * is exactly where a defect ships, so the order is written here and pinned pair by pair in
     * the tests. Drag-over is not on it — see below.
     */
    const status = disabled ? 'disabled' : busy ? 'busy' : error ? 'error' : filled ? 'filled' : 'default';

    /**
     * The drag treatment is ADDITIVE and gated on `!blocked`, not a rung on the chain above.
     *
     * Gated at the CLASS rather than at the state setter on purpose: `dragOver` answers "is a
     * file over me", which stays true even if the caller flips `busy` mid-drag. Deriving the
     * visual from both keeps a blocked zone from lighting up as though it would accept the
     * drop it is about to refuse.
     */
    const showDragOver = dragOver && !blocked;

    const setInputRef = useMergedRef(inputRef, ref);
    const a2ui = appearance === 'a2ui';

    /**
     * ONE emit path for both routes — including the FILTERING, which is the half that matters.
     *
     * `accept` and `multiple` reach the `<input>`, so the browser enforces them on the PICKER
     * path only: it applies neither to `dataTransfer.files`. Sharing `emit` without sharing the
     * filter is exactly the divergence this comment was written to prevent — an
     * `<Upload accept="image/*" />` would hand its caller a `.exe` on drop, and one without
     * `multiple` would hand back five files. The filter lives here so both routes get it.
     */
    const emit = (list: FileList | null) => {
      if (blocked || !list) return;
      const matching = [...list].filter((file) => matchesAccept(file, accept));
      onFilesChange?.(multiple ? matching : matching.slice(0, 1));
    };

    return (
      <div className={a2ui ? A2UI_UPLOAD_STACK : 'flex w-full flex-col gap-ds-3xs'}>
        {(labelling.visible !== undefined || tooltip !== undefined) && (
          <div className="flex items-center gap-ds-3xs">
            {labelling.visible !== undefined && (
              <label id={`${fieldId}-label`} htmlFor={fieldId} className={a2ui ? A2UI_UPLOAD_LABEL : FIELD_LABEL}>
                {labelling.visible}
                {required && <RequiredMark />}
              </label>
            )}
            {tooltip !== undefined && (
              <Tooltip content={tooltip}>
                {/* NAMED, not decorative. A trigger the pointer can reach and a reader cannot
                    is the failure this `aria-label` closes — the glyph itself announces
                    nothing. */}
                <button type="button" aria-label="Info" className="inline-flex">
                  <Icon name="info" size="sm" aria-hidden />
                </button>
              </Tooltip>
            )}
          </div>
        )}

        {/* NO `htmlFor` HERE. The visible field label above already carries it, and a second
            label bound to the same id makes the input's accessible name the two labels'
            text concatenated. The input is a descendant of this element, so the implicit
            label-wraps-control association still opens the picker on click. */}
        <label
          data-filled={filled || undefined}
          aria-busy={busy || undefined}
          onDragOver={(e) => {
            /* Without this the browser NAVIGATES to the dropped file, and the drop handler
               below never runs at all — so it is called unconditionally, blocked or not. */
            e.preventDefault();
            /* But preventing the default is also what MARKS this a valid drop target, so a
               blocked zone would show the copy cursor and then swallow the drop in silence.
               `dropEffect` is the half that says "not here" to the pointer. */
            if (blocked && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
            setDragOver(true);
          }}
          /* The LEAVE half, which the component shipped without: a zone that lights up on
             drag-over and never goes dark reads as permanently active.

             A BARE `setDragOver(false)` IS THE BUG, not the fix. `dragleave` fires on the zone
             every time the pointer crosses onto one of its own children — the placeholder, the
             glyph, a preview, the browse button — so an unguarded handler strobes the highlight
             on and off during an ordinary drag. `relatedTarget` is where the pointer went; only
             a destination OUTSIDE the zone is a real leave. */
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            emit(e.dataTransfer?.files ?? null);
          }}
          className={
            a2ui
              ? cn(A2UI_UPLOAD_ZONE, A2UI_UPLOAD_ZONE_STATE[showDragOver ? 'over' : 'idle'], className)
              : cn(
                  UPLOAD_BASE,
                  SIZE[size],
                  BORDER[border],
                  STATUS[status],
                  showDragOver && UPLOAD_DRAG_OVER,
                  className,
                )
          }
        >
          <input
            ref={setInputRef}
            id={fieldId}
            type="file"
            accept={accept}
            multiple={multiple}
            /* `blocked`, not `disabled`: a busy zone that leaves the input enabled still opens
               the OS picker from a label click, and `emit` then drops the choice in silence. */
            disabled={blocked}
            required={required}
            /* OUT OF THE TAB ORDER, because the browse button is now the keyboard affordance.
               `sr-only` hides the input visually but leaves it tabbable, so without this a
               keyboard user meets TWO stops that open the same picker and the first one is
               invisible. It keeps its label, description and validity wiring, so a screen
               reader still reaches it by form-control navigation — it just is not a second
               tab stop pointing at the same thing. */
            tabIndex={-1}
            aria-label={labelling.ariaLabel}
            /* a2ui keeps its error INSIDE the zone's label, so without this the error text joins the input's name. */
            aria-labelledby={a2ui && labelling.visible !== undefined ? `${fieldId}-label` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={helpVisible ? `${helpId} ${errorId}` : errorId}
            onChange={(e) => emit(e.target.files)}
            className={UPLOAD_INPUT}
          />
          {/* A POPULATED PREVIEW REPLACES the placeholder and the glyph — it is what was
              chosen, so the instruction to choose has nothing left to say. The browse button
              below stays, because replacing a file is the next thing a user wants. */}
          {preview !== undefined && preview !== null ? (
            preview
          ) : (
            <>
              {icon !== undefined && icon !== null && <span aria-hidden>{icon}</span>}
              {children}
            </>
          )}
          {/* A REAL, FOCUSABLE BUTTON, and the handler is what makes it work rather than what
              stops it double-firing. HTML skips a label's activation behaviour when the click
              lands on interactive content, so a plain button in here does NOTHING at all —
              that is the failure mode, not two pickers. `preventDefault` covers a browser that
              forwards activation anyway, and the explicit open covers those that do not.
              Exactly one picker either way, and the affordance stays keyboard-reachable. */}
          {a2ui ? (
            /* The pre-library pill: shown unless the zone is read-only (busy keeps it, as it always did), and a
               real <button> so it stays keyboard-reachable — the old one was a span inside a hidden input's label. */
            !disabled && (
              <button
                type="button"
                className={A2UI_UPLOAD_PILL}
                onClick={(e) => {
                  e.preventDefault();
                  inputRef.current?.click();
                }}
              >
                {browseLabel}
              </button>
            )
          ) : (
          <Button
            /* GHOST: Figma's browse button is an outline in brand, not a filled pill. */
            type="ghost"
            color="primary"
            size="small"
            /* `width="auto"`, because Button DEFAULTS to `full` — left alone, Figma's 84px
               browse button spans the whole zone. */
            width="auto"
            disabled={blocked}
            onClick={(e) => {
              /* THE EXPLICIT OPEN IS THE LOAD-BEARING HALF; `preventDefault` is the belt.
                 Per spec a label skips its activation behaviour when the event targets
                 interactive content, and a `<button>` is interactive content — so the picker
                 does not double-fire, and this handler is what makes the button do anything
                 at all. `preventDefault` covers a browser that forwards activation anyway.
                 (An earlier comment here had these two the other way round.)
                 The button's `disabled` above is what stops this firing when blocked. */
              e.preventDefault();
              inputRef.current?.click();
            }}
          >
            {browseLabel}
          </Button>
          )}
          {/* a2ui: the error sits INSIDE the zone, under the pill, as it did before the library owned the upload. Mounted
              while empty (`empty:hidden`), like `FieldError`, so it is a live region before its text lands. */}
          {a2ui && (
            <p id={errorId} role="alert" className={A2UI_UPLOAD_ERROR}>
              {error}
            </p>
          )}
        </label>

        {/* ONE TEXT ROW, as Figma publishes it: the error REPLACES the helper rather than
            stacking under it. The error region stays mounted regardless — it is the live
            region, and a region that appears already holding its text may not be announced. */}
        {helpVisible && <FieldHelp id={helpId} text={helperText} />}
        {!a2ui && <FieldError id={errorId} message={error} />}
      </div>
    );
  },
);

Upload.displayName = 'Upload';
