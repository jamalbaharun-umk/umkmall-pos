'use client';

import React from 'react';
import { cn, isSlotFilled } from '../utils';
import {
  SHELL_BODY,
  SHELL_BOTTOM,
  SHELL_HEADER,
  SHELL_HEADER_OVERLAY,
  SHELL_MAIN,
  SHELL_NAV,
  SHELL_ROOT,
  SHELL_ROOT_RELATIVE,
} from './layout-classes';

/**
 * The app shell — the frame, and nothing that lives inside it.
 *
 * WHAT IT IS. Four slots and the arrangement between them: a full-height column that does not
 * itself scroll, a header that does not shrink, a navigation column beside the content, and a
 * content region whose overflow chain is pinned so the caller's own scroller is the thing that
 * scrolls. That is roughly forty lines of the hundred and fifty a hand-built shell runs to,
 * and it is the forty every one of them has had to get right independently.
 *
 * WHAT IT REACHES FOR: react, and this package's own class table. No store, no router, no
 * feature gate, no onboarding or tutorial component. Those are all real things a shell in an
 * app has above it, and every one of them is slot content rather than a dependency — a library
 * frame that imported a router would be unusable by the second app that wanted a frame. The
 * import graph is asserted, not merely intended: see `layouts.stories.test.tsx`.
 *
 * THE SCROLL SPY IS THE PART WORTH OWNING (R13). A header that gains a shadow once the content
 * has moved needs to know about a scroll that happens in a node it does not own and did not
 * render — the scroller belongs to whatever the caller put in `children`. Scroll events do not
 * bubble, so the only way to see one from up here is a listener on the frame with `capture`
 * set, which catches the event on its way DOWN to the target. Two surfaces in this repo
 * arrived at that independently and both landed on the same threshold; that is observed
 * duplication rather than predicted reuse, which is why it moves here.
 *
 * AND IT MUST IGNORE TARGETS THAT DO NOT SCROLL. Capture sees every scroller in the subtree,
 * including horizontal ones — a card rail, a wide table — whose vertical offset is always zero.
 * Reacting to those clears the flag mid-gesture and the header flickers back to its unscrolled
 * treatment while the reader is still half way down the page. A target whose scrollable height
 * is no greater than its visible height is not a vertical scroller and is skipped.
 *
 * IT MUST ALSO IGNORE TARGETS OUTSIDE THE CONTENT REGION, which the geometry test cannot do on
 * its own. `Sidebar` gives its list slot its own vertical scroller, so a long navigation IS a
 * genuine vertical scroller inside this frame and passes every height check — and it sits at its
 * own offset zero, so scrolling the navigation answers "not scrolled" for a page that is still
 * scrolled. The flag is about the content, so only a scroll inside the content region may set it.
 *
 * THE UPDATER IS PURE, and the notification happens beside it rather than inside it. React may
 * double-invoke a state updater under StrictMode, and it invokes one during render — so a
 * `notify` call from in there fires twice per transition, or outside the commit phase. The last
 * value handed to the caller is held in a ref, compared in the handler body, and both the state
 * write and the callback follow from that one comparison.
 *
 * THE FLAG IS RESET BY THE CALLER, not inferred. A shell that wraps several routes does not
 * remount when you move between them, so the flag survives a navigation that starts at the top:
 * a surface that auto-scrolls to its newest content raises it, and the next route wears a
 * shadow it never earned until a full reload. Pass the current route as `routeKey` and the flag
 * clears when it changes — this runs before the incoming surface mounts its scroller, so it
 * cannot clobber a real scroll.
 */
