import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type {
  ColumnDef,
  ColumnFiltersState,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table';
import { contract } from '../../contract';
import { Button } from '../Button';
import { CheckBox } from '../CheckBox';
import { Select } from '../Select';
import { Skeleton } from '../Skeleton';
import { TextField } from '../TextField';
import { DataTable } from './DataTable';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';

/**
 * ONE STORY PER WAY ADMIN USES A TABLE TODAY, so UMK-1188 can port each call site against a
 * worked example. The prop each story exists for is named in its docblock; admin's current
 * spelling is given where it changes.
 */
const meta: Meta<typeof DataTable> = {
  title: 'Components/Content/Table',
  component: DataTable,
};
export default meta;

type Story = StoryObj<typeof DataTable>;

type Order = { id: string; customer: string; product: string; total: number; status: string };

const STATUSES = ['Lunas', 'Menunggu', 'Batal'];

const ORDERS: Order[] = Array.from({ length: 23 }, (_, i) => ({
  id: `INV-${String(i + 1).padStart(3, '0')}`,
  customer: ['Ayu', 'Budi', 'Citra', 'Dewi', 'Eko'][i % 5],
  product: ['Kelas Branding', 'Kelas Foto Produk', 'Kelas Keuangan'][i % 3],
  total: 150000 + ((i * 37000) % 400000),
  status: STATUSES[i % 3],
}));

const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

/**
 * `header: 'Invoice'` is the whole migration for the 11 files that wrap a title in
 * `DataTableColumnHeader`: a sortable column's header is already a sort button here.
 */
const COLUMNS: ColumnDef<Order>[] = [
  { accessorKey: 'id', header: 'Invoice' },
  { accessorKey: 'customer', header: 'Pelanggan' },
  { accessorKey: 'product', header: 'Produk' },
  { accessorKey: 'total', header: 'Total', cell: ({ getValue }) => rupiah(getValue<number>()) },
  {
    accessorKey: 'status',
    header: 'Status',
    enableSorting: false,
    /* Exact match, so the status filter below is not a substring search. */
    filterFn: 'equalsString',
  },
];

/* ------------------------------------------------------------------------ the parts alone */

/** The parts with no tanstack behind them. */
export const Plain: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Pelanggan</TableHead>
          <TableHead>Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ORDERS.slice(0, 4).map((o) => (
          <TableRow key={o.id}>
            <TableCell>{o.id}</TableCell>
            <TableCell>{o.customer}</TableCell>
            <TableCell>{rupiah(o.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

/**
 * The hand-written admin tables (`ai-feedback/*-table`, `learning-submissions/*-table`,
 * `journeys/list`): a right-aligned number column, an action column pinned right, skeleton
 * rows while loading and a full-width empty row. All of it is `className` / `colSpan` on the
 * parts — no DataTable needed.
 */
const HandWrittenHarness = ({ state }: { state: 'rows' | 'loading' | 'empty' }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Pelanggan</TableHead>
        <TableHead>Produk</TableHead>
        <TableHead className="text-right">Total</TableHead>
        <TableHead className="sticky right-0 bg-default-primary">Aksi</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {state === 'loading' ? (
        Array.from({ length: 3 }, (_, i) => (
          <TableRow key={i}>
            <TableCell colSpan={4}>
              <Skeleton className="h-6 w-full" />
            </TableCell>
          </TableRow>
        ))
      ) : state === 'empty' ? (
        <TableRow>
          <TableCell colSpan={4} className="py-8 text-center text-default-secondary">
            Belum ada masukan.
          </TableCell>
        </TableRow>
      ) : (
        ORDERS.slice(0, 5).map((o) => (
          <TableRow key={o.id}>
            <TableCell>{o.customer}</TableCell>
            <TableCell className="max-w-[220px] truncate">{o.product}</TableCell>
            <TableCell className="text-right">{rupiah(o.total)}</TableCell>
            <TableCell className="sticky right-0 bg-default-primary">
              <Button type="text" size="small">
                Lihat
              </Button>
            </TableCell>
          </TableRow>
        ))
      )}
    </TableBody>
  </Table>
);

export const HandWritten: Story = {
  render: () => (
    <div className="space-y-8">
      <HandWrittenHarness state="rows" />
      <HandWrittenHarness state="loading" />
      <HandWrittenHarness state="empty" />
    </div>
  ),
};

/* ------------------------------------------------------------------------ DataTable */

/** Sorting and paging done in the browser — the default when `serverSide` is unset. */
export const ClientSide: Story = {
  render: () => <DataTable columns={COLUMNS} data={ORDERS} />,
};

/**
 * Admin's `searchKey` + `searchPlaceholder` + `filters` + `actions`, rebuilt as a `toolbar`.
 * Client-side: the search box drives `globalFilter` and the status select a controlled
 * `columnFilters` entry; the table filters locally.
 */
const ClientToolbarHarness = () => {
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const columnFilters: ColumnFiltersState = status ? [{ id: 'status', value: status }] : [];
  return (
    <DataTable
      columns={COLUMNS}
      data={ORDERS}
      globalFilter={search}
      columnFilters={columnFilters}
      toolbar={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <TextField
                label="Cari pesanan"
                placeholder="Cari pelanggan atau invoice"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="w-40">
              <Select
                aria-label="Status"
                placeholder="Semua status"
                value={status}
                options={[{ label: 'Semua status', value: '' }, ...STATUSES.map((s) => ({ label: s, value: s }))]}
                onValueChange={setStatus}
              />
            </div>
          </div>
          <Button size="small">Tambah pesanan</Button>
        </div>
      }
    />
  );
};

export const ClientToolbar: Story = { render: () => <ClientToolbarHarness /> };

/**
 * `serverSide` with `pagination`, `totalRows`, `onPaginationChange`, `initialSorting`,
 * `onSortingChange` and a search. The table only reports; a fake fetch pages, sorts and
 * filters. The search is HOST state passed to the fetch — admin's `searchKey` +
 * `onFilterChange` round-trip through a tanstack column filter is no longer needed, though
 * `columnFilters` + `onFilterChange` still work for a host that wants it.
 */
const ServerHarness = () => {
  const [page, setPage] = React.useState({ pageIndex: 0, pageSize: 5 });
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'id', desc: true }]);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<{ rows: Order[]; total: number }>({ rows: [], total: 0 });
  React.useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      const s = sorting[0];
      const matched = ORDERS.filter((o) => o.customer.toLowerCase().includes(search.toLowerCase()));
      const sorted = s
        ? [...matched].sort((a, b) => {
            const x = a[s.id as keyof Order];
            const y = b[s.id as keyof Order];
            return (x < y ? -1 : x > y ? 1 : 0) * (s.desc ? -1 : 1);
          })
        : matched;
      const from = page.pageIndex * page.pageSize;
      setResult({ rows: sorted.slice(from, from + page.pageSize), total: matched.length });
      setLoading(false);
    }, 400);
    return () => clearTimeout(t);
  }, [page, sorting, search]);
  return (
    <DataTable
      columns={COLUMNS}
      data={result.rows}
      loading={loading}
      serverSide
      totalRows={result.total}
      pagination={{ ...page, pageCount: Math.ceil(result.total / page.pageSize) }}
      onPaginationChange={(pageIndex, pageSize) => setPage({ pageIndex, pageSize })}
      initialSorting={sorting}
      onSortingChange={setSorting}
      toolbar={
        <div className="w-64">
          <TextField
            label="Cari pelanggan"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage((p) => ({ ...p, pageIndex: 0 }));
            }}
          />
        </div>
      }
    />
  );
};

