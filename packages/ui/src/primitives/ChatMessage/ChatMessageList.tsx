'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Spinner } from '../Spinner';
import {
  MESSAGE_LIST_CONTENT,
  MESSAGE_LIST_DENSITY_GAP,
  MESSAGE_LIST_EMPTY,
  MESSAGE_LIST_GAP,
  MESSAGE_LIST_PAD,
  MESSAGE_LIST_PENDING,
  MESSAGE_LIST_ROOT,
  MESSAGE_LIST_SENTINEL,
  MESSAGE_LIST_SPACER,
} from '../message-classes';
import { ListProvider, useThreadContext, type ChatMessageDensity } from './message-context';

type Axes = typeof contract.ChatMessageList.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const PAD = MESSAGE_LIST_PAD satisfies Record<Of<'density'>, string>;
const DENSITY_GAP = MESSAGE_LIST_DENSITY_GAP satisfies Record<Of<'density'>, string>;
const GAP = MESSAGE_LIST_GAP satisfies Record<Of<'gap'>, string>;

export interface ChatMessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** How much room the rows take. Flows to every row and bubble inside through context. */
  density?: Of<'density'>;
  /**
   * Where a SHORT conversation sits. `bottom` — the default — seats it above the composer; `top`
   * is for a transcript embedded in a page that reads downward. Once the content overflows the two
   * are identical, so this decides the empty and nearly-empty states only.
   */
  align?: Of<'align'>;
  /** Overrides the density's own row gap and leaves its padding alone. */
  gap?: Of<'gap'>;
  /**
   * OPT-IN (UMK-1579): omit the density's padding so the host owns the list's inset. The row gap
   * is untouched. Default off renders byte-identically to before.
   */
  flush?: boolean;
  /**
   * A reply is arriving. The busy state reaches assistive technology only while this is true —
   * see the note on the root below for why it is absent rather than false otherwise.
   */
  streaming?: boolean;
  /** The region's accessible name. A log with no name is one more unlabelled landmark. */
  label?: string;
  /** What to show when the list holds nothing. Omit it and an empty list renders an empty region. */
  emptyState?: React.ReactNode;
  /**
   * Load the messages above. Supply it and a sentinel appears at the top of the content; the
   * component fires this when the reader reaches it and shows a pending row until it settles.
   *
   * IT IS CALLED ONCE PER ARRIVAL, not once per intersection — see the in-flight note below.
   */
  scrollToTopAction?: () => void | Promise<void>;
  children?: React.ReactNode;
}

/**
 * The transcript's log region.
 *
 * IT OWNS NO SCROLLER. The frame above it does. This announces, spaces and aligns what it holds,
 * and publishes its inner content element to that frame so the scroll owner can watch it grow.
 *
 * TWO ELEMENTS, AND THE SPLIT IS LOAD-BEARING: the root is the flex child and the log region, the
 * inner element carries the spacing and is what gets observed. Collapse them and every resize of
 * the viewport reads as content arriving.
 */
