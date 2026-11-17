'use client';

import React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
} from '@tanstack/react-table';
import { cn } from '../../utils';
import { Icon } from '../Icon';
import { Pagination } from '../Pagination';
import { Skeleton } from '../Skeleton';
import {
  DATATABLE_CLICKABLE_ROW,
  DATATABLE_EMPTY,
  DATATABLE_FIXED,
  DATATABLE_FOOTER,
  DATATABLE_FRAME,
  DATATABLE_ROOT,
  DATATABLE_SCROLL_Y,
  DATATABLE_SLIM_SCROLLBAR,
  DATATABLE_SKELETON,
  DATATABLE_SORT_BUTTON,
  DATATABLE_SORT_ICON,
  DATATABLE_STICKY,
  DATATABLE_STICKY_HEADER,
} from '../table-classes';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableDensity,
} from './Table';

/** Per-column pinning hints, read off `columnDef.meta`. */
export interface DataTableColumnMeta {
  /** Pin to the right edge. */
  stickyRight?: boolean;
  /** Pixel offset from the left edge. Set on every pinned column, including the first (0). */
  stickyLeft?: number;
  /** Draw the divider — on the LAST left-pinned column only. */
  stickyLeftDivider?: boolean;
}

export interface DataTableProps<TData, TValue = unknown> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Skeleton rows, one page of them, even when `data` is empty. */
  loading?: boolean;
  /**
   * The server pages, sorts and filters: the table does none of it locally and reports every
   * change through the callbacks instead.
   */
  serverSide?: boolean;
  /** Server-side paging state. `pageIndex` is 0-based. */
  pagination?: { pageIndex: number; pageSize: number; pageCount: number };
  totalRows?: number;
  /** Always returns to page 0 when the page size changes. */
  onPaginationChange?: (pageIndex: number, pageSize: number) => void;
  onSortingChange?: (sorting: SortingState) => void;
  initialSorting?: SortingState;
  globalFilter?: string;
  columnFilters?: ColumnFiltersState;
  onFilterChange?: (filters: ColumnFiltersState) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;
  /**
   * Stable row identity. Required whenever selection is lifted out of the table: without it the
   * selection is keyed by row INDEX and follows positions across pages and sorts.
   */
  getRowId?: (row: TData) => string;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  /** Not fired when the click lands on a control inside the row, such as a selection checkbox. */
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string | undefined;
  /** Search, filters and actions — admin UI the host composes. Rendered above the table. */
  toolbar?: React.ReactNode;
  /** Shown when there are no rows and nothing is loading. */
  empty?: React.ReactNode;
  hidePagination?: boolean;
  /** Cap the height and scroll the rows under a pinned header (e.g. `"60vh"`). */
  maxBodyHeight?: string;
  /** Minimum width in px, forcing horizontal scroll. Pair with `fixedLayout`. */
  minWidth?: number;
  /** `table-layout: fixed`, so column `size` values become exact widths. */
  fixedLayout?: boolean;
  /** Choices offered by the page-size control. The current size is always offered too. */
  pageSizeOptions?: readonly number[];
  /** Drop the outer frame — for a table that already sits inside a card. */
  noBorder?: boolean;
  /** A thin, low-contrast scrollbar rail instead of the browser default. */
  slimScrollbar?: boolean;
  /**
   * Passed through to the table and the footer pager. Type only (size, and the body weight):
   * the default `compact` is the library's original look.
   */
  density?: TableDensity;
}

const resolve = <T,>(updater: Updater<T>, current: T): T =>
  typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater;

/** A `size` of 9999 or more means "fill the remaining space"; below that it is pixels. */
const widthOf = (size: number | undefined): React.CSSProperties | undefined =>
  typeof size === 'number' && size > 0 ? { width: size >= 9999 ? 'auto' : `${size}px` } : undefined;

const stickyOf = (meta: DataTableColumnMeta | undefined) => {
  if (meta?.stickyRight) return { className: DATATABLE_STICKY.right, style: undefined };
  if (typeof meta?.stickyLeft === 'number')
    return {
      className: cn(DATATABLE_STICKY.left, meta.stickyLeftDivider && DATATABLE_STICKY.leftDivider),
      style: { left: `${meta.stickyLeft}px` },
    };
  return { className: undefined, style: undefined };
};

/** A click that lands on a control inside the row belongs to that control, not the row. */
const INTERACTIVE = 'input, button, a, label, select, textarea, [role="checkbox"]';

/**
 * A headless table over `@tanstack/react-table`: column definitions are tanstack `ColumnDef`s,
 * so admin's existing columns keep working. Sorting is one mechanism — a sortable header is a
 * button cycling ascending, descending, unsorted. The footer is `Pagination`.
 */
