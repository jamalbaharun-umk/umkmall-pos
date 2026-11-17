'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon, type IconName } from '../Icon';
import {
  MESSAGE_META_DIRECTION,
  MESSAGE_META_GLYPH,
  MESSAGE_META_ROOT,
  MESSAGE_META_SEPARATOR,
  MESSAGE_META_STATUS,
  MESSAGE_META_STATUS_GROUP,
} from '../message-classes';
import { isMetadataPresent, MESSAGE_STATUS_DRAWN } from '../../shared/message-status';
import { useSender } from './message-context';

type Axes = typeof contract.ChatMessageMetadata.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const STATUS = MESSAGE_META_STATUS satisfies Record<Of<'status'>, string>;

/**
 * WHAT EACH STATUS DRAWS AND WHAT IT IS CALLED — the shared table, narrowed to this platform's
 * icon registry. It lives in `shared/message-status.ts` so the native sibling reads the same five
 * labels rather than a copy of them (UMK-1129); the reasoning for sharing a glyph between
 * `delivered` and `read` is recorded there.
 */
const DRAWN = MESSAGE_STATUS_DRAWN satisfies Record<Of<'status'>, { icon: IconName; label: string }>;

export interface ChatMessageMetadataProps extends React.HTMLAttributes<HTMLDivElement> {
  /** When the message was sent, already formatted. This component never formats a time. */
  timestamp?: React.ReactNode;
  /** Anything the host wants between the time and the status — a model name, a cost, an action. */
  footer?: React.ReactNode;
  /** Where the message got to. Omit it entirely for a row that has no delivery state to report. */
  status?: Of<'status'>;
}

/**
 * The line under a message: a time, whatever the host wants beside it, and a delivery status.
 *
 * IT RENDERS NOTHING WHEN GIVEN NOTHING. That is a real branch and not a nicety — a caller renders
 * this under every row and most rows have nothing to say, so an always-present empty element would
 * add a gap to the transcript's commonest state and a caller would have to mount it conditionally,
 * which is the job this does.
 *
 * THE SEPARATORS ARE COMPUTED FROM WHAT IS PRESENT, never rendered beside each piece. A dot
 * attached to the timestamp leaves a dangling mark whenever the host supplies only a time, which
 * is most rows.
 *
 * THE LABEL IS USED THREE WAYS — the visible word, the hover title, and lower-cased as the
 * accessible name. The lower-casing is deliberate: the row is announced as one phrase, and a
 * capitalised fragment in the middle of it reads as the start of a new sentence.
 */
export const ChatMessageMetadata = React.forwardRef<HTMLDivElement, ChatMessageMetadataProps>(
  function ChatMessageMetadata({ timestamp, footer, status, className, ...rest }, ref) {
    const sender = useSender();

    const pieces: React.ReactNode[] = [];
    if (isMetadataPresent(timestamp)) pieces.push(<span key="time">{timestamp}</span>);
    if (isMetadataPresent(footer)) pieces.push(<span key="footer">{footer}</span>);
    if (status !== undefined) {
      const { icon, label } = DRAWN[status];
      pieces.push(
        <span
          key="status"
          data-status={status}
          title={label}
          aria-label={label.toLowerCase()}
          className={cn(MESSAGE_META_STATUS_GROUP, STATUS[status])}
        >
          <Icon name={icon} aria-hidden className={MESSAGE_META_GLYPH} />
          <span>{label}</span>
        </span>,
      );
    }

    if (pieces.length === 0) return null;

    return (
      <div
        ref={ref}
        data-sender={sender}
        className={cn(MESSAGE_META_ROOT, MESSAGE_META_DIRECTION[sender], className)}
        {...rest}
      >
        {pieces.map((piece, at) => (
          /* The separator belongs BETWEEN two present pieces, so it is emitted from the gap rather
             than from either side of it. The index is a stable key here because the list is built
             in one pass from three fixed slots and never reorders. */
          <React.Fragment key={at}>
            {at > 0 && (
              <span aria-hidden className={MESSAGE_META_SEPARATOR}>
                ·
              </span>
            )}
            {piece}
          </React.Fragment>
        ))}
      </div>
    );
  },
);
