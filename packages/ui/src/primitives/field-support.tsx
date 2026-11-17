import React from 'react';
import { cn } from '../utils';

/**
 * The three pieces every form control in this slice repeats: an id pair, the required
 * marker, and the error region.
 *
 * NOT a `Field` wrapper component. The reference design system puts label, helper text and
 * error message in one, and this package deliberately does not (contract divergence on
 * `TextField`): a wrapper is a second component every caller has to remember, and forgetting
 * it yields an unlabelled control that renders perfectly. Each control owns its label; these
 * helpers are what keep the six from writing six versions of the same markup.
 */

/** A stable id for the control and one for the error region it points at. */
export const useFieldIds = (id?: string) => {
  const generated = React.useId();
  const fieldId = id ?? generated;
  return { fieldId, errorId: `${fieldId}-error` };
};

/**
 * Decorative. The semantics ride the control's own `required`, not this glyph — a screen
 * reader announcing "asterisk" instead of "required" is the failure mode here.
 *
 * Uses the token error red, which is what Figma specifies: the asterisk is bound to
 * **Text/Error**, so `text-default-error` (`#db0000`, the repo-added Red/R450, UMK-1333) is the
 * token value rather than an approximation of one. The app spells it `#ff2424` in five places — that is drift from the
 * design source, not a competing decision, so do not "correct" this back to match those call
 * sites. Migrating them is UMK-955.
 */
export const RequiredMark = () => (
  <span aria-hidden className="ml-ds-5xs text-default-error">
    *
  </span>
);

/**
 * The error region, ALWAYS mounted.
 *
 * Mounting the container and the message together is the trap: assistive technology watches
 * a live region for changes, and a region that appears already holding its text may not be
 * announced at all. So the element exists from first render and only its contents change.
 */
export const FieldError = ({
  id,
  message,
  size = 'large',
  focusWithinParent = false,
}: {
  id: string;
  message?: string;
  /** Figma's helper line: Large 12/18, Small 10/16. */
  size?: 'large' | 'small';
  /** Switch to the focus ink while a `group` parent holds focus (UMK-1334). TextField only. */
  focusWithinParent?: boolean;
}) => (
  <p
    id={id}
    role="alert"
    className={cn(
      size === 'large' ? 'text-ds-body-lg-mobile' : 'text-ds-body-md-mobile',
      'text-default-error empty:hidden',
      focusWithinParent && 'group-focus-within:text-focus-error',
    )}
  >
    {message}
  </p>
);

/**
 * The helper row Figma publishes under the control — `Input helper text`.
 *
 * NOT a live region, and that is the whole difference from `FieldError` above. Helper text is
 * standing guidance a reader meets when they reach the field; announcing it on every render
 * would talk over them. It is also NOT mounted when empty, again unlike the error region:
 * nothing watches it, so there is no announcement to protect.
 */
export const FieldHelp = ({ id, text }: { id: string; text?: React.ReactNode }) =>
  text == null || text === '' ? null : (
    <p id={id} className="text-ds-body-lg-mobile text-default-secondary">
      {text}
    </p>
  );

/**
 * The labelling pair, as ONE union rather than two optionals.
 *
 * Slice 2 made `label` required on every control so that "a caller cannot produce an
 * unlabelled control by omission". Some controls cannot honour the visible half of that: the
 * wire format feeding them carries no label at all, and the only name available is a string.
 * An optional `label` would re-admit the exact failure the required prop was chosen to
 * prevent, so this is a union instead — the compiler still refuses a control with no name, it
 * just accepts two ways of giving one.
 *
 * THE CRITERION, not a list: a control takes this when a surface that renders it may have no
 * visible label to supply. `Slider` and `DateTimeInput` were relaxed to it, which narrowed a
 * settled decision and is recorded on both contract entries; `Select`, `SelectionCard` and
 * `Upload` were built with it. The four slice-2 controls that were NOT relaxed —
 * `TextField`, `CheckBox`, `Radio`, `Switch` — still require the visible label, and
 * `field-support.test-d.ts` asserts that they do.
 */
export type LabelledProps =
  | { label: React.ReactNode; 'aria-label'?: never }
  | { label?: never; 'aria-label': string };

/**
 * Which arm a caller actually landed on, decided ONCE so both controls agree.
 *
 * Passing both is a compile error, but a plain-JS caller can still do it, and "undefined" is
 * not an answer a screen reader can read. The visible label wins and the string is dropped:
 * two names on one control is how a field ends up announcing one thing and showing another.
 */
export const resolveLabelling = (label: React.ReactNode, ariaLabel?: string) =>
  /* `''` counts as ABSENT, alongside `null`/`undefined`/`false`. An empty string satisfies the
     visible arm of the union — which forbids `aria-label` — and would otherwise render an empty
     `<label>` over a control with no accessible name at all: exactly what the union exists to
     make unbuildable, reached by a caller that compiles. */
  label != null && label !== false && label !== ''
    ? { visible: label as React.ReactNode, ariaLabel: undefined }
    : { visible: undefined, ariaLabel };
