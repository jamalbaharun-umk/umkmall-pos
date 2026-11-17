'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import { Spinner } from '../Spinner';
import { MESSAGE_TTS_BUTTON, MESSAGE_TTS_GLYPH, MESSAGE_TTS_STATE } from '../message-classes';

type Axes = typeof contract.ChatMessageTTSButton.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface ChatMessageTTSButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  /** Where playback has got to. The host's state machine owns it; this draws it. */
  state: Of<'state'>;
  /**
   * The accessible name FOR THIS STATE — "Dengarkan", "Jeda", "Lanjutkan", "Memproses…".
   *
   * Required and caller-supplied: the same control means four different actions depending on
   * `state`, so a component that drew its own word would announce the wrong one four times out of
   * five, in a language it does not own.
   */
  label: string;
  /** Toggles playback. Never called while `loading`, which the button refuses on its own. */
  onToggle: () => void;
}

/**
 * The per-message LISTEN control.
 *
 * IT OWNS NO AUDIO, which is the whole shape of it. Fetching the speech, caching it, playing the
 * chunks in order, falling back to the platform's own synthesiser and making sure only one message
 * speaks at a time is host machinery — it differs per surface and none of it belongs to a design
 * system. What was duplicated, verbatim and drifting, across the classic and agent surfaces is
 * this: five drawings and a press.
 *
 * `loading` REFUSES THE PRESS ITSELF rather than leaving it to the caller. A second tap while the
 * speech is still being fetched starts a second fetch against a control that already looks busy,
 * and every caller would have to write the same guard — so it is expressed as the ordinary
 * `disabled`, which is also what announces the refusal.
 *
 * THE SPINNER IS A COMPONENT, NOT A FADED GLYPH. A still speaker at reduced opacity reads as a
 * broken icon, which is the drawing both live surfaces chose to avoid and the one a reader would
 * otherwise reach for first.
 */
export const ChatMessageTTSButton = React.forwardRef<HTMLButtonElement, ChatMessageTTSButtonProps>(
  function ChatMessageTTSButton({ state, label, onToggle, className, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        disabled={disabled || state === 'loading'}
        title={label}
        aria-label={label}
        data-state={state}
        className={cn(MESSAGE_TTS_BUTTON, MESSAGE_TTS_STATE[state], className)}
        {...rest}
      >
        {state === 'loading' ? (
          /* `label=""` — the button already carries the accessible name, and a spinner that
             announced a second one would make the control read as two things. */
          <Spinner size="sm" variant="primary" label="" />
        ) : (
          <Icon
            name={state === 'playing' ? 'pause' : 'speaker'}
            aria-hidden
            className={MESSAGE_TTS_GLYPH}
          />
        )}
      </button>
    );
  },
);
