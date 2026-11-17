import React from 'react';
import { FlatList, View, type FlatListProps } from 'react-native';
import { contract } from '../contract';
import { defaultItemKey, startLoadOlder } from './message-follow';
import {
  MESSAGE_LIST_ALIGN,
  MESSAGE_LIST_DENSITY_GAP,
  MESSAGE_LIST_EMPTY,
  MESSAGE_LIST_EMPTY_TYPE,
  MESSAGE_LIST_GAP,
  MESSAGE_LIST_PAD,
  MESSAGE_LIST_PENDING,
} from './message-styles';
import { ListProvider, SlotText, useThreadContext, type ChatMessageDensity } from './message-support';
import { Spinner } from './Spinner';

type Axes = typeof contract.ChatMessageList.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * The platform list's props this component OWNS, and so does not accept from a caller.
 *
 * `inverted` above all — see `ChatThread` for why the transcript is never inverted, and a caller
 * flipping it would silently reverse the reading order the family exists to keep. The separator,
 * empty and header components are how the contract's `gap`, `emptyState` and load-older pending
 * row are drawn; `onStartReached` and `maintainVisibleContentPosition` are load-older's.
 */
type Owned =
  | 'inverted'
  | 'ItemSeparatorComponent'
  | 'ListEmptyComponent'
  | 'ListHeaderComponent'
  | 'onStartReached'
  | 'onStartReachedThreshold'
  | 'maintainVisibleContentPosition'
  | 'children';

export interface ChatMessageListProps<ItemT> extends Omit<FlatListProps<ItemT>, Owned> {
  /** How much room the rows take. Flows to every row and bubble inside through context. */
  density?: Of<'density'>;
  /**
   * Where a SHORT conversation sits. `bottom` — the default — seats it above the composer; `top` is
   * for a transcript embedded in a page that reads downward. Identical once the content overflows.
   */
  align?: Of<'align'>;
  /** Overrides the density's own row gap and leaves its padding alone. */
  gap?: Of<'gap'>;
  /** A reply is arriving. Reported as busy only while true — absent, never `false`, otherwise. */
  streaming?: boolean;
  /** The region's accessible name. */
  label?: string;
  /** What to show when the list holds nothing. A string takes the empty state's type. */
  emptyState?: React.ReactNode;
  /**
   * Load the messages above. Supply it and reaching the top fires it — ONCE PER ARRIVAL, never once
   * per edge event — with a pending row until it settles. Drop it to say "no older pages left".
   */
  scrollToTopAction?: () => void | Promise<void>;
}

/**
 * The transcript's list — the native sibling of the web `ChatMessageList` (UMK-1129). Built ahead
 * of its screen; `ChatMessage`'s docblock says why.
 *
 * A `FlatList`, BECAUSE ON NATIVE THE PLATFORM LIST OWNS SCROLLING AND VIRTUALISATION. The web list
 * owns no scroller — its frame does — and takes its rows as `children`. Here the list IS the
 * scroller, and a virtualised list renders from `data` through `renderItem`: rows outside the
 * window are never mounted, which is the whole point of reaching for one on a phone. So the web's
 * `children` is the one prop this sibling does not take — recorded on the contract entry as a
 * `partial`, rather than faked by flattening children into data, which would build every row
 * element up front and hand the list a key only React knows.
 *
 * Every contract axis crosses: `density` flows to the rows through context and sets the padding;
 * `gap` SELECTS a separator height instead of the density's, never stacks one on it; `align` seats
 * a short conversation by justifying a content container that grows to the viewport.
 *
 * IT FEEDS THE FRAME. Inside a `ChatThread` it hands the frame its instance, its scroll, size and
 * layout events and the key of its last item — the seam the follow runs on. Outside one it wires
 * nothing and is an ordinary list; a host's own handlers are still called either way.
 *
 * WHAT THE WEB LOG DOES THAT A PLATFORM LIST CANNOT, and neither is a prop: the web region is a
 * polite `log` that announces each arriving row. React Native has no log role, and Android's live
 * region on a scroll container re-announces its WHOLE content on every change — on a streaming
 * transcript, the conversation read aloud once per token. So no live region is set; `streaming`
 * still reaches assistive technology as the busy state, and inside a `ChatThread` an arrival the
 * reader is scrolled away from is announced ONCE by the frame (see `ChatThread`) and named on the
 * pill. What does not carry is the web log reading each arriving row's CONTENT while the reader
 * follows — recorded on the contract entry. And the web root takes keyboard focus so a
 * keyboard can scroll it; a native list is scrolled by the platform's own gestures.
 */
