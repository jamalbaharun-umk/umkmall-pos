'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  MESSAGE_BLOCK,
  MESSAGE_BUBBLE_BASE,
  MESSAGE_BUBBLE_GHOST,
  MESSAGE_BUBBLE_SENDER,
  MESSAGE_BUBBLE_WIDTH,
  MESSAGE_GROUP_END,
  MESSAGE_GROUP_START,
  MESSAGE_INSET,
  MESSAGE_NAME,
  MESSAGE_AUTHOR_PULL,
  MESSAGE_META_PULL,
} from '../message-classes';
import { useDensity, useSender } from './message-context';

type Axes = typeof contract.ChatMessageBubble.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const GROUP_START = MESSAGE_GROUP_START satisfies Record<Of<'group'>, string>;
const GROUP_END = MESSAGE_GROUP_END satisfies Record<Of<'group'>, string>;
const WIDTH = MESSAGE_BUBBLE_WIDTH satisfies Record<Of<'width'>, string>;

export interface ChatMessageBubbleProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Where this bubble sits in a run of consecutive bubbles from one sender. `none` — the default —
   * is the standalone case and keeps all four corners.
   */
  group?: Of<'group'>;
  /**
   * Escapes the default width cap. `auto` is the cap; `full` is what a media grid needs to span
   * the message column.
   */
  width?: Of<'width'>;
  /**
   * Drop the fill and the vertical padding, keep the SIDE padding.
   *
   * That retained inset is the whole point: it is how a non-bubble child — a media grid, an
   * artifact card — gets its leading edge lined up with the text column above it. A raw child of a
   * message sits flush with the row edge instead, which is the right answer for something meant to
   * bleed and the wrong one for anything that has to read as part of the conversation.
   */
  ghost?: boolean;
  /**
   * A per-bubble name slot, for the first bubble of a grouped run. The row's own `name` slot is
   * the usual home; this one exists so a run can label its first bubble without the row labelling
   * all of them.
   */
  name?: React.ReactNode;
  /**
   * A per-bubble metadata slot — a timestamp riding the LAST bubble of a run rather than the row.
   * Same reasoning as `name`.
   */
  metadata?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The visible bubble.
 *
 * IT RETURNS A FRAGMENT, NOT A WRAPPER, and that is load-bearing. The two slots are SIBLINGS of
 * the bubble inside the row's content column, so a run of grouped bubbles stays evenly spaced;
 * wrap the three in a box and every run gains one column gap it did not ask for at each end. The
 * price is that a sibling slot sits a full column gap from the bubble it belongs to, which reads
 * as unrelated rows — so each slot pulls most of that gap back.
 *
 * IT READS ITS SENDER FROM THE ROW IT SITS IN and takes no sender prop at all. Outside a row it
 * draws as the assistant side at the middle density, which is the standalone default a story or a
 * hand-built row gets. That is why `sender` is the ROW's axis and is not restated on this entry:
 * there is no way to set it here, so declaring it would be a vocabulary this component cannot read.
 */
export const ChatMessageBubble = React.forwardRef<HTMLDivElement, ChatMessageBubbleProps>(
  function ChatMessageBubble(
    { group = 'none', width = 'auto', ghost = false, name, metadata, children, className, ...rest },
    ref,
  ) {
    const sender = useSender();
    const density = useDensity();
    /* The user side tucks toward the inline END, the other two toward the inline START — logical
       rather than physical, so a right-to-left reader gets the tuck on the side the message is on. */
    const group_ = sender === 'user' ? GROUP_END[group] : GROUP_START[group];

    return (
      <>
        {name !== undefined && (
          <div className={cn(MESSAGE_NAME, MESSAGE_INSET[density], MESSAGE_AUTHOR_PULL[density])}>{name}</div>
        )}
        <div
          ref={ref}
          /* THE RESOLVED SENDER, REFLECTED. Not decoration: the two turns hold the same fill
             today, so "this bubble drew as the assistant" is otherwise unobservable — a
             standalone bubble that started resolving to the user side would produce an identical
             class list, and the assertion for the standalone default would pass over it. */
          data-sender={sender}
          data-group={group}
          data-width={width}
          data-ghost={ghost ? '' : undefined}
          className={cn(
            MESSAGE_BUBBLE_BASE,
            MESSAGE_INSET[density],
            /* SUBSTITUTED, NOT APPENDED. The class merger knows Tailwind's own utility values and
               not the design system's named rungs, so two vertical paddings on one element are not
               a conflict it can resolve: both survive and the stylesheet's order decides which
               paints. A ghost that appended a zeroing entry was inert with every class name on the
               element still correct. See the table's own note. */
            ghost
              ? MESSAGE_BUBBLE_GHOST
              : cn(MESSAGE_BLOCK[density], MESSAGE_BUBBLE_SENDER[sender]),
            group_,
            WIDTH[width],
            className,
          )}
          {...rest}
        >
          {children}
        </div>
        {metadata !== undefined && (
          <div className={cn(MESSAGE_INSET[density], MESSAGE_META_PULL[density])}>{metadata}</div>
        )}
      </>
    );
  },
);
