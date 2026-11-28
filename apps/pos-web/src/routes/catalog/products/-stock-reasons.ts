// Labels of the stock history of a product (`stock_movements.reason`), in Indonesian. A reason pos-api adds later
// shows as its raw key until it is added here.
export const REASON: Record<string, string> = {
  opening: 'Stok awal',
  sale: 'Penjualan',
  sale_void: 'Penjualan dibatalkan',
  purchase: 'Pembelian',
  opname: 'Stok opname',
  purchase_return: 'Retur ke pemasok',
  purchase_return_reversal: 'Retur ke pemasok dibatalkan',
  // UMK-2132: the finished product of a production run, and the ingredients it used.
  production: 'Hasil produksi',
  production_use: 'Dipakai produksi',
}
