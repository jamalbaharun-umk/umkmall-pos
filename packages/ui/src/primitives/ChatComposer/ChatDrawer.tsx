'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import {
  COMPOSER_DRAWER,
  COMPOSER_DRAWER_DISMISS,
  COMPOSER_DRAWER_DISPLAY,
  COMPOSER_DRAWER_HANDLE,
  COMPOSER_DRAWER_SUMMARY,
  COMPOSER_DRAWER_TOGGLE,
  COMPOSER_DRAWER_VARIANT,
} from '../composer-classes';

type Axes = typeof contract.ChatDrawer.axes;
export type ChatDrawerVariant = Axes['variant'][number];

export interface ChatDrawerProps {
  /**
   * Which semantic treatment the drawer paints for ITSELF.
   *
   * Defaults to `inherit`, which paints nothing — inside a composer the tray is already tinted
   * (`ChatComposer`'s `tone`), and a drawer that filled itself would stack a second panel on the
   * first. The four opaque values are for a drawer used OUTSIDE a composer, where nothing else
   * supplies a surface. They are `Alert`'s vocabulary — `danger`, never `error`.
   */
  variant?: ChatDrawerVariant;
  /**
   * Collapsed state. CONTROLLED, and collapsible only when BOTH this and `onCollapsedChange` are
   * supplied — the same shape `Menu` uses, which never owned its own open state either. A host
   * that wants "collapse once four files are attached" needs to drive it; one that does not simply
   * omits the pair and gets a drawer with no toggle.
   */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Accessible name for the collapse toggle; the line it draws carries no text. */
  collapseLabel?: string;
  /**
   * What the toggle shows in place of the line once the drawer is COLLAPSED — "4 Attachments", a
   * count badge, whatever names what is now out of sight.
   *
   * THE HOST'S WORDS, for the reason the buttons' labels are too: a container that holds arbitrary
   * children cannot know whether they are files, chips or a waveform, and it must not choose copy
   * in one language for four surfaces. Omit it and a collapsed drawer shows the line alone, which
   * is right when what it holds is already obvious.
   */
  collapsedSummary?: React.ReactNode;
  /**
   * Supply a handler and the dismiss control appears — the callback-as-gate rule `Lightbox`
   * already follows. Absent means the drawer cannot be dismissed, which is right for attachments
   * and wrong for a warning.
   */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Whatever the drawer holds. Attachments are the expected content, not the only kind. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * A panel above or below the composer's editor.
 *
 * IT SITS OUTSIDE THE COMPOSER'S BORDERED BOX, in its `header` or `footer` slot. That is not
 * arrangement taste: the box carries `focus-within` styling, so a drawer inside it made typing in
 * the editor draw the focus band around the attachments too — a focus indicator claiming a region
 * the focus was not in.
 *
 * IT IS A CONTAINER, AND THE NAME IS THE POINT. This used to BE the attachment list — it took an
 * `attachments` array, chose their treatment and rendered their chips — which made "drawer" a lie:
 * a drawer is the thing that holds, not the things held. An attachment is `ChatAttachment`, and
 * this holds any children a caller puts in it.
 *
 * RENDERS NOTHING WHEN EMPTY, rather than an empty panel — unless it is collapsed, where the
 * handle has to survive or there is no way back.
 */
export const ChatDrawer = React.forwardRef<HTMLDivElement, ChatDrawerProps>(function ChatDrawer(
  {
    variant = 'inherit',
    collapsed,
    onCollapsedChange,
    collapseLabel = 'Sembunyikan',
    collapsedSummary,
    onDismiss,
    dismissLabel = 'Tutup',
    children,
    className,
  },
  ref,
) {
  const collapsible = collapsed !== undefined && onCollapsedChange !== undefined;
  const isCollapsed = collapsible && collapsed;
  const contentId = React.useId();

  if (React.Children.count(children) === 0 && !collapsible) return null;

  return (
    <div
      ref={ref}
      className={cn(COMPOSER_DRAWER_DISPLAY.open, COMPOSER_DRAWER, COMPOSER_DRAWER_VARIANT[variant], className)}
      data-testid="chat-drawer"
      data-variant={variant}
    >
      {collapsible && (
        <button
          type="button"
          /* `group` so the line can react to a hover over the whole row, not just its 3px self. */
          className={`group ${COMPOSER_DRAWER_TOGGLE}`}
          aria-label={collapseLabel}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {isCollapsed && collapsedSummary !== undefined ? (
            <span className={COMPOSER_DRAWER_SUMMARY}>{collapsedSummary}</span>
          ) : (
            <span className={COMPOSER_DRAWER_HANDLE} />
          )}
        </button>
      )}

      {/*
        `hidden` rather than unmounting: the toggle's `aria-controls` has to point at a node that
        exists, and a collapsed drawer that dropped its children out of the tree would also drop
        any state they hold — an upload in flight is the obvious one.
      */}
      {/*
        The display comes from the CLASS, not from `hidden`. This node's class list says `flex` when
        it is open, and a class beats the UA stylesheet's `[hidden] { display: none }` — so
        `hidden={isCollapsed}` set the attribute, announced the right state, and left the drawer
        fully visible. The attribute rides along for assistive tech; the class is what collapses it.
      */}
      <div
        id={contentId}
        hidden={isCollapsed}
        className={cn(
          'flex-wrap items-center gap-3',
          isCollapsed ? COMPOSER_DRAWER_DISPLAY.collapsed : COMPOSER_DRAWER_DISPLAY.open,
        )}
      >
        {children}
      </div>

      {onDismiss && !isCollapsed && (
        <button type="button" className={COMPOSER_DRAWER_DISMISS} aria-label={dismissLabel} onClick={onDismiss}>
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
