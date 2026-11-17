'use client';

import React from 'react';
import { contract } from '../../contract';
import { cn } from '../../utils';
import {
  TABLE,
  TABLE_CELL,
  TABLE_CONTAINER,
  TABLE_HEAD,
  TABLE_ROW,
  TABLE_TYPE,
} from '../table-classes';

type Axes = typeof contract.Table.axes;

export type TableDensity = Axes['density'][number];

const TYPE = TABLE_TYPE satisfies Record<TableDensity, string>;

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Classes for the horizontal scroll container around the table. */
  containerClassName?: string;
  /** Inline style for that container — a max-height has to be a real value, not a class. */
  containerStyle?: React.CSSProperties;
  /** Type only: `comfortable` is the 12/18 desktop step at weight 500; the default is `compact`. */
  density?: TableDensity;
}

/**
 * The presentational parts of a table: a scroll container, a `<table>` and its rows and cells.
 * `DataTable` renders through these; a hand-written table can use them directly. Ensyra
 * `01 Table Header Cell` / `02 Table Cell` (149:4990 / 149:5011).
 */
export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, containerStyle, density = 'compact', ...props }, ref) => (
    <div className={cn(TABLE_CONTAINER, containerClassName)} style={containerStyle}>
      <table ref={ref} className={cn(TABLE, TYPE[density], className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <thead ref={ref} {...props} />);
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <tbody ref={ref} {...props} />);
TableBody.displayName = 'TableBody';

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => <tr ref={ref} className={cn(TABLE_ROW, className)} {...props} />,
);
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => <th ref={ref} className={cn(TABLE_HEAD, className)} {...props} />);
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => <td ref={ref} className={cn(TABLE_CELL, className)} {...props} />);
TableCell.displayName = 'TableCell';
