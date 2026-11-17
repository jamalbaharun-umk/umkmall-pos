'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import { Select } from '../Select';
import { pageItems } from './page-items';
import {
  PAGINATION_CURRENT,
  PAGINATION_ELLIPSIS,
  PAGINATION_ICON,
  PAGINATION_ITEM,
  PAGINATION_ITEM_SIZE,
  PAGINATION_ITEM_TEXT_COMFORTABLE,
  PAGINATION_ITEM_TEXT_COMPACT,
  PAGINATION_PAGES,
  PAGINATION_PAGE_SIZE,
  PAGINATION_PAGE_SIZE_LABEL,
  PAGINATION_PAGE_SIZE_LABEL_TEXT,
  PAGINATION_PAGE_SIZE_SELECT,
  PAGINATION_ROOT,
} from '../table-classes';

type Axes = typeof contract.Pagination.axes;

export type PaginationSize = Axes['size'][number];
export type PaginationDensity = Axes['density'][number];

const ITEM_SIZE = PAGINATION_ITEM_SIZE satisfies Record<PaginationSize, string>;

/** Geometry is `size`'s and type is `density`'s, so neither table repeats the other. */
const ITEM_TEXT = {
  compact: PAGINATION_ITEM_TEXT_COMPACT satisfies Record<PaginationSize, string>,
  comfortable: {
    large: PAGINATION_ITEM_TEXT_COMFORTABLE,
    small: PAGINATION_ITEM_TEXT_COMFORTABLE,
  },
} satisfies Record<PaginationDensity, Record<PaginationSize, string>>;

const PAGE_SIZE_LABEL_TEXT = PAGINATION_PAGE_SIZE_LABEL_TEXT satisfies Record<
  PaginationDensity,
  string
>;

export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  /** The current page, 1-based. Clamped into `1..pageCount` when the count is known. */
  page: number;
  /**
   * How many pages exist. `0` renders as one empty page rather than a negative range.
   *
   * OMIT IT for a CURSOR source, which can only walk one page at a time and never knows the
   * last page (the gallery's S3 listing): the strip then shows the current page alone, and
   * `hasPrev` / `hasNext` decide the arrows.
   */
  pageCount?: number;
  onPageChange: (page: number) => void;
  /** Cursor mode only. Defaults to "not on the first page". */
  hasPrev?: boolean;
  /** Cursor mode only. Defaults to `false`: with no count, only the source knows there is more. */
  hasNext?: boolean;
  /** Every control inert, e.g. while the next page is being fetched. */
  disabled?: boolean;
  /** Omit together with `onPageSizeChange` to hide the page-size control. */
  pageSize?: number;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  /** Text beside the page-size control. The library has no i18n, so a host passes its own. */
  pageSizeLabel?: string;
  /** Leading content, e.g. a "12 baris" count. Rendered before the page-size control. */
  summary?: React.ReactNode;
  size?: PaginationSize;
  /** Type only: `comfortable` puts the numbers and the label on the 14/20 desktop step. */
  density?: PaginationDensity;
}

/**
 * A pager with no table behind it: `DataTable` adapts its state to these props, and a gallery
 * can use it directly. Ensyra `Pagination` (165:443).
 */
export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  (
    {
      page,
      pageCount,
      onPageChange,
      hasPrev,
      hasNext,
      disabled = false,
      pageSize,
      onPageSizeChange,
      pageSizeOptions = [5, 10, 20, 30, 50],
      pageSizeLabel = 'Item per halaman',
      summary,
      size = 'large',
      density = 'compact',
      className,
      ...props
    },
    ref,
  ) => {
    const cursor = pageCount === undefined;
    const total = cursor ? Infinity : Math.max(Math.floor(pageCount) || 0, 1);
    const current = Math.min(Math.max(Math.floor(page) || 1, 1), total);
    const canPrev = cursor ? (hasPrev ?? current > 1) : current > 1;
    const canNext = cursor ? Boolean(hasNext) : current < total;
    const item = cn(PAGINATION_ITEM, ITEM_SIZE[size], ITEM_TEXT[density][size]);

    return (
      <nav
        ref={ref}
        aria-label="Navigasi halaman"
        aria-busy={disabled || undefined}
        data-size={size}
        data-density={density}
        className={cn(PAGINATION_ROOT, className)}
        {...props}
      >
        <div className={PAGINATION_PAGE_SIZE}>
          {summary}
          {onPageSizeChange && pageSize !== undefined ? (
            <>
              <span className={cn(PAGINATION_PAGE_SIZE_LABEL, PAGE_SIZE_LABEL_TEXT[density])}>
                {pageSizeLabel}
              </span>
              <div className={PAGINATION_PAGE_SIZE_SELECT}>
                <Select
                  aria-label={pageSizeLabel}
                  size="small"
                  disabled={disabled}
                  value={String(pageSize)}
                  options={[...new Set([...pageSizeOptions, pageSize])]
                    .sort((a, b) => a - b)
                    .map((n) => ({ label: String(n), value: String(n) }))}
                  onValueChange={(v) => onPageSizeChange(Number(v))}
                />
              </div>
            </>
          ) : null}
        </div>
        <div className={PAGINATION_PAGES}>
          <button
            type="button"
            className={item}
            aria-label="Halaman sebelumnya"
            disabled={disabled || !canPrev}
            onClick={() => onPageChange(current - 1)}
          >
            <Icon name="chevron-left" className={PAGINATION_ICON} />
          </button>
          {(cursor ? [current] : pageItems(current, total)).map((p, i) =>
            p === 'ellipsis' ? (
              <span key={`ellipsis-${i}`} className={PAGINATION_ELLIPSIS} aria-hidden>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={cn(item, p === current && PAGINATION_CURRENT)}
                aria-current={p === current ? 'page' : undefined}
                disabled={disabled}
                onClick={() => p !== current && onPageChange(p)}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            className={item}
            aria-label="Halaman berikutnya"
            disabled={disabled || !canNext}
            onClick={() => onPageChange(current + 1)}
          >
            <Icon name="chevron-right" className={PAGINATION_ICON} />
          </button>
        </div>
      </nav>
    );
  },
);
Pagination.displayName = 'Pagination';
