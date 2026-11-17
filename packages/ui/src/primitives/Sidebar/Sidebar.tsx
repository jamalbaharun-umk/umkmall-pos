'use client';

import React from 'react';
import { cn, isSlotFilled } from '../../utils';
import {
  SIDEBAR_ASIDE,
  SIDEBAR_DRAWER,
  SIDEBAR_DRAWER_STATE,
  SIDEBAR_SCRIM,
  SIDEBAR_SLOT,
  SIDEBAR_TOGGLE,
  SIDEBAR_WIDTH,
} from '../sidebar-classes';

/**
 * The app shell's sidebar — CHROME ONLY.
 *
 * WHAT THIS IS NOT. The surface this shape was read off is 672 lines and imports eight
 * app-local modules: an auth store, an install-prompt hook, a feature flag, three modals, a
 * date-grouping helper and its own tooltip. It also fetches, it routes, and it hardcodes its
 * product's copy. None of that is a design-system concern, and a library that took any of it
 * would be unusable by the second app that wanted a sidebar. What is here is the frame, the
 * rail, the drawer and the row shape. Header, list and footer are slots.
 *
 * AND IT OWNS NO LOGOUT, deliberately, which is the one omission worth spelling out because it
 * looks like something the extraction merely forgot. The surface this comes from signs out
 * with a HARD navigation, and that is load-bearing rather than incidental: the AI token lives
 * in memory and a client-side route change does not discard it (UMK-772). An `onLogout` prop
 * would compile perfectly with a soft-navigating implementation behind it and leave the token
 * alive, with nothing failing. The footer slot takes whatever the caller's sign-out control is
 * and the caller keeps the hard navigation next to the reason for it.
 *
 * TWO TREES, ONE AT A TIME. The rail is hidden below the breakpoint and the drawer above it,
 * so both are mounted and exactly one is on screen. The closed drawer is therefore hidden from
 * the accessibility tree by hand — without that a screen reader reads the whole navigation
 * twice, the second time off a surface that cannot be reached. A transform hides nothing from
 * assistive technology.
 *
 * AND THE COLLAPSE CONTROL BELONGS TO THE RAIL ALONE, which is why `body` takes a flag rather
 * than rendering one shared tree. Collapsing narrows the rail; the drawer has no rail on
 * screen to narrow, so a copy inside it is a control that does nothing visible — and, both
 * trees being mounted, it also puts two identical controls in the document at once. Do not
 * "restore" it to the shared body: `sidebar.stories.test.tsx` counts it.
 *
 * THE DRAWER OWNS FOCUS AND ESCAPE, AND NOTHING ELSE. Opening moves focus into the drawer,
 * closing returns it to whatever held it before, and Escape asks the caller to close. Those
 * are accessibility basics rather than policy, so they are the library's. There is
 * deliberately NO tab-cycling focus trap: tab-wrap depends on layout-aware focus order, which
 * the test environment has none of, so an assertion for it would pass just as readily on the
 * trap being absent — and an unverifiable claim is worse than a stated absence.
 *
 * WHAT STAYS THE CALLER'S, said as plainly as the paragraph above: `open` is caller state and
 * this component never closes itself. An `open` drawer given no `onOpenChange` therefore
 * CANNOT BE DISMISSED — not by Escape, not by the scrim. The scrim renders regardless, because
 * an open drawer with no backdrop is worse than a backdrop that only dismisses when the caller
 * wired dismissal; but a caller that passes `open` without `onOpenChange` has built a drawer
 * with no way out, and that is theirs to fix.
 *
 * THE BREAKPOINT IS `md`, matching the rest of this package rather than the app's `lg`; see
 * `sidebar-classes.ts` and the contract entry's divergence.
 */
/**
 * A slot is a node, or a function of WHICH surface it is drawn into (UMK-1041). The rail and the
 * drawer render the same slots, so a slot with state or a collapsed look needs to know which copy it
 * is. The object carries a boolean because a bare `'rail' | 'drawer'` union is banned on a contract prop.
 * A plain node renders exactly as it always did.
 */
export type SidebarSlot = React.ReactNode | ((ctx: { drawer: boolean }) => React.ReactNode);

const resolve = (slot: SidebarSlot, drawer: boolean): React.ReactNode =>
  typeof slot === 'function' ? slot({ drawer }) : slot;

