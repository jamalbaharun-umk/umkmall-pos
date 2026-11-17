import type { Kind } from './-api'

// Columns per report, in Lakasir's order. `money` cells render as rupiah; the API sends integer rupiah.
export type Column = { key: string; label: string; money?: boolean; num?: boolean }
export type TotalLine = { key: string; label: string; money?: boolean }
export type ReportDef = { kind: Kind; title: string; hint: string; columns: Column[]; totals: TotalLine[] }

const salesTotals: TotalLine[] = [
  { key: 'salesCount', label: 'Jumlah transaksi' },
  { key: 'qty', label: 'Jumlah barang' },
  { key: 'grossSales', label: 'Penjualan kotor', money: true },
  { key: 'discount', label: 'Diskon', money: true },
  { key: 'tax', label: 'Pajak', money: true },
  { key: 'revenue', label: 'Pendapatan', money: true },
  { key: 'cost', label: 'Modal', money: true },
  { key: 'grossProfit', label: 'Laba kotor', money: true },
]

export const REPORTS: Record<string, ReportDef> = {
  penjualan: {
    kind: 'sales',
    title: 'Laporan penjualan',
    hint: 'Setiap barang yang terjual, per struk.',
    columns: [
      { key: 'number', label: 'No. struk', num: true },
      { key: 'time', label: 'Waktu' },
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Produk' },
      { key: 'qty', label: 'Qty', num: true },
      { key: 'unitPrice', label: 'Harga', money: true },
      { key: 'lineTotal', label: 'Jumlah', money: true },
      { key: 'cost', label: 'Modal', money: true },
      { key: 'grossProfit', label: 'Laba kotor', money: true },
    ],
    totals: salesTotals,
  },
  produk: {
    kind: 'products',
    title: 'Laporan produk',
    hint: 'Penjualan per produk. Diskon per struk dan pajak hanya ada di total.',
    columns: [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Produk' },
      { key: 'qty', label: 'Terjual', num: true },
      { key: 'sales', label: 'Penjualan', money: true },
      { key: 'cost', label: 'Modal', money: true },
      { key: 'grossProfit', label: 'Laba kotor', money: true },
    ],
    totals: salesTotals,
  },
  shift: {
    kind: 'shifts',
    title: 'Laporan kasir',
    hint: 'Per shift kasir: penjualan dan selisih kas.',
    columns: [
      { key: 'cashier', label: 'Kasir' },
      { key: 'openedAt', label: 'Buka' },
      { key: 'closedAt', label: 'Tutup' },
      { key: 'salesCount', label: 'Transaksi', num: true },
      { key: 'revenue', label: 'Pendapatan', money: true },
      { key: 'grossProfit', label: 'Laba kotor', money: true },
      { key: 'openingCash', label: 'Kas awal', money: true },
      { key: 'expectedCash', label: 'Kas seharusnya', money: true },
      { key: 'countedCash', label: 'Kas dihitung', money: true },
      { key: 'difference', label: 'Selisih', money: true },
    ],
    totals: [
      { key: 'shifts', label: 'Jumlah shift' },
      { key: 'salesCount', label: 'Jumlah transaksi' },
      { key: 'revenue', label: 'Pendapatan', money: true },
      { key: 'cost', label: 'Modal', money: true },
      { key: 'grossProfit', label: 'Laba kotor', money: true },
    ],
  },
  pembelian: {
    kind: 'purchasing',
    title: 'Laporan pembelian',
    hint: 'Pembelian yang sudah disetujui, menurut tanggal persetujuan.',
    columns: [
      { key: 'date', label: 'Tanggal' },
      { key: 'supplier', label: 'Pemasok' },
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Produk' },
      { key: 'qty', label: 'Qty', num: true },
      { key: 'unitCost', label: 'Harga beli', money: true },
      { key: 'lineTotal', label: 'Jumlah', money: true },
    ],
    totals: [
      { key: 'orders', label: 'Jumlah pembelian' },
      { key: 'qty', label: 'Jumlah barang' },
      { key: 'total', label: 'Total pembelian', money: true },
    ],
  },
}

/** Whole-number percentage change; null when there is nothing to compare with. */
export function change(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 100)
}
