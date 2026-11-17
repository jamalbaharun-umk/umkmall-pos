'use client';

import React from 'react';
import { contract } from '../../contract';
import { ComposerButton, type ComposerButtonProps } from './composer-button';

type Axes = typeof contract.ChatVoiceButton.axes;

export interface ChatVoiceButtonProps extends ComposerButtonProps {
  /** 32px in a chat, 36px on the landing hero. */
  size?: Axes['size'][number];
}

/**
 * Voice input — `02 Tools`, `Type=Mic`.
 *
 * THE ONLY BUTTON THAT GOES RED, and the reason is not decoration: red means the microphone is
 * LIVE, where blue on the other three means armed or open. A refactor that gives all four one
 * active colour turns a recording indicator into an arming one, which is why the fill is per
 * button in the class table and why the guard asserts this one disagrees with the rest.
 *
 * The glyph becomes a pause when active — the control stops the recording, so the label must say
 * that too; it is the caller's, because only the caller knows what the tap will do.
 */
export const ChatVoiceButton = React.forwardRef<HTMLButtonElement, ChatVoiceButtonProps>(
  function ChatVoiceButton(props, ref) {
    return (
      <ComposerButton
        {...props}
        ref={ref}
        kind="voice"
        glyph={{ default: 'composer-mic', active: 'pause' }}
        toggle
      />
    );
  },
);
