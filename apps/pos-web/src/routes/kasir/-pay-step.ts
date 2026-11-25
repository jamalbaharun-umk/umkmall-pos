// What the cashier's payment step asks for, per payment method kind (design 5, "Metode & QRIS toko").
// Pure on purpose: the dialog only renders what this says.

export type PayMethodKind = 'cash' | 'debit' | 'credit' | 'wallet'

/**
 * - `cash`: amount received, change and the Rp100 rounding line.
 * - `kasbon`: optional down payment, the rest becomes a receivable.
 * - `confirm`: the exact total is paid outside the till (EDC, the store's static QRIS); the cashier confirms receipt.
 */
export type PayStep = 'cash' | 'kasbon' | 'confirm'

export function payStepOf(kind: PayMethodKind | undefined): PayStep {
  if (kind === 'credit') return 'kasbon'
  if (kind === 'wallet' || kind === 'debit') return 'confirm'
  return 'cash'
}

/** Only the wallet kind is the store's static QRIS: it gets the scan instruction and the no-bank-check warning. */
export const isStaticQris = (kind: PayMethodKind | undefined) => kind === 'wallet'

export const qrisScanHint = (amountText: string) =>
  `Pelanggan scan lalu mengetik ${amountText}. Cocokkan jumlah di HP toko sebelum menekan tombol.`

export const QRIS_NO_BANK_CHECK = 'Tombol ini tidak memeriksa ke bank. Tekan hanya setelah uang benar-benar masuk.'

export const confirmButtonLabel = (kind: PayMethodKind | undefined) => (isStaticQris(kind) ? 'Sudah diterima' : 'Bayar')
