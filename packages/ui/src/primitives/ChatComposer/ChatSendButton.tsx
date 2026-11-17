'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { COMPOSER_GLYPH, COMPOSER_GLYPH_LANDING, COMPOSER_SEND_STATE } from '../composer-classes';
import { ComposerButton, type ComposerButtonProps } from './composer-button';

type Axes = typeof contract.ChatSendButton.axes;
export type ChatSendState = Axes['state'][number];

export interface ChatSendButtonProps extends Omit<ComposerButtonProps, 'state'> {
  /**
   * What this control currently IS.
   *
   * `send` submits. `stop` interrupts a reply that is already streaming — a different action, a
   * different glyph and a different colour, so the host swaps `onClick` and `label` with it.
   * `waiting` is send with uploads still in flight: nothing to interrupt, nothing wrong, just not
   * yet.
   *
   * ITS OWN THREE-VALUE AXIS, and it OMITS the family's two-value `state` rather than narrowing it —
   * the two vocabularies are different sets, not a subset. The family's earlier `active` boolean
   * was documented here as "the in-flight look" and drew the ordinary blue send glyph, so the one
   * state a user most needs to see looked exactly like every other — a composer that could not
   * become a stop button, on a surface that streams every reply.
   */
  state?: ChatSendState;
  /** 32px in a chat, 36px on the landing hero. */
  size?: Axes['size'][number];
}

const SEND_GLYPH = {
  send: 'composer-send',
  stop: 'square',
  waiting: 'loader',
} as const;

const SEND_GLYPH_SIZE = (glyphs: typeof COMPOSER_GLYPH | typeof COMPOSER_GLYPH_LANDING) =>
  ({ send: undefined, stop: glyphs.tight, waiting: glyphs.spinner }) as Record<
    ChatSendState,
    string | undefined
  >;

/**
 * Send — `02 Tools`, `Type=Send`.
 *
 * THE ONE THAT IS NOT A TOGGLE. It emits no `aria-pressed`: announcing an unpressed switch that can
 * never be pressed is worse than announcing nothing. `stop` is not a pressed send either — it is a
 * different control wearing the same seat.
 *
 * THE LABEL AND THE HANDLER ARE THE HOST'S, and in `stop` that is load-bearing rather than
 * stylistic. A button drawing a stop square while still announcing "Kirim pesan" and still calling
 * send is worse than one that never changed at all, so this component deliberately owns neither —
 * the state cannot be set without the caller confronting both.
 *
 * Whether send is available is the host's rule too (text length, attachments, uploads in flight),
 * so this takes the ordinary `disabled` and owns none of it.
 */
export const ChatSendButton = React.forwardRef<HTMLButtonElement, ChatSendButtonProps>(
  function ChatSendButton({ state = 'send', className, size, ...props }, ref) {
    const glyph = SEND_GLYPH[state];
    return (
      <ComposerButton
        {...props}
        ref={ref}
        kind="send"
        glyph={{ default: glyph, active: glyph }}
        size={size}
        glyphClassName={SEND_GLYPH_SIZE(size === 'landing' ? COMPOSER_GLYPH_LANDING : COMPOSER_GLYPH)[state]}
        toggle={false}
        className={cn(COMPOSER_SEND_STATE[state], className)}
        data-send-state={state}
      />
    );
  },
);
