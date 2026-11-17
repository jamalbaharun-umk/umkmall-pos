'use client';

import React from 'react';
import { contract } from '../../contract';
import { ComposerButton, type ComposerButtonProps } from './composer-button';

type Axes = typeof contract.ChatToolsButton.axes;

export interface ChatToolsButtonProps extends ComposerButtonProps {
  /** 32px in a chat, 36px on the landing hero. */
  size?: Axes['size'][number];
  /** A dot while true. For a state the closed menu must still show, such as an armed tool. */
  badge?: boolean;
}

/**
 * The composer's tools menu trigger — the `+` that opens image, video and optimize.
 *
 * THE ONE BUTTON WITH NO PUBLISHED SOURCE. `02 Tools` publishes Mic, Tools and Send; the app has a
 * FOURTH control, the `+` menu, which the design set does not model. It is here because the
 * surface has it, and it is recorded as a divergence rather than quietly folded into the attach
 * button — the two sit side by side in the real toolbar and open different things.
 *
 * `active` means the menu is open, which is why the glyph becomes a minus: the same tap closes it.
 */
export const ChatToolsButton = React.forwardRef<HTMLButtonElement, ChatToolsButtonProps>(
  function ChatToolsButton(props, ref) {
    return (
      <ComposerButton
        {...props}
        ref={ref}
        kind="tools"
        glyph={{ default: 'composer-plus', active: 'composer-minus' }}
        toggle
      />
    );
  },
);
