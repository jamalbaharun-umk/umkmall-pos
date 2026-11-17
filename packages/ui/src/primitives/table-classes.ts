import { FOCUS_RING } from '../utils';

/**
 * The class tables `Table`, `DataTable` and `Pagination` share, in one place.
 *
 * Same siting rule as `header-classes.ts` and `lightbox-classes.ts`: not in `utils/`, because
 * these are component chrome, and not in `contract/`, which may not name a Tailwind class.
 * `table.purge.test.ts` reads every export of this module as DATA, so a table added here is
 * checked with no second registration.
 *
 * DO NOT WRITE A LIVE CLASS NAME IN THE PROSE OF THIS FILE — Tailwind scans it as content, and
 * a class named in a comment is emitted whether or not a component still uses it.
 *
 * Colours read off Ensyra `Pagination` (165:443) and `01 Table Header Cell` / `02 Table Cell`
 * (149:4990 / 149:5011): brand fill on the current page, a weak-brand tint on hover, a hairline
 * row border, a secondary surface on a selected row.
 */

/* ---------------------------------------------------------------- Pagination */

export const PAGINATION_ROOT = 'flex flex-wrap items-center justify-between gap-3';
export const PAGINATION_PAGES = 'flex items-center gap-1';
export const PAGINATION_PAGE_SIZE = 'flex items-center gap-2';
export const PAGINATION_PAGE_SIZE_LABEL = 'whitespace-nowrap text-default-secondary';

/**
 * The label's type step per `density` — the axis moves TYPE only (see the table section below):
 * compact is the 10/16 mobile body step the library shipped before the axis existed, comfortable
 * the 14/20 desktop step the Riwayat Pembelian frame publishes (UMK-1306).
 */
export const PAGINATION_PAGE_SIZE_LABEL_TEXT = {
  compact: 'text-ds-body-md-mobile',
  comfortable: 'text-ds-body-lg-desktop',
};

export const PAGINATION_PAGE_SIZE_SELECT = 'w-24';

/** One square: a page number or a previous/next arrow. */
export const PAGINATION_ITEM = `inline-flex shrink-0 items-center justify-center bg-default-primary text-default-primary hover:bg-weak-brand disabled:cursor-not-allowed disabled:text-disable-primary disabled:hover:bg-default-primary ${FOCUS_RING.control}`;

/** Figma `Size`: 36px squares at radius 8, or 32px at radius 6. Geometry only — type is `density`'s. */
export const PAGINATION_ITEM_SIZE = {
  large: 'size-9 rounded-lg',
  small: 'size-8 rounded-md',
};

/** The squares' type at `density="compact"`: one step per `size`, as the library always shipped. */
export const PAGINATION_ITEM_TEXT_COMPACT = {
  large: 'text-ds-body-lg-mobile',
  small: 'text-ds-body-md-mobile',
};

/**
 * The squares' type at `density="comfortable"`: the 14/20 desktop step at EITHER size, by choice.
 * The Riwayat Pembelian frame (UMK-1306) publishes it on the large square only; no frame shows a
 * small comfortable pager, so it takes the same step rather than an invented smaller one.
 */
export const PAGINATION_ITEM_TEXT_COMFORTABLE = 'text-ds-body-lg-desktop';

export const PAGINATION_CURRENT = 'bg-default-brand text-default-invert hover:bg-default-brand';
export const PAGINATION_ELLIPSIS = 'px-1.5 text-default-secondary';
export const PAGINATION_ICON = 'size-5';

/* ---------------------------------------------------------------- Table parts */

export const TABLE_CONTAINER = 'relative w-full overflow-x-auto';
export const TABLE = 'w-full caption-bottom text-default-primary';

/**
 * The `density` axis, TYPE only, set on the table and inherited by every cell: `compact` is the
 * 10/16 mobile body step the library shipped before the axis existed (and the default still),
 * `comfortable` the Riwayat Pembelian frame (UMK-1306) — the 12/18 desktop step at weight 500.
 * The header keeps its own semibold weight at either density. Padding, heights, colours and
 * radii do not vary with it.
 */
export const TABLE_TYPE = {
  compact: 'text-ds-body-md-mobile',
  comfortable: 'text-ds-body-md-desktop font-medium',
};

export const TABLE_ROW =
  'border-b border-default-primary transition-colors hover:bg-hover-neutral data-[state=selected]:bg-default-secondary';
export const TABLE_HEAD = 'h-12 whitespace-nowrap px-3 text-left align-middle font-semibold';
export const TABLE_CELL = 'px-3 py-3 align-middle';

/* ---------------------------------------------------------------- DataTable */

export const DATATABLE_ROOT = 'space-y-4';
export const DATATABLE_FRAME = 'rounded-lg border border-default-primary';
export const DATATABLE_FOOTER = 'px-2';
export const DATATABLE_CLICKABLE_ROW = 'cursor-pointer';
export const DATATABLE_EMPTY = 'h-24 text-center text-default-secondary';
export const DATATABLE_SKELETON = 'h-5 w-full';
export const DATATABLE_FIXED = 'table-fixed';
export const DATATABLE_SCROLL_Y = 'overflow-y-auto';

/**
 * A thin, low-contrast scrollbar rail (`slimScrollbar`). Visible on purpose: the rail is the
 * only clue besides a pinned column's divider that a wide table scrolls sideways. WebKit and
 * Chromium take the pseudo-elements; Firefox takes only the width.
 *
 * ponytail: no Firefox thumb colour — `scrollbar-color` needs a raw colour value, and this
 * file names tokens only. Add one if the default Firefox thumb reads too heavy.
 */
export const DATATABLE_SLIM_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-default-secondary';

/** A header row pinned while the body scrolls under it (`maxBodyHeight`). */
export const DATATABLE_STICKY_HEADER = 'sticky top-0 z-20 bg-default-primary';

export const DATATABLE_SORT_BUTTON = `inline-flex items-center gap-1 rounded-sm hover:text-default-brand ${FOCUS_RING.control}`;
export const DATATABLE_SORT_ICON = {
  idle: 'size-3.5 text-default-secondary',
  active: 'size-3.5',
};

/**
 * Column pinning, DESKTOP ONLY — every positioning class is `sm:`-prefixed, because on a phone
 * the frozen columns eat most of the screen. The pinned cell carries an opaque background so the
 * columns scrolling beneath it do not show through.
 *
 * ponytail: a pinned cell does not follow the row's hover tint; add a `:has` variant if it matters.
 */
export const DATATABLE_STICKY = {
  left: 'bg-default-primary sm:sticky sm:z-10',
  leftDivider: 'sm:border-r sm:border-default-primary',
  right: 'bg-default-primary sm:sticky sm:right-0 sm:z-10 sm:border-l sm:border-default-primary',
};
