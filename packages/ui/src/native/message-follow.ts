import { measure } from './theme';

/**
 * The transcript's FOLLOW rule and its load-older guard, as plain functions (UMK-1129).
 *
 * The native reading of the web's `useChatStreamScroll` and of `ChatMessageList`'s in-flight
 * guard. Pulled out of the components so the vitest suite can call them — `react-native` does not
 * load there — and so `message-follow.test.ts` pins the decisions rather than a render of them.
 * This module imports nothing from `react-native`, and must keep it that way for the same reason.
 *
 * WHAT DOES NOT CARRY FROM THE WEB HOOK, and why none of it is needed:
 *
 * - The per-frame easing loop. The web writes `scrollTop` a fifth of the remaining distance per
 *   animation frame because a DOM scroll box has no animated "go to the end" that keeps up with
 *   content still growing. A platform list does: `scrollToEnd({ animated })` is the platform's
 *   own animation, and calling it again as the content grows is what `ThreadView` already does.
 * - The `overflow-anchor` rule. That is a browser's scroll anchoring fighting the follow; a
 *   native list keeps its offset from the TOP and anchors nothing unless asked
 *   (`maintainVisibleContentPosition`, which the list sets only while load-older is armed).
 * - The content `ResizeObserver` and the marker attribute the web finds the last message by. A
 *   platform list reports its own content size and knows its own last item, so the list hands
 *   both to the frame directly.
 */

/**
 * The web hook's two thresholds, read off the measurement ladder they happen to sit on rather
 * than typed as numbers. They are distances a finger travels, not sizes anything is drawn at.
 */

/** Within this of the end a reader is AT the bottom, so a move that lands there is not a release. */
export const FOLLOW_BOTTOM = measure['0-25'];

/** Within this of the end a released reader re-engages the follow. */
export const FOLLOW_RELOCK = measure['2'];

export type FollowStep = 'release' | 'engage' | 'hold';

/**
 * What one scroll event means for the follow.
 *
 * RELEASE FIRST: a reader moving UP and landing anywhere but the bottom has asked to read, and
 * that wins over the proximity test, so a gesture passing near the end on its way up does not
 * re-engage on the same event.
 *
 * POSITION IS THE WHOLE SIGNAL, the web's rule. A content SHRINK clamps the offset down and
 * arrives as a move up that has LANDED at the bottom — the first arm refuses it and the reader
 * keeps following. The keyboard opening is the mirror case and is also not a release: the
 * viewport shrinks, the offset does not move, and the frame's layout handler takes the list back
 * to the end.
 */
export const followStep = ({
  top,
  lastTop,
  contentHeight,
  viewportHeight,
  locked,
}: {
  top: number;
  lastTop: number;
  contentHeight: number;
  viewportHeight: number;
  locked: boolean;
}): FollowStep => {
  const distance = contentHeight - top - viewportHeight;
  const atBottom = distance <= FOLLOW_BOTTOM;
  if (top < lastTop && !atBottom) return 'release';
  if (!locked && distance <= FOLLOW_RELOCK) return 'engage';
  return 'hold';
};

/**
 * Fire the load-older action ONCE PER ARRIVAL, never once per edge event.
 *
 * `onStartReached` fires again while the first call is still unresolved — the pending row renders
 * above the content and the list is still at its start — and a host that prepends on every call
 * loads the same page twice. So the flag lives in a holder the CALLER keeps for the component's
 * life (a ref), never in a local that a re-render resets: the web list shipped that shape for one
 * run and it reintroduced the double load it existed to prevent.
 *
 * THE CALL IS MADE INSIDE THE PROMISE. A host callback that throws synchronously would otherwise
 * escape before `finally` is attached and leave the flag set for good — load-older dead until
 * unmount. The rejection is swallowed because the host owns reporting its own failure; what this
 * owes the host is a component that still works afterwards.
 *
 * Returns whether it started a call, so the component knows whether to show the pending row.
 */
export const startLoadOlder = (
  state: { inFlight: boolean },
  action: (() => void | Promise<void>) | undefined,
  settle: () => void,
): boolean => {
  if (state.inFlight || action === undefined) return false;
  state.inFlight = true;
  void (async () => action())()
    .catch(() => {})
    .finally(() => {
      state.inFlight = false;
      settle();
    });
  return true;
};

/** What the list reports about its tail: the last item's key (null when empty) and its length. */
export interface ListTail {
  key: string | null;
  count: number;
}

/**
 * Is this report an ARRIVAL — a new message at the end — rather than growth, a removal, a swap or
 * an older page landing above?
 *
 * BOTH HALVES, because either alone lies. A changed last key alone reads a REMOVAL as an arrival
 * when the host has no ids: `defaultItemKey` falls back to the index, so deleting any row changes
 * the last key from `"4"` to `"3"`. A grown count alone reads a load-older page — prepended, the
 * last row untouched — as one. An arrival is the list getting LONGER with a DIFFERENT last item.
 * (With INDEX keys a prepended page still reads as an arrival — the last index moves too, and no
 * rule over key and count can tell the two apart. A host that pages older messages has ids.)
 * A same-length swap (an optimistic row replaced by the server's) is not an arrival either: the
 * reader was told about that row when it first landed.
 *
 * The first report (`previous` undefined) is the conversation as it opened, never an arrival.
 */
export const isArrival = (previous: ListTail | undefined, next: ListTail): boolean =>
  previous !== undefined && next.key !== null && next.count > previous.count && next.key !== previous.key;

/**
 * The key a platform list gives an item when the host passes no `keyExtractor` — `FlatList`'s own
 * default: an item's `key`, else its `id`, else its index. Mirrored so the frame can tell a NEW last
 * item from the old one growing, which is the whole of the new-message mark. The index fallback is
 * why `isArrival` also demands the count grew.
 */
export const defaultItemKey = (item: unknown, index: number): string => {
  if (typeof item === 'object' && item !== null) {
    const { key, id } = item as { key?: unknown; id?: unknown };
    if (typeof key === 'string' || typeof key === 'number') return String(key);
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  return String(index);
};
