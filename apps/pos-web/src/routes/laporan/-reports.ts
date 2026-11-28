import type { Kind } from './-api'

// Columns per report, in Lakasir's order. `money` cells render as rupiah; the API sends integer rupiah.
export type Column = { key: string; label: string; money?: boolean; num?: boolean; cashDiff?: boolean }
export type TotalLine = { key: string; label: string; money?: boolean }
export type ReportDef = { kind: Kind; title: string; hint: string; columns: Column[]; totals: TotalLine[] }

const salesTotals: TotalLine[] = [
  { key: 'salesCount', label: 'Jumlah transaksi' },
  { key: 'qty', label: 'Jumlah barang' },
  { key: 'grossSales', label: 'Penjualan kotor', money: true },
  { key: 'discount', label: 'Diskon', money: true },
  { key: 'voucher', label: 'Voucher', money: true },
  { key: 'tax', label: 'Pajak', money: true },
  { key: 'revenue', label: 'Pendapatan', money: true },
  { key: 'cost', label: 'Modal', money: true },
  { key: 'grossProfit', label: 'Laba kotor', money: true },
  { key: 'rounding', label: 'Pembulatan', money: true },
]

/** The product report's rows are net of line discounts: its Total is their sum (`netSales`), its discount the order's. */
const productTotals: TotalLine[] = salesTotals.map((t) =>
  t.key === 'grossSales'
    ? { key: 'netSales', label: 'Total penjualan', money: true }
    : t.key === 'discount'
      ? { key: 'orderDiscount', label: 'Diskon pesanan', money: true }
      : t,
)

export const REPORTS: Record<string, ReportDef> = {
  penjualan: {
    kind: 'sales',
    title: 'Laporan penjualan',
    hint: 'Setiap barang yang terjual, per struk.',
    columns: [
      { key: 'number', label: 'No. struk', num: true },
      { key: 'time', label: 'Waktu' },
      { key: 'cashier', label: 'Kasir' },
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
    hint: 'Penjualan per produk. Diskon dan voucher per struk serta pajak hanya ada di total.',
    columns: [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Produk' },
      { key: 'qty', label: 'Terjual', num: true },
      { key: 'sales', label: 'Penjualan', money: true },
      { key: 'cost', label: 'Modal', money: true },
      { key: 'grossProfit', label: 'Laba kotor', money: true },
    ],
    totals: productTotals,
  },
  shift: {
    kind: 'shifts',
    title: 'Laporan kasir',
    hint: 'Per shift kasir, menurut tanggal shift dibuka: penjualan dan selisih kas. Penjualan per tanggal ada di laporan penjualan.',
    columns: [
      { key: 'cashier', label: 'Kasir' },
      { key: 'openedAt', label: 'Buka' },
      { key: 'closedAt', label: 'Tutup' },
      { key: 'salesCount', label: 'Transaksi', num: true },
      { key: 'revenue', label: 'Pendapatan', money: true },
      { key: 'grossProfit', label: 'Laba kotor', money: true },
      { key: 'rounding', label: 'Pembulatan', money: true },
      { key: 'openingCash', label: 'Kas awal', money: true },
      { key: 'receivablePayments', label: 'Pembayaran piutang', money: true },
      { key: 'cashIn', label: 'Kas masuk', money: true },
      { key: 'cashOut', label: 'Kas keluar', money: true },
      { key: 'expectedCash', label: 'Kas seharusnya', money: true },
      { key: 'countedCash', label: 'Kas dihitung', money: true },
      { key: 'difference', label: 'Selisih', money: true, cashDiff: true },
    ],
    totals: [
      { key: 'shifts', label: 'Jumlah shift' },
      { key: 'salesCount', label: 'Jumlah transaksi' },
      { key: 'revenue', label: 'Pendapatan', money: true },
      { key: 'cost', label: 'Modal', money: true },
      { key: 'grossProfit', label: 'Laba kotor', money: true },
      { key: 'rounding', label: 'Pembulatan', money: true },
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

/** A drawer difference as the shift close screen words it: "Pas", "Kurang Rp500", "Lebih Rp500". */
export function cashDiff(d: number): string {
  const amount = `Rp${Math.abs(d).toLocaleString('id-ID')}`
  return d === 0 ? 'Pas' : d < 0 ? `Kurang ${amount}` : `Lebih ${amount}`
}

/** Whole-number percentage change; null when there is nothing to compare with. */
export function change(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 100)
}

const isCalendarDate = (v: string) => {
  const t = Date.parse(`${v}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v)
}

/** Mirrors pos-api's DateRange schema (same Indonesian messages) so the form answers before the request. */
export function checkRange(from: string, to: string): Record<string, string> {
  const errors: Record<string, string> = {}
  const check = (field: 'from' | 'to', label: string, v: string) => {
    if (!v) errors[field] = `${label} wajib diisi`
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[field] = `${label} harus berformat TTTT-BB-HH`
    else if (!isCalendarDate(v)) errors[field] = `${label} tidak ada di kalender`
  }
  check('from', 'Tanggal mulai', from)
  check('to', 'Tanggal akhir', to)
  if (Object.keys(errors).length === 0) {
    if (from > to) errors.to = 'Tanggal akhir tidak boleh sebelum tanggal mulai'
    else if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= 366) errors.to = 'Rentang tanggal paling lama 366 hari'
  }
  return errors
}

/** UMK-2130: the P&L warning for products sold without a cost; null when every product sold had one. */
export function costMissingText(products: number): { title: string; body: string } | null {
  if (products <= 0) return null
  return {
    title: `Modal belum diisi untuk ${products} produk`,
    body: 'Untung di atas belum lengkap karena penjualan produk tanpa modal dihitung modalnya Rp0.',
  }
}