export interface AppShellProps {
  /**
   * The top bar. A function receives the scroll state, which is how `Header.scrolled` gets fed
   * without the shell knowing what a header is.
   */
  header?: React.ReactNode | ((state: { scrolled: boolean }) => React.ReactNode);
  /** The in-flow navigation column. Present only from the package breakpoint up. */
  sidebar?: React.ReactNode;
  /**
   * The narrow-viewport navigation — a drawer, which positions itself out of the flow, so this
   * slot adds no box of its own. Present only below the package breakpoint.
   */
  mobileSidebar?: React.ReactNode;
  /** Lay the header over the content below the breakpoint instead of above it. Web-only (UMK-1041). */
  overlayHeader?: boolean;
  /** The content region. It owns the scroller; the shell only guarantees it can scroll. */
  children?: React.ReactNode;
  /**
   * A bar on the bottom edge below the breakpoint, such as a `TabBar` (UMK-1757). In flow after the
   * body, so the content region ends above it; hidden from the breakpoint up. Web-only.
   */
  bottomBar?: React.ReactNode;
  /**
   * Changing this clears the scroll flag. Give it whatever the caller's routing calls the
   * current location; omit it in a single-surface shell.
   */
  routeKey?: string;
  /** Notified whenever the scroll flag flips, for chrome the shell does not render. */
  onScrolledChange?: (scrolled: boolean) => void;
  className?: string;
}

/**
 * Past this many pixels the content has visibly moved. Both hand-built surfaces this was read
 * off chose the same number, so it is carried rather than re-derived — and it is a constant
 * rather than a prop because a shell whose shadow appears at a different offset per caller is
 * a shell that no longer looks like one product.
 */
const SCROLLED_AT = 10;

/**
 * The content slot's marker, as ONE constant. The scroll spy resolves the region by this
 * selector and the region is rendered with this name — two spellings would compile, render and
 * silently stop the header ever gaining its shadow.
 */
const MAIN_SLOT = 'main';

export const AppShell: React.FC<AppShellProps> = ({
  header,
  sidebar,
  mobileSidebar,
  overlayHeader = false,
  children,
  bottomBar,
  routeKey,
  onScrolledChange,
  className,
}) => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = React.useState(false);

  const notify = React.useRef(onScrolledChange);
  notify.current = onScrolledChange;

  /* The value the caller was last told, so the comparison can happen outside the updater. */
  const told = React.useRef(false);

  const settle = React.useCallback((now: boolean) => {
    if (now === told.current) return;
    told.current = now;
    setScrolled(now);
    notify.current?.(now);
  }, []);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    /* Resolved ONCE. The content region is rendered by this component and never swapped, so
       re-running a selector per scroll event bought nothing on a momentum-scroll hot path. */
    const main = root.querySelector(`[data-app-shell-slot="${MAIN_SLOT}"]`);
    if (!main) return;

    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || typeof target.scrollTop !== 'number') return;
      /* Containment FIRST: it is a pointer walk, while the height test below reads geometry
         and can force layout. Not the navigation's own list, which IS a vertical scroller and
         is not the page. */
      if (!main.contains(target)) return;
      /* And not a horizontal rail — its offset is always zero, and letting it answer here
         clears the flag in the middle of somebody else's scroll. */
      if (target.scrollHeight <= target.clientHeight) return;
      settle(target.scrollTop > SCROLLED_AT);
    };

    root.addEventListener('scroll', onScroll, true);
    return () => root.removeEventListener('scroll', onScroll, true);
  }, [settle]);

  React.useEffect(() => {
    settle(false);
  }, [routeKey, settle]);

  const slot = (name: string, className_: string, content: React.ReactNode) =>
    /* An omitted slot renders NOTHING — see `isSlotFilled`. */
    !isSlotFilled(content) ? null : (
      <div data-app-shell-slot={name} className={className_}>
        {content}
      </div>
    );

  return (
    <div
      ref={rootRef}
      data-app-shell=""
      className={cn(SHELL_ROOT, overlayHeader && SHELL_ROOT_RELATIVE, className)}
    >
      {slot(
        'header',
        overlayHeader ? SHELL_HEADER_OVERLAY : SHELL_HEADER,
        typeof header === 'function' ? header({ scrolled }) : header,
      )}
      <div className={SHELL_BODY}>
        {slot('sidebar', SHELL_NAV.rail, sidebar)}
        {slot('mobileSidebar', SHELL_NAV.drawer, mobileSidebar)}
        <main data-app-shell-slot={MAIN_SLOT} className={SHELL_MAIN}>
          {children}
        </main>
      </div>
      {slot('bottomBar', SHELL_BOTTOM, bottomBar)}
    </div>
  );
};