export const ServerSide: Story = { render: () => <ServerHarness /> };

/** `loading`: one page of skeleton rows, even with no data yet. */
export const Loading: Story = {
  render: () => <DataTable columns={COLUMNS} data={[]} loading />,
};

/** `density`: every value the contract declares — TYPE SIZE only, the rows keep one height. */
export const Density: Story = {
  render: () => (
    <div className="space-y-8">
      {contract.Table.axes.density.map((density) => (
        <DataTable key={density} columns={COLUMNS} data={ORDERS.slice(0, 5)} density={density} />
      ))}
    </div>
  ),
};

/** `empty`: admin's fixed "no results" cell becomes a slot the host fills with its own copy. */
export const Empty: Story = {
  render: () => <DataTable columns={COLUMNS} data={[]} empty="Belum ada pesanan." />,
};

/**
 * `getRowId` + `rowSelection` + `onRowSelectionChange`, with a select-all header checkbox that
 * goes indeterminate on a partial selection (admin's users table). `getRowId` is what keeps a
 * selection on the same rows across pages and sorts.
 */
const SelectionHarness = () => {
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const columns: ColumnDef<Order>[] = [
    {
      id: 'select',
      enableSorting: false,
      header: ({ table }) => (
        <CheckBox
          label={<span className="sr-only">Pilih semua di halaman ini</span>}
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <CheckBox
          label={<span className="sr-only">Pilih {row.original.id}</span>}
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    },
    ...COLUMNS,
  ];
  return (
    <DataTable
      columns={columns}
      data={ORDERS}
      getRowId={(o) => o.id}
      rowSelection={selection}
      onRowSelectionChange={setSelection}
      toolbar={<p>{Object.keys(selection).length} dipilih</p>}
    />
  );
};

export const RowSelection: Story = { render: () => <SelectionHarness /> };

/**
 * `onRowClick` + `rowClassName` + `noBorder` — a table inside a card, rows that open a detail,
 * and cancelled orders dimmed. A click on a control inside the row stays with the control.
 */
const ClickableHarness = () => {
  const [opened, setOpened] = React.useState<string>('—');
  return (
    <div className="rounded-lg border border-default-primary p-4">
      <p>Dibuka: {opened}</p>
      <DataTable
        noBorder
        columns={COLUMNS}
        data={ORDERS}
        onRowClick={(o) => setOpened(o.id)}
        rowClassName={(o) => (o.status === 'Batal' ? 'text-default-secondary' : undefined)}
      />
    </div>
  );
};

export const ClickableRows: Story = { render: () => <ClickableHarness /> };

/**
 * `maxBodyHeight` + `hidePagination` + `slimScrollbar`: a short embedded list that scrolls its
 * rows under a pinned header instead of paging.
 */
export const ScrollingBody: Story = {
  render: () => (
    <DataTable
      columns={COLUMNS}
      data={ORDERS}
      maxBodyHeight="320px"
      hidePagination
      slimScrollbar
    />
  ),
};

/**
 * `minWidth` + `fixedLayout` + the `meta` pin keys: a selection checkbox and the invoice pinned
 * left (offsets 0 and 48, divider on the last), status pinned right. Scroll sideways at a desktop
 * width; below `sm` nothing pins. `minWidth` is the SUM of every `size`, or a pinned column's
 * real width drifts from its neighbour's offset.
 */
export const StickyColumns: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <DataTable
        fixedLayout
        slimScrollbar
        minWidth={948}
        getRowId={(o) => o.id}
        columns={[
          {
            id: 'select',
            size: 48,
            enableSorting: false,
            meta: { stickyLeft: 0 },
            header: () => null,
            cell: ({ row }) => (
              <CheckBox
                label={<span className="sr-only">Pilih {row.original.id}</span>}
                checked={row.getIsSelected()}
                onChange={row.getToggleSelectedHandler()}
              />
            ),
          },
          { ...COLUMNS[0], size: 140, meta: { stickyLeft: 48, stickyLeftDivider: true } },
          { ...COLUMNS[1], size: 200 },
          { ...COLUMNS[2], size: 260 },
          { ...COLUMNS[3], size: 180 },
          { ...COLUMNS[4], size: 120, meta: { stickyRight: true } },
        ]}
        data={ORDERS}
      />
    </div>
  ),
};
