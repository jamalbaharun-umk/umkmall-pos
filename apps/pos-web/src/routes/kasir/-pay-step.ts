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

/** The success toast of a finished sale: a kasbon with nothing paid is not a payment, so it must not say "Pembayaran berhasil". */
export function saleToast(paid: number, receivableRest: number | null | undefined, fmt: (n: number) => string): string {
  const rest = receivableRest ?? 0
  if (rest <= 0) return 'Pembayaran berhasil'
  return paid > 0 ? `Pembayaran ${fmt(paid)} diterima. Sisa kasbon ${fmt(rest)}` : `Kasbon ${fmt(rest)} dicatat`
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

// ---- UMK-2037: the bank of a virtual account is chosen before the VA is made ----

export type Bank = { code: string; name: string }
/** `GET /online-payments/methods`: the methods the store may charge now, and by method the banks to choose from. */
export type OnlineMethods = { methods: string[]; banks: Record<string, Bank[]> }

const BANK_CODE = /^[A-Za-z0-9_-]{1,30}$/

/** Reads that answer, copying only what is known: a method without banks needs none, a malformed bank is left out. */
export function parseOnlineMethods(raw: unknown): OnlineMethods {
  const o = raw && typeof raw === 'object' ? (raw as { methods?: unknown; banks?: unknown }) : {}
  const methods = Array.isArray(o.methods) ? o.methods.filter((m): m is string => typeof m === 'string') : []
  const banks: Record<string, Bank[]> = {}
  if (o.banks && typeof o.banks === 'object')
    for (const [method, list] of Object.entries(o.banks as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const ok = list.flatMap((b): Bank[] => {
        const x = b as { code?: unknown; name?: unknown } | null
        return x && typeof x.code === 'string' && BANK_CODE.test(x.code) && typeof x.name === 'string' && x.name
          ? [{ code: x.code, name: x.name }]
          : []
      })
      if (ok.length > 0) banks[method] = ok
    }
  return { methods, banks }
}

/** The banks the cashier chooses from for a gateway method; empty when it needs none. */
export const banksFor = (banks: Record<string, Bank[]>, gatewayMethod: string | null | undefined): Bank[] =>
  (gatewayMethod ? banks[gatewayMethod] : undefined) ?? []

/** The bank to send: the chosen one if it is one of the method's banks, else none (a method without banks sends none). */
export function bankToSend(list: Bank[], chosen: string): string | null {
  return list.some((b) => b.code === chosen) ? chosen : null
}

/** Why the sale cannot be sent yet (undefined when it can): a VA needs a bank first. */
export const bankError = (list: Bank[], chosen: string): string | undefined =>
  list.length > 0 && bankToSend(list, chosen) === null ? 'Pilih bank dulu sebelum membuat nomor VA' : undefined

/**
 * What a 422 on `bank` says to the cashier, by payment-api's code when the sale was already written and cancelled
 * (`bank_required`, `bank_unknown`, `bank_not_supported`); the same advice for a refusal before the write, which has
 * no code. Always ends with what to do: choose a bank again.
 */
export function bankRefusalText(code: string | undefined): string {
  switch (code) {
    case 'bank_required':
      return 'Bank belum dipilih. Penjualan dibatalkan, stok kembali. Pilih bank, lalu buat nomor VA.'
    case 'bank_unknown':
      return 'Bank itu tidak dikenal gateway. Penjualan dibatalkan, stok kembali. Pilih bank lain, lalu buat nomor VA.'
    case 'bank_not_supported':
      return 'Metode ini tidak memakai bank. Penjualan dibatalkan, stok kembali. Pilih metode lagi, lalu bayar.'
    default:
      return 'Bank ini tidak bisa dipakai untuk metode ini. Pilih bank lagi lalu buat nomor VA.'
  }
}
