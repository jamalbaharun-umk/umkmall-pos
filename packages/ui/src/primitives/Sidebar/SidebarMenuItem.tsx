'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  SIDEBAR_ITEM,
  SIDEBAR_ITEM_ACTIVE,
  SIDEBAR_ITEM_DESCRIPTION,
  SIDEBAR_ITEM_DISCLOSURE,
  SIDEBAR_ITEM_SUB,
  SIDEBAR_ITEM_TEXT,
  SIDEBAR_ITEM_TRAILING,
  SIDEBAR_ITEM_WITH_TRAILING,
  SIDEBAR_ITEM_WRAP,
} from '../sidebar-classes';

type Axes = typeof contract.Sidebar.axes;
type Of<K extends keyof Axes> = Axes[K][number];

/**
 * One navigation row, mirroring Ensyra's `Menus` set.
 *
 * FIGMA SPELLS THE STATE AXIS `Satate`. That is a typo in the published set, not a word, and
 * carrying it would put a misspelling in every call site in the repo forever. The axis is
 * `state` here and the typo is recorded as a divergence on the contract entry so nobody
 * "fixes" it back on their next read of the file.
 *
 * `Show Dropdown` and `Icon Dropdown` are NOT separate props. The set says the same fact
 * twice — a row is a submenu parent, therefore it discloses — and two props let a caller
 * build a submenu row with no affordance, or an affordance on a row that opens nothing.
 * `state: 'submenu'` is the one fact; `disclosure` replaces the glyph for a caller who wants
 * a different one.
 *
 * IT IS AN ANCHOR OR A BUTTON, never a div with a handler. Which one is decided by whether
 * there is a destination, because that is what decides whether the row can be opened in a new
 * tab, and a keyboard user gets the right one either way without any code here.
 *
 * ROUTING IS NOT ITS BUSINESS. A caller wanting client-side navigation passes its own link
 * component, the same seam `Menu` uses — this package does not depend on a router and must
 * not start.
 *
 * `disabled` HAS TO BE SPELLED TWICE, because the two branches are different elements. A button
 * takes the attribute and the browser does the rest — unfocusable, unclickable, and matched by
 * the `disabled:` utilities in the row's class table. An anchor has no such attribute and never
 * matches that CSS pseudo-class, so a destination row spelled the button way is fully clickable,
 * fully tabbable and undimmed while every type and every behaviour assertion passes. The anchor
 * way is three separate facts: no `href` (an anchor without one is not a link target and drops
 * out of the tab order on its own), `aria-disabled` so it is still announced rather than merely
 * inert, and the dimming applied directly rather than through a pseudo-class it cannot have.
 * The click handler is withheld from both branches, so nothing depends on which one ran.
 */
export interface SidebarMenuItemProps {
  /** Figma `Title`, and the accessible name while the rail hides it. */
  label: string;
  /** Figma `Icon Left`. */
  icon?: React.ReactNode;
  /**
   * Figma `Satate`, spelled correctly. `submenu` is a row that owns a nested list and shows
   * the disclosure; `menu` is a leaf.
   */
  state?: Of<'state'>;
  /** Figma `Status: Active`, as a boolean — it composes with every other axis at once. */
  active?: boolean;
  /** Whether this row's submenu is open. Only read in the `submenu` state. */
  expanded?: boolean;
  /** Figma `Icon Dropdown`. Replaces the default glyph. */
  disclosure?: React.ReactNode;
  /** Indent, for a row rendered inside another row's submenu. */
  nested?: boolean;
  /** Matches the rail: the label is dropped from the surface but kept as the row's name. */
  collapsed?: boolean;
  href?: string;
  /** What a row carrying `href` renders as. Defaults to a plain anchor. */
  linkComponent?: React.ElementType;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  /** A second, muted line under the label. Dropped when `collapsed`. Web-only (UMK-1041). */
  description?: string;
  /**
   * A control beside the row — a delete button on a session. Rendered as a SIBLING of the row, never
   * inside it, and dropped when `collapsed`. Web-only (UMK-1041).
   */
  trailing?: React.ReactNode;
  className?: string;
}

export const SidebarMenuItem: React.FC<SidebarMenuItemProps> = ({
  label,
  icon,
  state = 'menu',
  active = false,
  expanded = false,
  disclosure,
  nested = false,
  collapsed = false,
  href,
  linkComponent: Link = 'a',
  onClick,
  disabled = false,
  description,
  trailing,
  className,
}) => {
  const hasTrailing = trailing !== undefined && trailing !== null && !collapsed;
  const isSub = state === 'submenu';
  const shared = {
    'data-sidebar-item': '',
    /* Colour is not an announcement: the current row says so, rather than only looking it. */
    ...(active ? { 'aria-current': 'page' as const } : {}),
    ...(isSub ? { 'aria-expanded': expanded } : {}),
    /* Collapsed, the glyph is the whole row — an icon with no name is an unlabelled control. */
    ...(collapsed ? { 'aria-label': label } : {}),
    onClick: disabled ? undefined : onClick,
    className: cn(
      SIDEBAR_ITEM,
      active && SIDEBAR_ITEM_ACTIVE,
      nested && SIDEBAR_ITEM_SUB,
      hasTrailing && SIDEBAR_ITEM_WITH_TRAILING,
      collapsed && 'justify-center px-0',
      /* The table's own disabled treatment rides the CSS pseudo-class, which an anchor never
         matches. Applied here so both branches actually look disabled. */
      disabled && 'pointer-events-none opacity-50',
      className,
    ),
  };

  const body = (
    <>
      {icon !== undefined && <span className="flex h-5 w-5 shrink-0 items-center">{icon}</span>}
      {!collapsed && description === undefined && (
        <span className="flex-1 truncate text-ds-paragraph-mobile font-medium leading-5">{label}</span>
      )}
      {!collapsed && description !== undefined && (
        <span className={SIDEBAR_ITEM_TEXT}>
          <span className="truncate text-ds-paragraph-mobile font-medium leading-5">{label}</span>
          <span className={SIDEBAR_ITEM_DESCRIPTION}>{description}</span>
        </span>
      )}
      {isSub && !collapsed && (
        <span
          data-sidebar-disclosure=""
          aria-hidden="true"
          className={cn(SIDEBAR_ITEM_DISCLOSURE, expanded && 'rotate-90')}
        >
          {disclosure ?? '›'}
        </span>
      )}
    </>
  );

  const row =
    href === undefined ? (
      <button type="button" disabled={disabled} {...shared}>
        {body}
      </button>
    ) : (
      <Link
        {...shared}
        {...(disabled ? { 'aria-disabled': true, tabIndex: -1 } : { href })}
      >
        {body}
      </Link>
    );

  return hasTrailing ? (
    <div className={SIDEBAR_ITEM_WRAP}>
      {row}
      <span className={SIDEBAR_ITEM_TRAILING}>{trailing}</span>
    </div>
  ) : (
    row
  );
};
