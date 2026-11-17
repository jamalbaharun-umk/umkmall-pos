'use client';

import React from 'react';
import { cn } from '../../utils';
import { Icon, type IconName } from '../Icon';
import {
  TAB_BAR,
  TAB_BAR_ICON,
  TAB_BAR_INDICATOR,
  TAB_BAR_ITEM,
  TAB_BAR_ITEM_INK,
  TAB_BAR_LABEL,
} from '../tab-bar-classes';

/**
 * The web bottom tab bar (UMK-1757): the native-ui-v2 bar (`native/TabBar.tsx`) for a phone-width
 * browser. Hidden from `md` up, where the sidebar is the navigation.
 *
 * CHILDREN, NOT AN ITEM ARRAY, unlike the native bar. A web item may have to be the trigger of a
 * menu (Teman AI's Profil tab is a link to its page since UMK-1840, but a tab that opens a menu stays
 * possible), and a menu hands its trigger props and a ref to the element it is given. Only an element the caller renders can take them, so the caller
 * renders each `TabBarItem` and the bar only lays them out.
 */
export interface TabBarProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'aria-label'> {
  /** The navigation landmark's accessible name. */
  label: string;
  children?: React.ReactNode;
}

export const TabBar: React.FC<TabBarProps> = ({ label, children, className, ...rest }) => (
  <nav {...rest} aria-label={label} data-tab-bar="" className={cn(TAB_BAR, className)}>
    {children}
  </nav>
);

/**
 * One tab: a glyph over its label.
 *
 * AN ANCHOR OR A BUTTON, never a div with a handler, decided by whether there is a destination
 * (`SidebarMenuItem`'s rule). ROUTING IS NOT ITS BUSINESS: a caller wanting client-side navigation
 * passes its own link component, the same seam `SidebarMenuItem` and `Menu` use.
 *
 * IT FORWARDS ITS REF AND EVERY OTHER PROP to the element, so it can be a menu trigger: the menu's
 * `asChild` merges its handlers and ARIA state onto whatever element this renders.
 */
export interface TabBarItemProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /** The visible label, and the item's accessible name. */
  label: string;
  /** The glyph while inactive (Iconsax outline in the nav set). */
  icon: IconName;
  /** The glyph while active (the filled twin). Falls back to `icon`. */
  activeIcon?: IconName;
  /** The current tab: brand ink, the top line, and `aria-current="page"` on a link. */
  active?: boolean;
  href?: string;
  /** What an item carrying `href` renders as. Defaults to a plain anchor. */
  linkComponent?: React.ElementType;
}

export const TabBarItem = React.forwardRef<HTMLElement, TabBarItemProps>(function TabBarItem(
  { label, icon, activeIcon, active = false, href, linkComponent: Link = 'a', className, ...rest },
  ref,
) {
  const body = (
    <>
      {active && <span aria-hidden="true" data-tab-bar-indicator="" className={TAB_BAR_INDICATOR} />}
      <Icon name={active ? (activeIcon ?? icon) : icon} className={TAB_BAR_ICON} />
      <span className={TAB_BAR_LABEL}>{label}</span>
    </>
  );
  const shared = {
    ...rest,
    'data-tab-bar-item': '',
    ...(active ? { 'data-active': '' } : {}),
    className: cn(TAB_BAR_ITEM, active ? TAB_BAR_ITEM_INK.active : TAB_BAR_ITEM_INK.inactive, className),
  };

  if (href !== undefined) {
    return (
      /* Colour is not an announcement: the current tab says so, rather than only looking it. */
      <Link {...shared} ref={ref} href={href} {...(active ? { 'aria-current': 'page' as const } : {})}>
        {body}
      </Link>
    );
  }
  return (
    <button {...shared} ref={ref as React.Ref<HTMLButtonElement>} type="button">
      {body}
    </button>
  );
});