export interface SidebarProps {
  /** Accessible name for the navigation landmark. Required — an unnamed landmark is noise. */
  label: string;
  /**
   * Figma `Size: Small | Large`, as a boolean. See the contract entry's divergence: it is a
   * two-value axis whose values are "yes" and "no", and the callers already hold it that way.
   */
  collapsed?: boolean;
  /**
   * Omit to render no collapse control at all. A rail that cannot be expanded is a legitimate
   * configuration; a control that does nothing is not.
   */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Accessible name for the collapse control. */
  collapseLabel?: string;
  /** Mobile drawer open state. Always the caller's — this component holds no state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  header?: SidebarSlot;
  /** The list slot. The only one that scrolls. */
  children?: SidebarSlot;
  footer?: SidebarSlot;
  className?: string;
}

const Slot: React.FC<{ name: string; grow?: boolean; children?: React.ReactNode }> = ({
  name,
  grow = false,
  children,
}) =>
  /* An omitted slot renders NOTHING — see `isSlotFilled`. */
  !isSlotFilled(children) ? null : (
    <div data-sidebar-slot={name} className={cn(SIDEBAR_SLOT, grow && 'flex-1 overflow-y-auto')}>
      {children}
    </div>
  );

export const Sidebar: React.FC<SidebarProps> = ({
  label,
  collapsed = false,
  onCollapsedChange,
  collapseLabel = 'Toggle navigation',
  open = false,
  onOpenChange,
  header,
  children,
  footer,
  className,
}) => {
  const drawerRef = React.useRef<HTMLElement | null>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    /* Runs on close AND on unmount — a drawer that unmounts open would otherwise strand
       focus on a detached node. */
    return () => restoreRef.current?.focus?.();
  }, [open]);

  const body = (rail: boolean) => (
    <nav aria-label={label} className="flex h-full min-h-0 flex-col">
      <Slot name="header">{resolve(header, !rail)}</Slot>
      <Slot name="list" grow>
        {resolve(children, !rail)}
      </Slot>
      <Slot name="footer">{resolve(footer, !rail)}</Slot>
      {rail && onCollapsedChange !== undefined && (
        <div className="flex justify-end p-3">
          <button
            type="button"
            data-sidebar-collapse=""
            aria-label={collapseLabel}
            /* Says which way it will go rather than leaving that to the glyph. */
            aria-expanded={!collapsed}
            className={SIDEBAR_TOGGLE}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
          </button>
        </div>
      )}
    </nav>
  );

  return (
    <>
      <aside
        data-sidebar-rail=""
        className={cn(SIDEBAR_ASIDE, collapsed ? SIDEBAR_WIDTH.small : SIDEBAR_WIDTH.large, className)}
      >
        {body(true)}
      </aside>

      {open && (
        <div
          data-sidebar-scrim=""
          className={SIDEBAR_SCRIM}
          onClick={onOpenChange && (() => onOpenChange(false))}
        />
      )}

      <aside
        data-sidebar-drawer=""
        ref={drawerRef}
        /* Focusable by script only — the drawer itself is never a tab stop. */
        tabIndex={-1}
        onKeyDown={(event) => {
          /* Escape closes the drawer only when it was pressed IN the drawer. A menu portalled out of it
             still bubbles through the React tree to this handler, and its Escape belongs to the menu. */
          if (event.defaultPrevented || !drawerRef.current?.contains(event.target as Node)) return;
          if (event.key === 'Escape' && open && onOpenChange) onOpenChange(false);
        }}
        /* `inert` AND `aria-hidden`: the first takes it out of the tab order and off the
           pointer, the second out of the accessibility tree. Neither implies the other, and
           the transform implies neither. */
        {...(open ? {} : { 'aria-hidden': 'true' as const, inert: true })}
        className={cn(
          SIDEBAR_DRAWER,
          open ? SIDEBAR_DRAWER_STATE.open : SIDEBAR_DRAWER_STATE.closed,
          className,
        )}
      >
        {/* Always rendered (L21): the slide-out needs the content to stay while it moves. The
            closed drawer is `inert` + `aria-hidden` above, so the second copy is unreachable and
            unannounced — one accessible `Keluar`, not two. */}
        {body(false)}
      </aside>
    </>
  );
};
