// What each report prints, in Lakasir's column order: the same columns and totals as the screen
// (`apps/pos-web/src/routes/laporan/-reports.ts`), so the PDF and the screen carry the same figures.

export type ReportKind = 'sales' | 'products' | 'shifts' | 'purchasing';
export interface Col {
  key: string;
  label: string;
  /** `rp` rupiah, `int` a count, `diff` a drawer difference, `text` as is. */
  as: 'rp' | 'int' | 'diff' | 'text';
  weight: number;
}
export interface TotalDef {
  key: string;
  label: string;
  as: 'rp' | 'int';
}
export interface ReportDef {
  title: string;
  slug: string;
  landscape: boolean;
  columns: Col[];
  totals: TotalDef[];
}

const salesTotals: TotalDef[] = [
  { key: 'salesCount', label: 'Jumlah transaksi', as: 'int' },
  { key: 'qty', label: 'Jumlah barang', as: 'int' },
  { key: 'grossSales', label: 'Penjualan kotor', as: 'rp' },
  { key: 'discount', label: 'Diskon', as: 'rp' },
  { key: 'voucher', label: 'Voucher', as: 'rp' },
  { key: 'tax', label: 'Pajak', as: 'rp' },
  { key: 'revenue', label: 'Pendapatan', as: 'rp' },
  { key: 'cost', label: 'Modal', as: 'rp' },
  { key: 'grossProfit', label: 'Laba kotor', as: 'rp' },
  { key: 'rounding', label: 'Pembulatan', as: 'rp' },
];

export const REPORT_DEFS: Record<ReportKind, ReportDef> = {
  sales: {
    title: 'Laporan penjualan',
    slug: 'penjualan',
    landscape: true,
    columns: [
      { key: 'number', label: 'No. struk', as: 'int', weight: 1 },
      { key: 'time', label: 'Waktu', as: 'text', weight: 1.7 },
      { key: 'cashier', label: 'Kasir', as: 'text', weight: 1.5 },
      { key: 'sku', label: 'SKU', as: 'text', weight: 1.3 },
      { key: 'name', label: 'Produk', as: 'text', weight: 3 },
      { key: 'qty', label: 'Qty', as: 'int', weight: 0.8 },
      { key: 'unitPrice', label: 'Harga', as: 'rp', weight: 1.5 },
      { key: 'lineTotal', label: 'Jumlah', as: 'rp', weight: 1.6 },
      { key: 'cost', label: 'Modal', as: 'rp', weight: 1.5 },
      { key: 'grossProfit', label: 'Laba kotor', as: 'rp', weight: 1.6 },
    ],
    totals: salesTotals,
  },
  products: {
    title: 'Laporan produk',
    slug: 'produk',
    landscape: false,
    columns: [
      { key: 'sku', label: 'SKU', as: 'text', weight: 1.5 },
      { key: 'name', label: 'Produk', as: 'text', weight: 3.5 },
      { key: 'qty', label: 'Terjual', as: 'int', weight: 1 },
      { key: 'sales', label: 'Penjualan', as: 'rp', weight: 1.7 },
      { key: 'cost', label: 'Modal', as: 'rp', weight: 1.7 },
      { key: 'grossProfit', label: 'Laba kotor', as: 'rp', weight: 1.7 },
    ],
    totals: salesTotals,
  },
  shifts: {
    title: 'Laporan kasir',
    slug: 'shift',
    landscape: true,
    columns: [
      { key: 'cashier', label: 'Kasir', as: 'text', weight: 1.6 },
      { key: 'openedAt', label: 'Buka', as: 'text', weight: 1.8 },
      { key: 'closedAt', label: 'Tutup', as: 'text', weight: 1.8 },
      { key: 'salesCount', label: 'Transaksi', as: 'int', weight: 1 },
      { key: 'revenue', label: 'Pendapatan', as: 'rp', weight: 1.7 },
      { key: 'grossProfit', label: 'Laba kotor', as: 'rp', weight: 1.6 },
      { key: 'rounding', label: 'Pembulatan', as: 'rp', weight: 1.2 },
      { key: 'openingCash', label: 'Kas awal', as: 'rp', weight: 1.5 },
      { key: 'expectedCash', label: 'Kas seharusnya', as: 'rp', weight: 1.7 },
      { key: 'countedCash', label: 'Kas dihitung', as: 'rp', weight: 1.7 },
      { key: 'difference', label: 'Selisih', as: 'diff', weight: 1.5 },
    ],
    totals: [
      { key: 'shifts', label: 'Jumlah shift', as: 'int' },
      { key: 'salesCount', label: 'Jumlah transaksi', as: 'int' },
      { key: 'revenue', label: 'Pendapatan', as: 'rp' },
      { key: 'cost', label: 'Modal', as: 'rp' },
      { key: 'grossProfit', label: 'Laba kotor', as: 'rp' },
      { key: 'rounding', label: 'Pembulatan', as: 'rp' },
    ],
  },
  purchasing: {
    title: 'Laporan pembelian',
    slug: 'pembelian',
    landscape: false,
    columns: [
      { key: 'date', label: 'Tanggal', as: 'text', weight: 1.5 },
      { key: 'supplier', label: 'Pemasok', as: 'text', weight: 2.2 },
      { key: 'sku', label: 'SKU', as: 'text', weight: 1.4 },
      { key: 'name', label: 'Produk', as: 'text', weight: 2.6 },
      { key: 'qty', label: 'Qty', as: 'int', weight: 0.8 },
      { key: 'unitCost', label: 'Harga beli', as: 'rp', weight: 1.5 },
      { key: 'lineTotal', label: 'Jumlah', as: 'rp', weight: 1.6 },
    ],
    totals: [
      { key: 'orders', label: 'Jumlah pembelian', as: 'int' },
      { key: 'qty', label: 'Jumlah barang', as: 'int' },
      { key: 'total', label: 'Total pembelian', as: 'rp' },
    ],
  },
};
