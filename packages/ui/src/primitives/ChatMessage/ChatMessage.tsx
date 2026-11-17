'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  MESSAGE_AUTHOR,
  MESSAGE_AUTHOR_PULL,
  MESSAGE_AVATAR,
  MESSAGE_CONTENT_ALIGN,
  MESSAGE_CONTENT_GAP,
  MESSAGE_INSET,
  MESSAGE_META_PULL,
  MESSAGE_NAME,
  MESSAGE_ROOT,
} from '../message-classes';
import {
  MESSAGE_MARKER,
  MessageProvider,
  useDensity,
  type ChatMessageDensity,
  type ChatMessageSender,
} from './message-context';

type Axes = typeof contract.ChatMessage.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const ALIGN = MESSAGE_CONTENT_ALIGN satisfies Record<Of<'sender'>, string>;
const INSET = MESSAGE_INSET satisfies Record<Of<'density'>, string>;
const GAP = MESSAGE_CONTENT_GAP satisfies Record<Of<'density'>, string>;
const AUTHOR_PULL = MESSAGE_AUTHOR_PULL satisfies Record<Of<'density'>, string>;
const META_PULL = MESSAGE_META_PULL satisfies Record<Of<'density'>, string>;

export interface ChatMessageProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /** Whose turn this is. Decides the alignment and the fill of any bubble inside. */
  sender?: Of<'sender'>;
  /**
   * How much room the row takes. Omit it inside a transcript and it follows the list; omit it
   * outside one and it takes the standalone default.
   */
  density?: Of<'density'>;
  /**
   * The speaker's face, avatar or initials. Any element — this slot supplies only the position
   * and the refusal to shrink.
   *
   * It shares the author header with `name`, and the header is rendered only when at least one of
   * the two is filled: a row that paid for an empty header would space itself differently from
   * every sibling that has one. Neither shipped surface gives the user a face, so a user row
   * passing neither slot is the ordinary case rather than a degenerate one.
   */
  avatar?: React.ReactNode;
  /**
   * The speaker's name, beside the avatar in the author header above the turn. The header takes
   * the same inline inset as the bubble and the metadata row, so all three share one left edge.
   */
  name?: React.ReactNode;
  /** The row-level metadata slot — a timestamp, a status. Suppressed for a system message. */
  metadata?: React.ReactNode;
  /**
   * Whatever this message is. Bubbles, media, an artifact card, a mix.
   *
   * THIS COMPONENT TAKES NO MESSAGE OBJECT, and that is the design rather than an omission. The
   * three surfaces it has to serve carry three incompatible message shapes, so a component taking
   * any one of them would be adoptable on exactly one of them.
   */
  children?: React.ReactNode;
}

/**
 * One row of a chat transcript: a speaker, a position, and whatever they said.
 *
 * THE SPEAKER IS A HEADER ABOVE THE TURN, NOT A FACE BESIDE IT, and the user side flips by
 * alignment alone. Both shipped surfaces draw it that way — the agent chat's author row and the
 * native view's — so the authored order is identical on both sides of the transcript and a screen
 * reader meets who is talking before what they said, without the markup being reordered to
 * achieve it.
 *
 * `system` IS NOT A THIRD SPEAKER. It suppresses the avatar, the name and the metadata even when
 * all three are passed, and centres the content: a notice pinned to the assistant's edge, wearing
 * the assistant's avatar, reads as something the assistant said.
 *
 * IT PUBLISHES A STABLE MARKER ATTRIBUTE. The transcript frame finds the last message element by
 * it, to tell a new message arriving from the current one growing. Without it the scroll-to-bottom
 * pill and its new-message flag go quietly dead, so the family's behaviour guard asserts the
 * attribute rather than trusting that it was written.
 */
export const ChatMessage = React.forwardRef<HTMLElement, ChatMessageProps>(function ChatMessage(
  { sender = 'assistant', density, avatar, name, metadata, children, className, ...rest },
  ref,
) {
  const resolved = useDensity(density);
  const isSystem = sender === 'system';

  /* Stable across renders, so the provider does not remount every consumer on an unrelated
     parent update. */
  const value = React.useMemo<{ sender: ChatMessageSender; density: ChatMessageDensity }>(
    () => ({ sender, density: resolved }),
    [sender, resolved],
  );

  /**
   * THE ACCESSIBLE NAME, and the fallback is the half that matters. A transcript of unnamed
   * articles is a list of identical landmarks; a reader tabbing through them learns nothing. With
   * no `name` slot the sender is the name, which is at least the one fact the component knows.
   */
  const label = typeof name === 'string' && name.length > 0 ? name : sender;

  return (
    <article
      ref={ref}
      aria-label={label}
      {...{ [MESSAGE_MARKER]: '' }}
      data-sender={sender}
      data-density={resolved}
      className={cn(MESSAGE_ROOT, GAP[resolved], ALIGN[sender], className)}
      {...rest}
    >
      {!isSystem && (avatar !== undefined || name !== undefined) && (
        <div className={cn(MESSAGE_AUTHOR, INSET[resolved], AUTHOR_PULL[resolved])}>
          {avatar !== undefined && <div className={MESSAGE_AVATAR}>{avatar}</div>}
          {name !== undefined && <div className={MESSAGE_NAME}>{name}</div>}
        </div>
      )}
      <MessageProvider value={value}>{children}</MessageProvider>
      {!isSystem && metadata !== undefined && (
        <div className={cn(INSET[resolved], META_PULL[resolved])}>{metadata}</div>
      )}
    </article>
  );
});
