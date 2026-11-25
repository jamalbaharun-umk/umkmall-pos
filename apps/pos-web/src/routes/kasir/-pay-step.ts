// What the cashier's payment step asks for, per payment method kind (design 5, "Metode & QRIS toko").
// Pure on purpose: the dialog only renders what this says.

export type PayMethodKind = 'cash' | 'debit' | 'credit' | 'wallet' | 'online'

/**
 * - `cash`: amount received, change and the Rp100 rounding line.
 * - `kasbon`: optional down payment, the rest becomes a receivable.
 * - `confirm`: the exact total is paid outside the till (EDC, the store's static QRIS); the cashier confirms receipt.
 * - `online` (UMK-1991): dynamic QRIS or VA through the payment gateway; the exact total, then a waiting screen.
 */
export type PayStep = 'cash' | 'kasbon' | 'confirm' | 'online'

export function payStepOf(kind: PayMethodKind | undefined): PayStep {
  if (kind === 'credit') return 'kasbon'
  if (kind === 'online') return 'online'
  if (kind === 'wallet' || kind === 'debit') return 'confirm'
  return 'cash'
}

/** Only the wallet kind is the store's static QRIS: it gets the scan instruction and the no-bank-check warning. */
export const isStaticQris = (kind: PayMethodKind | undefined) => kind === 'wallet'

export const qrisScanHint = (amountText: string) =>
  `Pelanggan scan lalu mengetik ${amountText}. Cocokkan jumlah di HP toko sebelum menekan tombol.`

export const QRIS_NO_BANK_CHECK = 'Tombol ini tidak memeriksa ke bank. Tekan hanya setelah uang benar-benar masuk.'

export const confirmButtonLabel = (kind: PayMethodKind | undefined, gatewayMethod?: string | null) =>
  isStaticQris(kind)
    ? 'Sudah diterima'
    : kind === 'online'
      ? gatewayMethod === 'fake_va'
        ? 'Buat nomor VA'
        : 'Tampilkan kode QR'
      : 'Bayar'

/**
 * The methods the pay dialog offers: an online method only while the store may charge its gateway method now
 * (`GET /online-payments/methods`); `hidden` counts the ones left out, so the dialog can say why.
 */
export function offeredMethods<M extends { kind: PayMethodKind; gatewayMethod?: string | null }>(
  methods: M[],
  chargeable: string[],
): { offered: M[]; hidden: number } {
  const offered = methods.filter((m) => m.kind !== 'online' || (!!m.gatewayMethod && chargeable.includes(m.gatewayMethod)))
  return { offered, hidden: methods.length - offered.length }
}

/** UMK-1992: the store's uploaded QRIS image; the version changes after a replace so the cache is not reused. */
export const qrisSrc = (version: string | number) => `/pengaturan/qris?v=${encodeURIComponent(String(version))}`

export const QRIS_LOAD_ERROR = 'Kode QRIS tidak bisa dimuat. Coba lagi atau pilih cara bayar lain.'