export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  loading = false,
  serverSide = false,
  pagination,
  totalRows,
  onPaginationChange,
  onSortingChange,
  initialSorting,
  globalFilter,
  columnFilters: controlledFilters,
  onFilterChange,
  columnVisibility: controlledVisibility,
  onColumnVisibilityChange,
  getRowId,
  rowSelection: controlledSelection,
  onRowSelectionChange,
  onRowClick,
  rowClassName,
  toolbar,
  empty = 'Tidak ada data.',
  hidePagination = false,
  maxBodyHeight,
  minWidth,
  fixedLayout = false,
  noBorder = false,
  pageSizeOptions,
  slimScrollbar = false,
  density = 'compact',
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting ?? []);
  const [internalFilters, setInternalFilters] = React.useState<ColumnFiltersState>([]);
  const [internalVisibility, setInternalVisibility] = React.useState<VisibilityState>({});
  const [internalSelection, setInternalSelection] = React.useState<RowSelectionState>({});
  const [clientPagination, setClientPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: pagination?.pageSize ?? 10,
  });
  const columnFilters = controlledFilters ?? internalFilters;
  const rowSelection = controlledSelection ?? internalSelection;
  const columnVisibility = controlledVisibility ?? internalVisibility;
  const paging: PaginationState =
    serverSide && pagination
      ? { pageIndex: pagination.pageIndex, pageSize: pagination.pageSize }
      : clientPagination;

  const table = useReactTable({
    data,
    columns,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: serverSide ? undefined : getSortedRowModel(),
    getFilteredRowModel: serverSide ? undefined : getFilteredRowModel(),
    getPaginationRowModel: serverSide ? undefined : getPaginationRowModel(),
    manualSorting: serverSide,
    manualFiltering: serverSide,
    manualPagination: serverSide,
    /* Ascending first for every column: tanstack otherwise opens a numeric column descending. */
    sortDescFirst: false,
    pageCount: serverSide ? pagination?.pageCount : undefined,
    rowCount: serverSide ? totalRows : undefined,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
      pagination: paging,
      columnVisibility,
    },
    onSortingChange: (updater) => {
      const next = resolve(updater, sorting);
      setSorting(next);
      onSortingChange?.(next);
    },
    onColumnFiltersChange: (updater) => {
      const next = resolve(updater, columnFilters);
      if (!controlledFilters) setInternalFilters(next);
      onFilterChange?.(next);
    },
    onColumnVisibilityChange: (updater) => {
      const next = resolve(updater, columnVisibility);
      if (!controlledVisibility) setInternalVisibility(next);
      onColumnVisibilityChange?.(next);
    },
    onRowSelectionChange: (updater) => {
      const next = resolve(updater, rowSelection);
      if (!controlledSelection) setInternalSelection(next);
      onRowSelectionChange?.(next);
    },
    onPaginationChange: (updater) => {
      const next = resolve(updater, paging);
      if (!(serverSide && pagination)) setClientPagination(next);
      if (serverSide) onPaginationChange?.(next.pageIndex, next.pageSize);
    },
  });

  const visibleColumns = table.getVisibleLeafColumns().length;
  const rows = table.getRowModel().rows;

  const setPageSize = (pageSize: number) => {
    /* Back to the first page: page 4 of 5 at the old size may not exist at the new one. */
    if (!(serverSide && pagination)) setClientPagination({ pageIndex: 0, pageSize });
    if (serverSide) onPaginationChange?.(0, pageSize);
  };

  return (
    <div className={DATATABLE_ROOT}>
      {toolbar}
      <div className={cn(!noBorder && DATATABLE_FRAME)}>
        <Table
          density={density}
          className={cn(fixedLayout && DATATABLE_FIXED)}
          style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
          containerClassName={cn(maxBodyHeight && DATATABLE_SCROLL_Y, slimScrollbar && DATATABLE_SLIM_SCROLLBAR)}
          containerStyle={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
        >
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const { column } = header;
                  const sticky = stickyOf(column.columnDef.meta as DataTableColumnMeta | undefined);
                  const sorted = column.getIsSorted();
                  const label = flexRender(column.columnDef.header, header.getContext());
                  return (
                    <TableHead
                      key={header.id}
                      style={{ ...widthOf(column.columnDef.size), ...sticky.style }}
                      /* Header classes LAST so a left-pinned header wins where both axes stick. */
                      className={cn(sticky.className, maxBodyHeight && DATATABLE_STICKY_HEADER)}
                      aria-sort={
                        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                      }
                    >
                      {header.isPlaceholder ? null : column.getCanSort() ? (
                        <button
                          type="button"
                          className={DATATABLE_SORT_BUTTON}
                          onClick={column.getToggleSortingHandler()}
                        >
                          {label}
                          <Icon
                            name={sorted === 'desc' ? 'chevron-down' : 'chevron-up'}
                            className={sorted ? DATATABLE_SORT_ICON.active : DATATABLE_SORT_ICON.idle}
                          />
                        </button>
                      ) : (
                        label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: paging.pageSize }, (_, i) => (
                <TableRow key={`skeleton-${i}`} data-skeleton-row>
                  {Array.from({ length: visibleColumns }, (_, j) => (
                    <TableCell key={j}>
                      <Skeleton className={DATATABLE_SKELETON} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  className={cn(onRowClick && DATATABLE_CLICKABLE_ROW, rowClassName?.(row.original))}
                  onClick={
                    onRowClick
                      ? (e) => {
                          const hit = (e.target as HTMLElement).closest(INTERACTIVE);
                          if (hit && e.currentTarget.contains(hit)) return;
                          onRowClick(row.original);
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => {
                    const sticky = stickyOf(cell.column.columnDef.meta as DataTableColumnMeta | undefined);
                    return (
                      <TableCell
                        key={cell.id}
                        style={{ ...widthOf(cell.column.columnDef.size), ...sticky.style }}
                        className={sticky.className}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumns} className={DATATABLE_EMPTY}>
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {hidePagination ? null : (
        <Pagination
          density={density}
          className={DATATABLE_FOOTER}
          page={paging.pageIndex + 1}
          pageCount={table.getPageCount()}
          onPageChange={(page) => table.setPageIndex(page - 1)}
          pageSize={paging.pageSize}
          onPageSizeChange={setPageSize}
          pageSizeOptions={pageSizeOptions}
        />
      )}
    </div>
  );
}