export const ChatMessageList = <ItemT,>({
  density = 'balanced',
  align = 'bottom',
  gap,
  streaming = false,
  label,
  emptyState,
  scrollToTopAction,
  data,
  keyExtractor,
  contentContainerStyle,
  onScroll,
  onContentSizeChange,
  onLayout,
  onScrollBeginDrag,
  renderItem,
  scrollEventThrottle,
  keyboardShouldPersistTaps,
  ...rest
}: ChatMessageListProps<ItemT>) => {
  const thread = useThreadContext();
  const value = React.useMemo<{ density: ChatMessageDensity }>(() => ({ density }), [density]);

  /* SELECTED, NOT STACKED — the web's rule, one separator height either way. */
  const between = gap === undefined ? MESSAGE_LIST_DENSITY_GAP[density] : MESSAGE_LIST_GAP[gap];
  const Separator = React.useMemo(() => {
    const GapBetweenRows = () => <View style={{ height: between }} />;
    return GapBetweenRows;
  }, [between]);

  /* The in-flight flag lives in a ref for the list's life — see `startLoadOlder` for the run where
     it lived in a narrower scope and loaded every page twice. The action is read through a ref, so
     a host passing an inline callback needs no memoisation discipline. */
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const inFlight = React.useRef({ inFlight: false });
  const actionRef = React.useRef(scrollToTopAction);
  actionRef.current = scrollToTopAction;
  const loadable = scrollToTopAction !== undefined;
  /* SET IN THE BODY, NOT ONLY IN THE INITIALISER. React re-runs this effect on the SAME instance
     with its refs preserved — StrictMode's dev remount does exactly that — and a ref only the
     cleanup writes latches false after the first pass, so every later settle skips
     `setLoadingOlder(false)` and the pending row strands above the transcript. */
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /**
   * ARMED ONLY ONCE THE LIST HAS LEFT ITS MOUNT POSITION (PR #1117 review). A list mounts at offset
   * 0, and RN's start check is `distanceFromStart <= threshold` — true at 0 for ANY threshold — so
   * a long transcript loaded an older page on its first measure, before its frame carried it to the
   * end and before the reader touched it. The web is safe because its transcript OPENS at the end.
   *
   * So RN gets no callback until one of three things is true, each a moment the top being on
   * screen means the reader is looking at it:
   *  - the list has scrolled off 0 (the frame's settle to the end, or the reader);
   *  - the reader dragged it (pulling at the very top, where no offset changes);
   *  - it has nothing to scroll: every row rendered and the content fits the viewport — the web's
   *    sentinel is visible there too, and without this a short conversation with older pages would
   *    be stuck on a platform with no overscroll.
   * Gating the PROP, not ignoring calls: RN records a call as sent for its content length, so a
   * swallowed call would silence the next real arrival at the top. And RN re-checks the top only on
   * a scroll, layout or content-size event, never on a prop change — so the one arming moment
   * where the top is already on screen and no further event is coming, the short list, loads
   * directly. A drag at 0 needs no such help: the pull itself scrolls (the bounce), and RN checks
   * that event against the armed callback.
   */
  const [armed, setArmed] = React.useState(false);
  const measured = React.useRef({ content: 0, viewport: 0, lastRendered: -1 });
  const count = data?.length ?? 0;
  const armIfShort = () => {
    const m = measured.current;
    if (m.content > 0 && m.viewport > 0 && m.content <= m.viewport && m.lastRendered >= count - 1) {
      setArmed(true);
      if (loadable) onStartReached();
    }
  };
  const trackedRenderItem = React.useMemo(
    () =>
      renderItem
        ? (info: Parameters<NonNullable<typeof renderItem>>[0]) => {
            if (info.index > measured.current.lastRendered) measured.current.lastRendered = info.index;
            return renderItem(info);
          }
        : renderItem,
    [renderItem],
  );

  /* Dropping the action mid-flight is how a host says "no older pages left"; the pending row goes
     with it rather than being stranded. */
  React.useEffect(() => {
    if (!loadable) setLoadingOlder(false);
  }, [loadable]);

  const onStartReached = React.useCallback(() => {
    const started = startLoadOlder(inFlight.current, actionRef.current, () => {
      if (mounted.current) setLoadingOlder(false);
    });
    if (started) setLoadingOlder(true);
  }, []);

  /* The last item's key AND the length, reported to the frame so it can tell an ARRIVAL from
     growth, a removal or an older page (`isArrival`). */
  const last = count > 0 ? data![count - 1] : undefined;
  const lastKey = count > 0 ? (keyExtractor ? keyExtractor(last as ItemT, count - 1) : defaultItemKey(last, count - 1)) : null;
  const report = thread?.onLastItem;
  React.useEffect(() => {
    report?.(lastKey, count);
  }, [report, lastKey, count]);

  return (
    <ListProvider value={value}>
      <FlatList
        {...rest}
        ref={thread?.attachList as React.Ref<FlatList<ItemT>> | undefined}
        data={data}
        renderItem={trackedRenderItem}
        keyExtractor={keyExtractor}
        /* COALESCED, NOT OWNED. `label` and `streaming` are this component's way of saying these
           two, and a caller's own `accessibilityLabel` / `accessibilityState` through `...rest`
           still stands when those are unset — an explicit `undefined` here would erase it. */
        accessibilityLabel={label ?? rest.accessibilityLabel}
        /* ABSENT RATHER THAN FALSE, the web's rule: a region permanently reporting that it is not
           busy is noise on every settled turn. Streaming MERGES busy into a caller's state. */
        accessibilityState={streaming ? { ...rest.accessibilityState, busy: true } : rest.accessibilityState}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          loadable && loadingOlder ? (
            <View style={MESSAGE_LIST_PENDING}>
              <Spinner size="sm" label="Memuat pesan sebelumnya" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          emptyState === undefined ? null : (
            <View style={MESSAGE_LIST_EMPTY}>
              <SlotText role={MESSAGE_LIST_EMPTY_TYPE.role} color={MESSAGE_LIST_EMPTY_TYPE.color}>
                {emptyState}
              </SlotText>
            </View>
          )
        }
        onStartReached={loadable && armed ? onStartReached : undefined}
        /* THE TOP MUST BE ON SCREEN, the web's rule: its sentinel fires only when it intersects the
           scroller, where RN's default (2) is a prefetch two viewports deep. This alone does NOT
           cover the mount pass — `armed` above does. RN re-arms the call once the list leaves the
           window, so the reader reaching the top again fires it again. */
        onStartReachedThreshold={0}
        /* Prepending older rows keeps the reader's place — armed only while load-older is, so a
           list that never prepends is an ordinary list. */
        maintainVisibleContentPosition={loadable ? { minIndexForVisible: 0 } : undefined}
        contentContainerStyle={[
          { flexGrow: 1, justifyContent: MESSAGE_LIST_ALIGN[align], padding: MESSAGE_LIST_PAD[density] },
          contentContainerStyle,
        ]}
        scrollEventThrottle={scrollEventThrottle ?? 16}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'handled'}
        onScroll={(event) => {
          if (!armed && event.nativeEvent.contentOffset.y > 0) setArmed(true);
          thread?.onScroll(event);
          onScroll?.(event);
        }}
        onScrollBeginDrag={(event) => {
          if (!armed) setArmed(true);
          onScrollBeginDrag?.(event);
        }}
        onContentSizeChange={(width, height) => {
          measured.current.content = height;
          if (!armed) armIfShort();
          thread?.onContentSizeChange(width, height);
          onContentSizeChange?.(width, height);
        }}
        onLayout={(event) => {
          measured.current.viewport = event.nativeEvent.layout.height;
          if (!armed) armIfShort();
          thread?.onLayout(event);
          onLayout?.(event);
        }}
      />
    </ListProvider>
  );
};

ChatMessageList.displayName = 'ChatMessageList';
