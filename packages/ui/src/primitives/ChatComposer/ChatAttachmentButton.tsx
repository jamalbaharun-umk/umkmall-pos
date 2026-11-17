'use client';

import React from 'react';
import { contract } from '../../contract';
import { ComposerButton, type ComposerButtonProps } from './composer-button';

type Axes = typeof contract.ChatAttachmentButton.axes;

export interface ChatAttachmentButtonProps extends ComposerButtonProps {
  /** 32px in a chat, 36px on the landing hero. */
  size?: Axes['size'][number];
}

/**
 * The attach control — `02 Tools`, `Type=Tools`.
 *
 * Figma's name for this type is "Tools" and the app's `+` menu is ALSO called tools, which is the
 * collision this family's naming resolves: the published `Type=Tools` is the paperclip, so it is
 * `ChatAttachmentButton` here and the `+` is `ChatToolsButton`. Carrying Figma's word would have
 * made the two indistinguishable at every call site.
 *
 * `active` means the attach menu is open; the glyph becomes a minus, exactly as published.
 */
export const ChatAttachmentButton = React.forwardRef<HTMLButtonElement, ChatAttachmentButtonProps>(
  function ChatAttachmentButton(props, ref) {
    return (
      <ComposerButton
        {...props}
        ref={ref}
        kind="attachment"
        glyph={{ default: 'composer-attach', active: 'composer-minus' }}
        toggle
      />
    );
  },
);
