'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon, type IconName } from '../Icon';
import { Text, type TextColor } from '../Text';
import {
  LIST_ROW,
  LIST_ROW_BOX,
  LIST_ROW_GLYPH_INK,
  LIST_ROW_PLAIN_GLYPH,
  LIST_ROW_TEXT,
  LIST_ROW_TILE,
  LIST_ROW_TILE_GLYPH,
  LIST_ROW_TINT,
  LIST_ROW_TRUNCATE,
} from '../list-row-classes';

type Axes = typeof contract.ListRow.axes;
type Of<K extends keyof Axes> = Axes[K][number];

export type ListRowTrailing = Of<'trailing'>;
export type ListRowVariant = Of<'variant'>;
export type ListRowValueTone = Of<'valueTone'>;

/**
 * The trailing glyph, one per row. Which one follows the design: native's Profil marks a row that leaves
 * the app `external`, while the web Profil frame draws `chevron` on those rows too (author, UMK-1845).
 * The glyph only says it; `external` the PROP is what opens a new tab.
 */
const TRAILING_ICON = {
  chevron: 'chevron-right',
  external: 'external-link',
  none: undefined,
} as const satisfies Record<Of<'trailing'>, IconName | undefined>;

/** The trailing value's ink: muted by default, brand for Profil's plan name ("Basic"). */
const VALUE_TONE = {
  muted: 'muted',
  brand: 'brand',
} as const satisfies Record<Of<'valueTone'>, TextColor>;

const BOX = LIST_ROW_BOX satisfies Record<Of<'variant'>, string>;

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /** The row's name, what it opens. One line; it truncates rather than wrapping the row taller. */
  label: string;
  /** An optional second line under the label, in the muted ink. */
  meta?: string;
  /** The glyph: in the 36 tile (`tile`) or bare at 18 (`plain`). Omit it for a row with no glyph. */
  icon?: IconName;
  /** `chevron` (stays), `external` (leaves) or `none`. Default `none`. */
  trailing?: ListRowTrailing;
  /** `tile` (default): the identity row. `plain`: Profil's row; pair it with `ListGroup variant="plain"`. */
  variant?: ListRowVariant;
  /** Short trailing text before the direction glyph: Profil's current plan name ("Basic"). */
  value?: string;
  /** The value's ink: `muted` (default) or `brand`. */
  valueTone?: ListRowValueTone;
  /** Drawn after the label, such as a "new" dot. Its own accessible name joins the row's. */
  badge?: React.ReactNode;
  /** The current row: keeps the tint and says so (`aria-current`). */
  active?: boolean;
  /** Greys the label and glyphs and takes the row out of the tab order, as a disabled button. */
  disabled?: boolean;
  href?: string;
  /**
   * Leaves the site: a new tab, with `rel="noopener noreferrer"` beside it, and always a plain anchor
   * (a client-side router asked to handle an off-site URL is a wasted round trip). `Menu`'s rule.
   */
  external?: boolean;
  /** What a row carrying `href` renders as. Defaults to a plain anchor. */
  linkComponent?: React.ElementType;
}

/**
 * One row of a `ListGroup` (UMK-1840): the web half of the native-ui-v2 row (`native/ListRow.tsx`).
 * A glyph (in a brand tile, or bare for `plain`), a label with an optional meta line, an optional
 * badge and trailing value, and a trailing direction glyph.
 *
 * AN ANCHOR OR A BUTTON, never a div with a handler, decided by whether there is a destination, the
 * rule `TabBarItem` and `SidebarMenuItem` follow. ROUTING IS NOT ITS BUSINESS: a caller wanting
 * client-side navigation passes its own link component. A disabled row is a disabled button, so it
 * cannot be followed.
 *
 * DESTRUCTIVE ACTIONS ARE NOT ROWS. "Keluar" and its like are a full-width outlined danger `Button`
 * below the groups, never a row, however red its glyph (the contract note on this entry).
 */
export const ListRow = React.forwardRef<HTMLElement, ListRowProps>(function ListRow(
  {
    label,
    meta,
    icon,
    trailing = 'none',
    variant = 'tile',
    value,
    valueTone = 'muted',
    badge,
    active = false,
    disabled = false,
    href,
    external = false,
    linkComponent = 'a',
    className,
    ...rest
  },
  ref,
) {
  const plain = variant === 'plain';
  const glyph = TRAILING_ICON[trailing];
  const ink = disabled ? LIST_ROW_GLYPH_INK.disabled : LIST_ROW_GLYPH_INK.enabled;

  const body = (
    <>
      {icon !== undefined &&
        (plain ? (
          <Icon name={icon} className={cn(LIST_ROW_PLAIN_GLYPH, ink)} />
        ) : (
          <span aria-hidden="true" data-list-row-tile="" className={LIST_ROW_TILE}>
            <Icon name={icon} className={cn(LIST_ROW_TILE_GLYPH, disabled && LIST_ROW_GLYPH_INK.disabled)} />
          </span>
        ))}
      <span className={LIST_ROW_TEXT}>
        <Text
          as="span"
          variant="paragraph"
          weight={plain ? 'medium' : 'semibold'}
          color={disabled ? 'disable' : 'primary'}
          className={LIST_ROW_TRUNCATE}
        >
          {label}
        </Text>
        {meta !== undefined && (
          <Text as="span" variant={plain ? 'bodyMd' : 'bodyLg'} color="muted" className={LIST_ROW_TRUNCATE}>
            {meta}
          </Text>
        )}
      </span>
      {badge}
      {value !== undefined && (
        <Text
          as="span"
          variant="paragraph"
          weight="semibold"
          color={VALUE_TONE[valueTone]}
          data-list-row-value={valueTone}
          className={LIST_ROW_TRUNCATE}
        >
          {value}
        </Text>
      )}
      {glyph !== undefined && (
        <Icon
          name={glyph}
          data-list-row-trailing={trailing}
          className={cn(plain ? LIST_ROW_PLAIN_GLYPH : LIST_ROW_TILE_GLYPH, ink)}
        />
      )}
    </>
  );

  const shared = {
    ...rest,
    'data-list-row': variant,
    ...(active ? { 'data-active': '' } : {}),
    className: cn(
      LIST_ROW,
      BOX[variant],
      active ? LIST_ROW_TINT.active : disabled ? LIST_ROW_TINT.disabled : LIST_ROW_TINT.interactive,
      className,
    ),
  };

  if (href !== undefined && !disabled) {
    const Link = external ? 'a' : linkComponent;
    return (
      <Link
        {...shared}
        ref={ref}
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        {...(active ? { 'aria-current': 'page' as const } : {})}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      {...shared}
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      disabled={disabled}
      {...(active ? { 'aria-current': 'true' as const } : {})}
    >
      {body}
    </button>
  );
});
