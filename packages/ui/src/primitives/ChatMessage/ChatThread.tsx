'use client';

import React from 'react';
import { cn } from '../../utils';
import {
  MESSAGE_THREAD_PILL_SLOT,
  MESSAGE_THREAD_ROOT,
  MESSAGE_THREAD_SCROLLER,
} from '../message-classes';
import { ChatScrollButton } from './ChatScrollButton';
import { ThreadProvider } from './message-context';
import { useChatStreamScroll, type ChatStreamScroll } from './use-chat-stream-scroll';

export interface ChatThreadProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The affordance that brings a reader back, as a slot with a working default.
   *
   * A RENDER FUNCTION RATHER THAN A NODE, because the thing a surface would want to change about
   * the pill — whether it is showing, what it says, whether it is marked — is all state this frame
   * owns. Passing a node would mean the surface either re-deriving that state or accepting a pill
   * it cannot drive.
   */
  pill?: (state: ChatStreamScroll) => React.ReactNode;
  /** The default pill's accessible name. Ignored when `pill` supplies its own. */
  scrollToBottomLabel?: string;
  /**
   * Changes when the transcript becomes a DIFFERENT conversation; forwarded to the scroll follow
   * so a switch re-pins instead of springing through the new history. Native mirror: UMK-1371 (UMK-1041).
   */
  resetKey?: string | number;
  /**
   * Keep the newest message in view when this frame's own height changes (a sheet under the phone keyboard). Opt-in, default
   * off: the unified chat passes nothing and its follow is unchanged. See `useChatStreamScroll`.
   */
  followResize?: boolean;
  children?: React.ReactNode;
}

/**
 * The transcript frame: the element that owns the scroller.
 *
 * IT COMPOSES INSIDE THE APP SHELL'S CONTENT SLOT AND CHANGES NOTHING ABOUT IT. There is no
 * collision to resolve, which is worth saying because it looks like one — the shell documents that
 * slot as owning the scroller and pins both of its minimums precisely so a child can scroll, and
 * its scroll spy resolves the region once and tests containment, so it still sees this scroller's
 * events and keeps feeding the header its shadow.
 *
 * IT PUBLISHES THE SCROLLER AND COLLECTS THE LIST'S INNER ELEMENT. That seam is absent-tolerant by
 * design — a list rendered outside a frame registers nothing and still works — which is also the
 * hazard: a frame that never published would leave the follow permanently inert, with nothing
 * throwing and nothing blank, because a missing provider is a SUCCESSFUL read of the default. The
 * family's behaviour guard asserts the wiring rather than trusting it.
 */
export const ChatThread = React.forwardRef<HTMLDivElement, ChatThreadProps>(function ChatThread(
  { pill, scrollToBottomLabel = 'Ke pesan terbaru', resetKey, followResize, children, className, ...rest },
  ref,
) {
  /**
   * THE SCROLLER IS STATE, NOT A REF, AND THE CALLBACK REF IS WHAT MAKES IT ONE.
   *
   * It was a `useRef` for one run. Everything downstream — the hook's two effects, the list's
   * sentinel observer — early-returns on a null scroller and depends on a ref object whose
   * identity never changes, so nothing re-ran when the element appeared. This frame renders its
   * scroller unconditionally, so it was always safe HERE; the seam it publishes is not, and a host
   * mounting a list behind a loading branch inherited a follow that wired nothing.
   */
  const [scroller, setScroller] = React.useState<HTMLDivElement | null>(null);
  const [content, setContent] = React.useState<HTMLElement | null>(null);

  /* Stable, so a list does not re-register on every unrelated render of this frame. */
  const registerContent = React.useCallback((element: HTMLElement | null) => {
    setContent(element);
  }, []);
  const seam = React.useMemo(
    () => ({ scrollContainer: scroller, registerContent }),
    [scroller, registerContent],
  );

  const scroll = useChatStreamScroll({ container: scroller, content, resetKey, followResize });

  return (
    <div ref={ref} className={cn(MESSAGE_THREAD_ROOT, className)} {...rest}>
      <div ref={setScroller} data-thread-scroller className={MESSAGE_THREAD_SCROLLER}>
        <ThreadProvider value={seam}>{children}</ThreadProvider>
      </div>
      {scroll.isScrolledUp && (
        <div className={MESSAGE_THREAD_PILL_SLOT}>
          {pill === undefined ? (
            <ChatScrollButton
              label={scrollToBottomLabel}
              hasNewMessages={scroll.hasNewMessages}
              onClick={scroll.scrollToBottom}
            />
          ) : (
            pill(scroll)
          )}
        </div>
      )}
    </div>
  );
});
