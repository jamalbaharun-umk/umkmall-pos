'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import {
  MESSAGE_SCROLL_BUTTON,
  MESSAGE_SCROLL_BUTTON_BADGE,
  MESSAGE_SCROLL_BUTTON_GLYPH,
  MESSAGE_SCROLL_BUTTON_SHAPE,
} from '../message-classes';

type Axes = typeof contract.ChatScrollButton.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export interface ChatScrollButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  /**
   * The accessible name, and REQUIRED. A pill that cannot be announced is a control a
   * screen-reader user meets as "button".
   */
  label: string;
  /**
   * Which geometry to draw. `icon` — the default — is a circle holding a glyph and shows no text
   * at all, because a translated string inside a 36px circle clips: it renders, it reads as a
   * styling bug, and it is what this component's guard asserts against. `labelled` expands and
   * puts the glyph in front of the words.
   */
  shape?: Of<'shape'>;
  /** A message arrived while the reader was away. Draws a textless mark — see the note. */
  hasNewMessages?: boolean;
}

/**
 * The return-to-bottom pill.
 *
 * PRESENTATIONAL. It knows nothing about scrolling: the frame decides when it appears, what it
 * says and what pressing it does. That is what lets a surface render its own in the same slot.
 *
 * THE MARK CARRIES NO TEXT. A count was the obvious alternative and is refused — a number here
 * would be copy in a language this component does not own, and it would have to be pluralised by
 * a component that holds no messages. It says "something arrived"; pressing it is how the reader
 * finds out what.
 */
export const ChatScrollButton = React.forwardRef<HTMLButtonElement, ChatScrollButtonProps>(
  function ChatScrollButton({ label, shape = 'icon', hasNewMessages = false, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        data-shape={shape}
        data-new-messages={hasNewMessages ? '' : undefined}
        className={cn(MESSAGE_SCROLL_BUTTON, MESSAGE_SCROLL_BUTTON_SHAPE[shape], className)}
        {...rest}
      >
        <Icon name="chevron-down" aria-hidden className={MESSAGE_SCROLL_BUTTON_GLYPH} />
        {shape === 'labelled' && <span>{label}</span>}
        {hasNewMessages && <span aria-hidden className={MESSAGE_SCROLL_BUTTON_BADGE} />}
      </button>
    );
  },
);