export const ChatMessageList = React.forwardRef<HTMLDivElement, ChatMessageListProps>(
  function ChatMessageList(
    {
      density = 'balanced',
      align = 'bottom',
      gap,
      flush = false,
      streaming = false,
      label,
      emptyState,
      scrollToTopAction,
      children,
      className,
      ...rest
    },
    ref,
  ) {
    const thread = useThreadContext();
    const sentinelRef = React.useRef<HTMLDivElement | null>(null);
    const [loadingOlder, setLoadingOlder] = React.useState(false);

    const value = React.useMemo<{ density: ChatMessageDensity }>(() => ({ density }), [density]);
    /* The cheap test first. `React.Children.count` walks the whole children tree with no early
       exit, and a transcript is hundreds of children — so a list with no empty state to show
       should not pay for counting them on every render. */
    const showEmpty = emptyState !== undefined && React.Children.count(children) === 0;

    /* Published to the frame on mount and withdrawn on unmount. A list outside a frame registers
       nothing, which is why `thread` is allowed to be null at all. */
    const register = thread?.registerContent;
    const attachContent = React.useCallback(
      (element: HTMLDivElement | null) => {
        register?.(element);
      },
      [register],
    );

    /**
     * THE IN-FLIGHT GUARD IS THE POINT OF THIS EFFECT, not the observer.
     *
     * The pending row renders BELOW the sentinel, so showing it pushes content down without
     * un-intersecting the sentinel — the observer fires again while the first call is still
     * unresolved, and a host that appends on every call ends up loading the same page twice. The
     * component holds the state rather than exposing a re-entrant callback: it pairs with the
     * spinner already rendered here, and it keeps the contract for an adopter to one function.
     *
     * BOTH THE FLAG AND THE CALLBACK LIVE IN REFS, AND THE FIRST ONE IS WHY THE GUARD WORKS AT
     * ALL. It was a local inside this effect for one run, which made it as short-lived as the
     * effect: a host passing an inline callback — the natural way to write one — changes its
     * identity every render, so the effect re-ran, built a fresh observer, and reset the flag to
     * false. A newly observed target that is still intersecting fires immediately, so the very
     * next frame called the action a second time. The double load the guard exists to prevent,
     * reintroduced by the guard's own scope, and invisible to a test that passes a stable mock.
     *
     * Keeping the callback in a ref is the other half: the effect now depends on WHETHER there is
     * one rather than on WHICH one, so the observer is built once per mount and a caller needs no
     * memoisation discipline to get correct behaviour out of it.
     */
    const actionRef = React.useRef(scrollToTopAction);
    actionRef.current = scrollToTopAction;
    const loadable = scrollToTopAction !== undefined;
    const inFlight = React.useRef(false);

    React.useEffect(() => {
      const sentinel = sentinelRef.current;
      if (!loadable || sentinel === null) return;
      let cancelled = false;

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting) || inFlight.current) return;
          inFlight.current = true;
          setLoadingOlder(true);
          /**
           * THE CALL IS MADE INSIDE THE PROMISE, NOT BESIDE IT, and that is the whole fix.
           *
           * It read `Promise.resolve(actionRef.current?.())` for one run, which evaluates the host
           * callback in the ARGUMENT position: a synchronous throw escaped before `.finally` was
           * ever attached, so the flag and the spinner stayed set for the component's life and
           * load-older was dead until unmount. An async arrow turns that throw into a rejection
           * on the same path a rejected promise already took.
           *
           * The rejection is swallowed because the host owns reporting its own failure — it is the
           * host's callback — and an unhandled rejection from a design-system component is noise
           * in someone else's error reporter. What this owes the host is a component that still
           * works afterwards.
           */
          void (async () => actionRef.current?.())()
            .catch(() => {})
            .finally(() => {
              inFlight.current = false;
              if (!cancelled) setLoadingOlder(false);
            });
        },
        /* Rooted on the scroller when there is one. Left as the viewport otherwise, which is the
           honest answer for a list nobody put in a frame.
           
           READ FROM AN ELEMENT, NOT A REF. This read `thread?.scrollContainer.current` once and
           depended on `thread`, whose identity never moved — so a frame whose scroller appeared
           after first commit left the observer rooted on the VIEWPORT for the component's life,
           firing load-older against the wrong box. The seam now publishes the element, so this
           effect re-runs when it arrives. */
        { root: thread?.scrollContainer ?? null },
      );
      observer.observe(sentinel);
      return () => {
        cancelled = true;
        observer.disconnect();
        /* AND THE SPINNER GOES WITH IT. Dropping `scrollToTopAction` is how a host says "no older
           pages left", and doing that mid-flight used to strand the pending row forever: the
           settling promise saw `cancelled` and skipped the reset, while the row's own render is
           gated on this state alone. */
        setLoadingOlder(false);
      };
    }, [loadable, thread]);

    return (
      <div
        ref={ref}
        role="log"
        aria-live="polite"
        /**
         * ABSENT RATHER THAN FALSE. A region permanently announcing that it is not busy is noise
         * on every settled turn, and `aria-busy={streaming}` produces exactly that — the attribute
         * renders as the string "false", which is a claim rather than a silence.
         */
        aria-busy={streaming ? true : undefined}
        aria-label={label}
        tabIndex={0}
        data-density={density}
        data-align={align}
        data-gap={gap}
        className={cn(MESSAGE_LIST_ROOT, className)}
        {...rest}
      >
        <div
          ref={attachContent}
          className={cn(
            MESSAGE_LIST_CONTENT,
            !flush && PAD[density],
            /* SELECTED, NOT STACKED. Two gaps on one element are not a conflict the class merger
               can resolve — the named rungs are not in its map — so both would ship and the
               stylesheet's order would decide which one applies. */
            gap === undefined ? DENSITY_GAP[density] : GAP[gap],
          )}
        >
          {/* The spacer stands down for an empty state, which centres itself. Both claim the free
              space, and with both present they split it and the empty state sits at two-thirds
              height — a layout nobody chose and nothing can see. */}
          {align === 'bottom' && !showEmpty && (
            <div aria-hidden data-spacer className={MESSAGE_LIST_SPACER} />
          )}
          {loadable && <div ref={sentinelRef} data-sentinel className={MESSAGE_LIST_SENTINEL} />}
          {loadingOlder && (
            <div data-pending className={MESSAGE_LIST_PENDING}>
              <Spinner size="sm" label="Memuat pesan sebelumnya" />
            </div>
          )}
          <ListProvider value={value}>{children}</ListProvider>
          {showEmpty && <div className={MESSAGE_LIST_EMPTY}>{emptyState}</div>}
        </div>
      </div>
    );
  },
);
