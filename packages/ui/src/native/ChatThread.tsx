import React from 'react';
import {
  AccessibilityInfo,
  View,
  type FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';
import { ChatScrollButton } from './ChatScrollButton';
import { followStep, isArrival, type ListTail } from './message-follow';
import { MESSAGE_THREAD_PILL_SLOT, MESSAGE_THREAD_ROOT } from './message-styles';
import { ThreadProvider, useReducedMotion, type ThreadSeam } from './message-support';

/**
 * The default one-shot announcement. No web string to copy: the web frame announces nothing itself
 * because its log region reads every arriving row, which native deliberately does not do.
 */
export const NEW_MESSAGE_ANNOUNCEMENT = 'Ada pesan baru';

/** What the frame knows about the reader's position — the same shape the web hook returns. */
export interface ChatStreamScroll {
  /** The reader has moved away from the latest message; the follow is released. */
  isScrolledUp: boolean;
  /** A NEW message arrived while the reader was away — not the current one growing. */
  hasNewMessages: boolean;
  /** Re-engage the follow and bring the latest message into view. */
  scrollToBottom: () => void;
}

export interface ChatThreadProps extends ViewProps {
  /**
   * The affordance that brings a reader back, as a slot with a working default. A render function,
   * for the web's reason: everything a surface would change about the pill is state this frame owns.
   */
  pill?: (state: ChatStreamScroll) => React.ReactNode;
  /** The default pill's accessible name. Ignored when `pill` supplies its own. */
  scrollToBottomLabel?: string;
  /**
   * What a screen reader hears, ONCE, when a message arrives while the reader is scrolled away —
   * "Ada pesan baru" by default. The frame announces it whichever pill is in the slot, because the
   * frame is what knows a message arrived. An empty string turns the announcement off, for a host
   * that announces arrivals itself.
   */
  newMessageAnnouncement?: string;
  /**
   * Changes when the transcript becomes a DIFFERENT conversation — the web frame's prop of the
   * same name (UMK-1041), mirrored in UMK-1371. For a host that swaps the list's data in place
   * instead of remounting the list: the frame forgets the last conversation exactly as it does
   * when the list unmounts (see "A NEW LIST IS A NEW CONVERSATION" below) and jumps to the end
   * of the new one. Without it a reader who had scrolled up in the last conversation opens the
   * next one released, with the pill up, and its first rows are announced as arrivals.
   */
  resetKey?: string | number;
  /** The transcript — a `ChatMessageList`, which is the element that actually scrolls. */
  children?: React.ReactNode;
}

/**
 * The transcript FRAME — the native sibling of the web `ChatThread` (UMK-1129). Built ahead of its
 * screen; `ChatMessage`'s docblock says why.
 *
 * ON NATIVE THE PLATFORM LIST OWNS THE SCROLLING, so this frame owns the FOLLOW rather than a scroll
 * box. The web frame renders the scroller and watches the list's content element grow; here the
 * `ChatMessageList` inside is a `FlatList`, the one element that receives scroll, size and layout
 * events, and it feeds them to this frame through the seam (`message-support.tsx`). The follow
 * decisions are `message-follow.ts`'s — the web hook's rule, position as the whole signal.
 *
 * NOT INVERTED, and the reasons are the two things this family promises:
 *
 * - READING ORDER. An inverted list flips a normal one with a transform, so its view order is
 *   newest-first while it draws oldest-at-top: a screen reader walking the transcript meets it
 *   BACKWARDS. The web contract's whole user-side flip is built to keep one authored order for
 *   assistive technology; an inverted list would throw that away on the platform with the most
 *   screen-reader use in this product.
 * - THE ALIGNMENT AXIS. `align: 'top'` is a real value — a transcript embedded in a page that reads
 *   downward — and an inverted list can only seat content at the bottom.
 *
 * What inversion would have bought for free is kept by hand, the way `ThreadView` already keeps
 * it: content GROWING while the reader is following scrolls to the end (`onContentSizeChange`), and
 * the WINDOW shrinking — the keyboard opening under a `KeyboardAvoidingView`, a composer growing a
 * line — takes the list back to the end as a JUMP (`onLayout`), because a list keeps its offset from
 * the top when its frame shrinks and the last message would otherwise slide under the keyboard.
 *
 * AN ARRIVAL THE READER CANNOT SEE IS SPOKEN, ONCE. The web log region reads each arriving row;
 * native sets no live region (`ChatMessageList` says why), so without something in its place a
 * screen-reader user scrolled up would get no signal at all — the mark is drawn, not spoken. Two
 * things replace it, both keyed on an ARRIVAL (`isArrival`: the list grew AND its last item
 * changed), so a streamed reply growing token by token, a removal and — with stable keys — an
 * older page landing above are all silent:
 *
 * - a one-shot `announceForAccessibility` of `newMessageAnnouncement`, per arrival, only while
 *   the reader is away — a reader who is following is already at the message. Queued on iOS so it
 *   does not cut off what VoiceOver is reading. On Android it is a TYPE_ANNOUNCEMENT event, which
 *   speaks only its own string: it does NOT re-read the transcript, which is the whole difference
 *   from the live region refused on the list, so it is made on both platforms.
 * - the default pill's accessible name gains "ada pesan baru" while the mark is up, so the news is
 *   still there when the reader finds the pill later (`ChatScrollButton`).
 *
 * A NEW LIST IS A NEW CONVERSATION. When the list unmounts (the seam's `attachList(null)`) the
 * frame forgets it — the last key, the follow, the pill and its mark — so a host that switches
 * conversations by remounting the list (a `key` per conversation) opens the next one following,
 * with no mark and no announcement carried over from the last.
 *
 * THE PILL IS A SLOT WITH A WORKING DEFAULT, rendered only while the reader is away from the bottom.
 * The slot takes no touch of its own (`box-none`), so the strip across the foot does not swallow a
 * tap meant for the last message.
 *
 * AUTOCAPTURE: this frame forwards every view prop to its root, which is the element to put a
 * host's `ph-no-capture` marker on — see `ChatScrollButton`.
 */
export const ChatThread = ({
  pill,
  scrollToBottomLabel = 'Ke pesan terbaru',
  newMessageAnnouncement = NEW_MESSAGE_ANNOUNCEMENT,
  resetKey,
  children,
  style,
  ...rest
}: ChatThreadProps) => {
  const reduceMotion = useReducedMotion();
  const [isScrolledUp, setIsScrolledUp] = React.useState(false);
  const [hasNewMessages, setHasNewMessages] = React.useState(false);

  const list = React.useRef<FlatList<unknown> | null>(null);
  /* Everything the follow reads between events lives in refs: a scroll event must see the answer
     the previous one left, not the one the last render happened to capture. */
  const locked = React.useRef(true);
  const lastTop = React.useRef(0);
  const viewport = React.useRef(0);
  const firstFill = React.useRef(true);
  const tail = React.useRef<ListTail | undefined>(undefined);
  const reduce = React.useRef(reduceMotion);
  reduce.current = reduceMotion;
  const announcement = React.useRef(newMessageAnnouncement);
  announcement.current = newMessageAnnouncement;

  /* A changed `resetKey` is a different conversation. The REFS are forgotten here, during the
     render that carries the new key, and not in the effect below: the list's own effects run
     before this frame's, so a tail report for the new conversation would otherwise be compared
     against the old one's and announced as an arrival. */
  const conversation = React.useRef(resetKey);
  if (conversation.current !== resetKey) {
    conversation.current = resetKey;
    tail.current = undefined;
    locked.current = true;
    lastTop.current = 0;
    firstFill.current = true;
  }

  /** Go to the end. `instant` for the first fill and for a frame change; animated otherwise. */
  const settle = React.useCallback((instant: boolean) => {
    list.current?.scrollToEnd({ animated: !instant && !reduce.current });
  }, []);

  const release = React.useCallback(() => {
    locked.current = false;
    setIsScrolledUp(true);
  }, []);

  const engage = React.useCallback(() => {
    locked.current = true;
    setIsScrolledUp(false);
    setHasNewMessages(false);
  }, []);

  const scrollToBottom = React.useCallback(() => {
    engage();
    settle(false);
  }, [engage, settle]);

  /* The visible half of a `resetKey` change: drop the pill and its mark, and JUMP — animating
     would play the new conversation's history past the reader. Skipped on mount, where there is
     nothing to forget and the first fill already jumps. */
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    engage();
    settle(true);
  }, [resetKey, engage, settle]);

  /* Stable for the frame's life: every handler reads refs, so the list never re-renders because
     this seam changed identity. */
  const seam = React.useMemo<ThreadSeam>(
    () => ({
      attachList: (instance) => {
        list.current = instance;
        if (instance !== null) return;
        /* The list went away: whatever mounts next is a different conversation. */
        tail.current = undefined;
        locked.current = true;
        lastTop.current = 0;
        firstFill.current = true;
        setIsScrolledUp(false);
        setHasNewMessages(false);
      },
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const step = followStep({
          top: contentOffset.y,
          lastTop: lastTop.current,
          contentHeight: contentSize.height,
          viewportHeight: layoutMeasurement.height,
          locked: locked.current,
        });
        if (step === 'release') release();
        else if (step === 'engage') engage();
        lastTop.current = contentOffset.y;
      },
      onContentSizeChange: (_width: number, height: number) => {
        if (!locked.current) return;
        /* The first fill of a conversation is a JUMP: animating it plays the whole history past a
           reader who came back to continue it. After that, growth is animated — the movement is
           the feedback that a reply is arriving. */
        const scrollable = height > viewport.current;
        settle(firstFill.current && scrollable);
        if (scrollable) firstFill.current = false;
      },
      onLayout: (event: LayoutChangeEvent) => {
        viewport.current = event.nativeEvent.layout.height;
        if (locked.current) settle(true);
      },
      onLastItem: (key: string | null, count: number) => {
        const previous = tail.current;
        tail.current = { key, count };
        if (!isArrival(previous, tail.current) || locked.current) return;
        setHasNewMessages(true);
        /* Per ARRIVAL, never per token: a streamed reply grows its row and changes neither half. */
        if (announcement.current) {
          AccessibilityInfo.announceForAccessibilityWithOptions(announcement.current, { queue: true });
        }
      },
    }),
    [engage, release, settle],
  );

  const state: ChatStreamScroll = { isScrolledUp, hasNewMessages, scrollToBottom };

  return (
    <View {...rest} style={[MESSAGE_THREAD_ROOT, style]}>
      <ThreadProvider value={seam}>{children}</ThreadProvider>
      {isScrolledUp && (
        <View style={MESSAGE_THREAD_PILL_SLOT}>
          {pill === undefined ? (
            <ChatScrollButton label={scrollToBottomLabel} hasNewMessages={hasNewMessages} onPress={scrollToBottom} />
          ) : (
            pill(state)
          )}
        </View>
      )}
    </View>
  );
};

ChatThread.displayName = 'ChatThread';
