import React from 'react';

/**
 * WAS THIS FOCUS THE USER'S? (UMK-955)
 *
 * `FOCUS_RING.field` paints on `focus-within`, and `:focus-visible` cannot narrow it: browsers match
 * `:focus-visible` on a text input even when the focus came from code. So an autofocused field drew its
 * ring on arrival, which the old app never did. The only reliable signal is what the user did just before
 * the focus landed, and only two things count, both within 100ms:
 *   - a pointer press INSIDE this field's own box, or on the caption `<label for>` that points at its control
 *     (a click elsewhere, then `.focus()` from code, is quiet). The window runs from the later of
 *     pointerdown and pointerup: a touch tap focuses on the synthesized click, after pointerup;
 *   - a Tab, Shift+Tab or arrow key (a key typed into some other field does not carry over), or an
 *     Enter / Space / Escape pressed on something that is not a text control: a keyboard user who opens
 *     a dialog from a button lands in its autofocused field and must SEE where focus went (WCAG 2.4.7).
 * Everything else (autofocus, `.focus()` from code) is "quiet" and gets no ring.
 *
 * The listeners install at MODULE LOAD, not in an effect: an autofocus fires during the commit, before any
 * effect of the field it focuses has run.
 */
const WINDOW_MS = 100;
const NAV_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Escape']);
/** Enter in a text control submits it; that is typing, not a keyboard user arriving somewhere. */
const isTextControl = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !/^(button|checkbox|radio|submit|reset)$/.test(t.type)));
let lastNavKey = -Infinity;
let lastPointer = { at: -Infinity, target: null as EventTarget | null };

if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      if (NAV_KEYS.has(e.key) || (ACTIVATE_KEYS.has(e.key) && !isTextControl(e.target))) lastNavKey = performance.now();
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = { at: performance.now(), target: e.target };
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    () => {
      lastPointer = { ...lastPointer, at: performance.now() };
    },
    true,
  );
}

/** A code-driven focus the user caused (Select returning focus to its trigger after a close). */
export const vouchForFocus = () => {
  lastNavKey = performance.now();
};

const pointedAt = (box: HTMLElement, target: EventTarget | null) => {
  if (!(target instanceof Node)) return false;
  if (box.contains(target)) return true;
  const label = target instanceof Element ? target.closest('label') : null;
  const control = label?.htmlFor ? box.ownerDocument.getElementById(label.htmlFor) : null;
  return !!control && box.contains(control);
};

const userDriven = (box: HTMLElement) => {
  const now = performance.now();
  const clicked = now - lastPointer.at <= WINDOW_MS && pointedAt(box, lastPointer.target);
  return clicked || now - lastNavKey <= WINDOW_MS;
};

/**
 * Props for the box that contains the control. Spread them on the element that carries
 * `FOCUS_RING.field`; it gains `data-quiet-focus` while a code-driven focus is the only kind it has had.
 */
export const useQuietFocus = () => {
  const [quiet, setQuiet] = React.useState(false);
  const clear = React.useCallback(() => setQuiet(false), []);
  return {
    'data-quiet-focus': quiet || undefined,
    onFocus: (e: React.FocusEvent<HTMLElement>) => setQuiet(!userDriven(e.currentTarget)),
    onBlur: clear,
    onKeyDown: clear,
    onPointerDown: clear,
    onInput: clear,
  } as const;
};
