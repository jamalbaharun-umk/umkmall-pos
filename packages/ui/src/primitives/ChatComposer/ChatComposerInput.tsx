'use client';

import React from 'react';
import { useMergedRef } from '../../utils';
import {
  COMPOSER_EDITOR,
  COMPOSER_EDITOR_AFFORDANCE,
  COMPOSER_EDITOR_BOX,
} from '../composer-classes';

/**
 * The editor's growth cap. Figma draws one line; the surface this ports grows to 150px and then
 * scrolls, and that is the behaviour being carried over.
 */
const EDITOR_MAX_HEIGHT_PX = 150;

export interface ChatComposerInputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Figma's `Text` property. Ignored when `placeholderSlot` is supplied. */
  placeholder?: string;
  /**
   * A NODE in place of the text property, for a host whose placeholder animates or rotates. The
   * text property is the fallback, not the whole contract — a string cannot express the landing
   * composer's rotating placeholder, and a host forced to choose between them would reimplement
   * the editor to keep it.
   */
  placeholderSlot?: React.ReactNode;
  /** Required: the editor carries no visible label of its own. */
  label: string;
  disabled?: boolean;
  /**
   * Anchored top-right INSIDE the editor box — where the mobile fullscreen trigger lives. The
   * modal it opens is the host's; the button that opens it is not, because it is positioned
   * against this box and a host cannot place it there from outside.
   */
  affordance?: React.ReactNode;
  /**
   * The editor's own events, passed straight through.
   *
   * NOT SPECULATIVE API. Every surface this is built to serve needs all four today — Enter-to-send
   * with its IME guard, a paste branch that turns pasted IMAGES into attachments, and the focus treatment —
   * so an editor without them cannot be adopted at any call site.
   */
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  onFocus?: React.FocusEventHandler<HTMLTextAreaElement>;
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
  /**
   * Anchored to the EDITOR box, not the whole composer: a menu that must sit directly above or
   * below the text (a slash menu). Rendered inside the editor box, after the textarea. Native mirror: UMK-1371
   * (UMK-1041).
   */
  overlay?: React.ReactNode;
  /**
   * The soft-keyboard hints, passed to the `<textarea>`. A `div` could not carry them, which is
   * why this editor is a textarea at all; a host that drops them gets the platform default
   * keyboard (Enter key label, capitalisation) with nothing failing. Native mirror: UMK-1371 (UMK-1041, L17).
   */
  inputMode?: React.TextareaHTMLAttributes<HTMLTextAreaElement>['inputMode'];
  enterKeyHint?: React.TextareaHTMLAttributes<HTMLTextAreaElement>['enterKeyHint'];
  autoCapitalize?: string;
  spellCheck?: boolean;
  className?: string;
}

/**
 * The composer's autogrowing text editor.
 *
 * ITS OWN COMPONENT, NOT THE LIBRARY'S MULTILINE FIELD. That field takes a fixed row count and
 * cannot grow to its content, which is the whole behaviour here.
 *
 * A `<textarea>`, never a `contentEditable`. The element it replaces accepted no `inputMode`, no
 * `enterKeyHint`, no `autoCapitalize`, no `spellCheck` and no accessible name — not as an
 * oversight but because a `div` cannot carry them.
 */
export const ChatComposerInput = React.forwardRef<HTMLTextAreaElement, ChatComposerInputProps>(
  function ChatComposerInput(
    {
      value,
      onValueChange,
      placeholder,
      placeholderSlot,
      label,
      disabled = false,
      affordance,
      overlay,
      inputMode,
      enterKeyHint,
      autoCapitalize,
      spellCheck,
      className,
      ...events
    },
    ref,
  ) {
    /**
     * Autogrow. `rows={1}` alone is a one-line box that SCROLLS — the component shipped once
     * claiming to grow and doing exactly that, which no assertion in this package could see
     * because happy-dom has no layout engine. So the guard asserts this mechanism exists rather
     * than a measured height. `field-sizing` would be the CSS answer and is not yet supported
     * widely enough to rely on.
     */
    const editorRef = React.useRef<HTMLTextAreaElement>(null);
    const refs = useMergedRef(editorRef, ref);
    React.useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, EDITOR_MAX_HEIGHT_PX)}px`;
    }, [value]);

    return (
      <div className={COMPOSER_EDITOR_BOX} data-composer-editor="">
        <textarea
          {...events}
          ref={refs}
          rows={1}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={disabled}
          aria-label={label}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          /* Blanked when a node takes over, so the two never draw the same words twice. */
          placeholder={placeholderSlot ? undefined : placeholder}
          className={className ? `${COMPOSER_EDITOR} ${className}` : COMPOSER_EDITOR}
        />
        {placeholderSlot && value.length === 0 && (
          <span className="pointer-events-none absolute left-0 top-0">{placeholderSlot}</span>
        )}
        {affordance && <span className={COMPOSER_EDITOR_AFFORDANCE}>{affordance}</span>}
        {overlay}
      </div>
    );
  },
);
