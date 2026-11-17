import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, Table, TableBody, TableCell, TableRow } from './Table';
import { CheckBox } from './CheckBox';
import { DATATABLE_FRAME, DATATABLE_SLIM_SCROLLBAR } from './table-classes';

/**
 * DataTable behaviour. REAL tanstack throughout — no mock of the row models — because the
 * thing under test is which row models the table wires up in each mode.
 */

afterEach(cleanup);

type Person = { id: string; name: string; age: number };

/* Deliberately NOT in name order, so a local sort in server mode would visibly reorder them. */
const PEOPLE: Person[] = [
  { id: 'c', name: 'Citra', age: 30 },
  { id: 'a', name: 'Ayu', age: 25 },
  { id: 'b', name: 'Budi', age: 41 },
];

const COLUMNS: ColumnDef<Person>[] = [
  { accessorKey: 'name', header: 'Nama' },
  { accessorKey: 'age', header: 'Umur', enableSorting: false },
];

const bodyNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]?.textContent);

const sortHeader = () => screen.getByRole('button', { name: /Nama/ });

describe('DataTable', () => {
  it('cycles a sortable header ascending, descending, then unsorted, reporting each', () => {
    const onSortingChange = vi.fn();
    render(<DataTable columns={COLUMNS} data={PEOPLE} onSortingChange={onSortingChange} />);
    fireEvent.click(sortHeader());
    expect(bodyNames()).toEqual(['Ayu', 'Budi', 'Citra']);
    fireEvent.click(sortHeader());
    expect(bodyNames()).toEqual(['Citra', 'Budi', 'Ayu']);
    fireEvent.click(sortHeader());
    expect(bodyNames()).toEqual(['Citra', 'Ayu', 'Budi']);
    expect(onSortingChange.mock.calls).toEqual([
      [[{ id: 'name', desc: false }]],
      [[{ id: 'name', desc: true }]],
      [[]],
    ]);
    /* A column with sorting off is plain text, not a button. */
    expect(screen.queryByRole('button', { name: /Umur/ })).toBeNull();
  });

  it('does not sort locally in server mode — it reports and leaves the order to the server', () => {
    const onSortingChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        data={PEOPLE}
        serverSide
        pagination={{ pageIndex: 0, pageSize: 10, pageCount: 1 }}
        onSortingChange={onSortingChange}
      />,
    );
    fireEvent.click(sortHeader());
    expect(onSortingChange).toHaveBeenCalledWith([{ id: 'name', desc: false }]);
    expect(bodyNames()).toEqual(['Citra', 'Ayu', 'Budi']);
  });

  it('fires onRowClick, but not when the click lands on the selection checkbox', () => {
    const onRowClick = vi.fn();
    const onRowSelectionChange = vi.fn();
    const withSelect: ColumnDef<Person>[] = [
      {
        id: 'select',
        header: () => null,
        cell: ({ row }) => (
          <CheckBox
            label={`Pilih ${row.original.name}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      ...COLUMNS,
    ];
    render(
      <DataTable
        columns={withSelect}
        data={PEOPLE}
        getRowId={(p) => p.id}
        onRowClick={onRowClick}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );
    fireEvent.click(screen.getByText('Budi'));
    expect(onRowClick).toHaveBeenCalledWith(PEOPLE[2]);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Pilih Ayu' }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowSelectionChange).toHaveBeenCalledWith({ a: true });
  });

  it('renders one page of skeleton rows while loading, at the page size, even with no data', () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={[]}
        loading
        empty="Kosong"
        serverSide
        pagination={{ pageIndex: 0, pageSize: 7, pageCount: 0 }}
      />,
    );
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(7);
    expect(screen.queryByText('Kosong')).toBeNull();
  });

  it('renders the empty slot when there is no data and nothing is loading', () => {
    render(<DataTable columns={COLUMNS} data={[]} empty="Belum ada pesanan" />);
    expect(screen.getByText('Belum ada pesanan')).toBeTruthy();
  });

  it('hides a column the visibility state turns off', () => {
    render(<DataTable columns={COLUMNS} data={PEOPLE} columnVisibility={{ name: false }} />);
    expect(screen.queryByText('Nama')).toBeNull();
    expect(screen.queryByText('Ayu')).toBeNull();
    expect(screen.getByText('Umur')).toBeTruthy();
  });

  it('keeps its own visibility when the host does not control it', () => {
    const toggling: ColumnDef<Person>[] = [
      { accessorKey: 'name', header: 'Nama' },
      {
        accessorKey: 'age',
        enableSorting: false,
        header: ({ table }) => (
          <button type="button" onClick={() => table.getColumn('name')?.toggleVisibility(false)}>
            Sembunyikan nama
          </button>
        ),
      },
    ];
    const onColumnVisibilityChange = vi.fn();
    render(<DataTable columns={toggling} data={PEOPLE} onColumnVisibilityChange={onColumnVisibilityChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sembunyikan nama' }));
    expect(screen.queryByText('Nama')).toBeNull();
    expect(onColumnVisibilityChange).toHaveBeenCalledWith({ name: false });
  });

  it('filters client-side by globalFilter and a controlled column filter', () => {
    const { rerender } = render(<DataTable columns={COLUMNS} data={PEOPLE} globalFilter="bu" />);
    expect(bodyNames()).toEqual(['Budi']);
    rerender(
      <DataTable columns={COLUMNS} data={PEOPLE} columnFilters={[{ id: 'name', value: 'Ay' }]} />,
    );
    expect(bodyNames()).toEqual(['Ayu']);
  });

  it('reports a column filter change through onFilterChange', () => {
    const onFilterChange = vi.fn();
    const filtering: ColumnDef<Person>[] = [
      {
        accessorKey: 'name',
        enableSorting: false,
        header: ({ column }) => (
          <button type="button" onClick={() => column.setFilterValue('Bu')}>
            Saring
          </button>
        ),
      },
    ];
    render(<DataTable columns={filtering} data={PEOPLE} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saring' }));
    expect(onFilterChange).toHaveBeenCalledWith([{ id: 'name', value: 'Bu' }]);
    expect(bodyNames()).toEqual(['Budi']);
  });

  it('drops the frame with noBorder and draws the slim rail with slimScrollbar', () => {
    const frameOf = (root: HTMLElement) => root.querySelector('table')!.parentElement!.parentElement!;
    const framed = render(<DataTable columns={COLUMNS} data={PEOPLE} />).container;
    expect(frameOf(framed).className).toBe(DATATABLE_FRAME);
    cleanup();
    const bare = render(<DataTable columns={COLUMNS} data={PEOPLE} noBorder slimScrollbar />).container;
    expect(frameOf(bare).className).toBe('');
    const scroller = bare.querySelector('table')!.parentElement!;
    for (const c of DATATABLE_SLIM_SCROLLBAR.split(' ')) expect(scroller.classList.contains(c), c).toBe(true);
  });

  it('pages client-side through the Pagination footer', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `P${i}`, age: i }));
    render(<DataTable columns={COLUMNS} data={many} />);
    expect(bodyNames()).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(bodyNames()).toEqual(['P10', 'P11']);
  });

  it('reports server-side page changes 0-based', () => {
    const onPaginationChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        data={PEOPLE}
        serverSide
        pagination={{ pageIndex: 0, pageSize: 3, pageCount: 4 }}
        onPaginationChange={onPaginationChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    expect(onPaginationChange).toHaveBeenCalledWith(1, 3);
  });

  it('returns to the first page when the page size changes', () => {
    const onPaginationChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        data={PEOPLE}
        serverSide
        pagination={{ pageIndex: 2, pageSize: 10, pageCount: 4 }}
        onPaginationChange={onPaginationChange}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Item per halaman' }));
    fireEvent.click(screen.getByRole('option', { name: '20' }));
    expect(onPaginationChange).toHaveBeenCalledWith(0, 20);
  });

  /*
   * `density`, pinned as LITERAL classes rather than the class tables: a test that reads the
   * tables stays green when someone edits them, and the default below is the library's original
   * look — it must go red the day the compact look drifts (UMK-1306).
   */
  it('omitted density renders exactly the compact classes — the 10px table and 12px pager text', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={PEOPLE} />);
    const table = container.querySelector('table')!;
    expect(table.className).toContain('text-ds-body-md-mobile');
    expect(table.className).not.toContain('text-ds-body-md-desktop');

    const page1 = screen.getByRole('button', { name: '1' });
    expect(page1.className).toContain('text-ds-body-lg-mobile');
    expect(page1.className).not.toContain('text-ds-body-lg-desktop');

    const label = screen.getByText('Item per halaman');
    expect(label.className).toContain('text-ds-body-md-mobile');
    expect(label.className).not.toContain('text-ds-body-lg-desktop');
  });

  it('comfortable reaches the table AND the footer pager: 12px body text, 14px numbers and label', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={PEOPLE} density="comfortable" />);
    const table = container.querySelector('table')!;
    expect(table.className).toContain('text-ds-body-md-desktop');
    expect(table.className).toContain('font-medium');
    expect(table.className).not.toContain('text-ds-body-md-mobile');

    const page1 = screen.getByRole('button', { name: '1' });
    expect(page1.className).toContain('text-ds-body-lg-desktop');
    expect(page1.className).not.toContain('text-ds-body-lg-mobile');

    const label = screen.getByText('Item per halaman');
    expect(label.className).toContain('text-ds-body-lg-desktop');
    expect(label.className).not.toContain('text-ds-body-md-mobile');
  });

  /*
   * The size lives on the <table> and every cell INHERITS it, so a cell carrying a type step of
   * its own would silently defeat `comfortable` for that column (UMK-1306). The header keeps its
   * own semibold weight over the body's 500.
   */
  it('no header or body cell sets its own type step, and the header stays semibold', () => {
    const { container } = render(<DataTable columns={COLUMNS} data={PEOPLE} density="comfortable" />);
    const cells = [...container.querySelectorAll('th, td')];
    expect(cells.length).toBeGreaterThan(PEOPLE.length);
    for (const cell of cells) expect(cell.className).not.toMatch(/\btext-ds-/);
    for (const th of container.querySelectorAll('th')) {
      expect(th.className).toContain('font-semibold');
      expect(th.className).not.toContain('font-medium');
    }
  });

  it('a bare Table with no density renders the compact type', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Citra</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = container.querySelector('table')!;
    expect(table.className).toContain('text-ds-body-md-mobile');
    expect(table.className).not.toContain('text-ds-body-md-desktop');
    expect(table.className).not.toContain('font-medium');
  });
});
