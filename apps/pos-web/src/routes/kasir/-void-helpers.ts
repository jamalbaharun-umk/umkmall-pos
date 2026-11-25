import type { FailureLike } from '@/lib/describe-error'

// Pure logic of the void ("Batalkan transaksi", UMK-1962) dialog and the void PIN screen. No I/O, no PIN storage:
// the PIN only ever lives in a component's state until the request is sent.

export const VOID_REASONS = [
  { code: 'wrong_item_or_qty', label: 'Salah input barang atau jumlah' },
  { code: 'wrong_payment_method', label: 'Salah metode pembayaran' },
  { code: 'customer_cancelled', label: 'Pelanggan batal membeli' },
  { code: 'duplicate_transaction', label: 'Transaksi tercatat dobel' },
  { code: 'goods_returned', label: 'Barang dikembalikan pelanggan' },
  { code: 'other', label: 'Lainnya (tulis catatan)' },
] as const
export type VoidReasonCode = (typeof VOID_REASONS)[number]['code']

export const NOTE_MAX = 200
export const PIN_LENGTH = 6

export const reasonLabel = (code: string) => VOID_REASONS.find((r) => r.code === code)?.label ?? code

/** Digits only, at most six: what a PIN field keeps of whatever was typed or pasted. */
export const pinDigits = (text: string) => text.replace(/\D/g, '').slice(0, PIN_LENGTH)

export type VoidForm = { reasonCode: string; note: string; approverId: string; pin: string }
export type VoidFormErrors = Partial<Record<'reasonCode' | 'note' | 'approverId' | 'pin', string>>

/** The checks pos-api repeats (zod), so a bad form never costs a round trip or a PIN attempt. */
export function voidFormErrors(f: VoidForm): VoidFormErrors {
  const e: VoidFormErrors = {}
  if (!VOID_REASONS.some((r) => r.code === f.reasonCode)) e.reasonCode = 'Pilih alasan pembatalan'
  if (f.reasonCode === 'other' && !f.note.trim()) e.note = 'Tulis alasan pembatalan'
  if (f.note.trim().length > NOTE_MAX) e.note = `Catatan maksimal ${NOTE_MAX} karakter`
  if (!f.approverId) e.approverId = 'Pilih admin yang menyetujui'
  if (!/^[0-9]{6}$/.test(f.pin)) e.pin = 'PIN harus 6 angka'
  return e
}

/** The request body; the note is sent only when there is one. */
export function voidBody(f: VoidForm) {
  const note = f.note.trim()
  return { reasonCode: f.reasonCode, approverId: f.approverId, pin: f.pin, ...(note ? { note } : {}) }
}

export type Approver = {
  id: string
  kind: 'owner' | 'cashier'
  name: string
  hasPin: boolean
  lockedUntil: string | null
}

/** Why an approver cannot be picked right now, or null. */
export function approverBlock(a: Approver, now = Date.now()): string | null {
  if (!a.hasPin) return 'Belum membuat PIN'
  if (a.lockedUntil && new Date(a.lockedUntil).getTime() > now) {
    const minutes = Math.max(1, Math.ceil((new Date(a.lockedUntil).getTime() - now) / 60000))
    return `Terkunci, coba lagi ${minutes} menit lagi`
  }
  return null
}

export const approverOptions = (list: Approver[], now = Date.now()) =>
  list.map((a) => {
    const block = approverBlock(a, now)
    return {
      value: a.id,
      label: a.kind === 'owner' ? 'Pemilik' : a.name,
      disabled: block !== null,
      hint: block ?? undefined,
    }
  })

export type MethodKind = 'cash' | 'debit' | 'credit' | 'wallet' | 'online'

/**
 * What the store does with the customer's money, from the payment method of the sale (the design's "uang kembali"
 * guidance): cash comes out of the open shift's drawer; debit/EDC, transfer and QRIS go back by transfer and need
 * no shift; kasbon cancels the rest and returns what was paid. An unknown kind gets the neutral wording.
 */
export function refundGuidance(kind: MethodKind | null, total: number, rupiah: (n: number) => string) {
  switch (kind) {
    case 'cash':
      return {
        needsShift: true,
        text: `Uang ${rupiah(total)} dikembalikan ke pelanggan dari laci, dan keluar dari kas shift Anda yang sedang buka. Buka shift dulu bila belum.`,
      }
    case 'debit':
    case 'wallet':
      return {
        needsShift: false,
        text: `Struk transfer, QRIS atau EDC dikembalikan lewat transfer balik sebesar ${rupiah(total)}. Laci tidak berubah dan tidak perlu shift buka. Lakukan transfer baliknya sendiri.`,
      }
    case 'online':
      return {
        needsShift: false,
        text: `Refund ${rupiah(total)} ke pelanggan lewat gateway. Pembayaran non-tunai tidak mengeluarkan uang dari laci; kas shift tidak berubah.`,
      }
    case 'credit':
      return {
        needsShift: false,
        text: 'Sisa kasbon dihapus. Cicilan yang sudah masuk dicatat dikembalikan ke pelanggan: tunai dari laci shift yang sedang buka, selain tunai lewat transfer balik. Kasbon yang belum dibayar tidak mengembalikan uang.',
      }
    default:
      return {
        needsShift: false,
        text: 'Uang yang sudah dibayar dikembalikan sesuai cara bayarnya: tunai dari laci shift yang sedang buka, selain tunai lewat transfer balik.',
      }
  }
}

export type VoidFailure = {
  error: string
  errors: Record<string, string>
  /** 429: seconds until the approver can be tried again. */
  retryAfter?: number
  /** locked (429), forbidden (403), done (409), gone (404), invalid (422), offline (no answer), other. */
  kind: 'locked' | 'forbidden' | 'done' | 'gone' | 'invalid' | 'offline' | 'other'
}

const GENERIC = 'Terjadi kesalahan. Coba lagi sebentar lagi.'

/**
 * Turns pos-api's answer to a refused void into what the dialog shows. Bodies are `{ message, errors?, retryAfter? }`
 * with Indonesian, internals-free text; 5xx and unreadable bodies become a generic message. Status 0 is no answer.
 */
export function voidFailure(status: number, body: unknown): VoidFailure {
  const b = (body && typeof body === 'object' ? body : {}) as { message?: unknown; errors?: unknown; retryAfter?: unknown }
  const message = typeof b.message === 'string' ? b.message : undefined
  const errors: Record<string, string> =
    b.errors && typeof b.errors === 'object'
      ? Object.fromEntries(Object.entries(b.errors).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))
      : {}
  if (status === 0) return { kind: 'offline', error: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.', errors }
  if (status === 403)
    return {
      kind: 'forbidden',
      error: 'Anda tidak punya izin untuk membuat penjualan, jadi tidak bisa memulai pembatalan.',
      errors,
    }
  if (status === 404) return { kind: 'gone', error: 'Struk tidak ditemukan.', errors }
  if (status === 429)
    return {
      kind: 'locked',
      error: message ?? 'Terlalu banyak PIN salah. Coba lagi beberapa menit lagi.',
      errors,
      retryAfter: typeof b.retryAfter === 'number' ? b.retryAfter : undefined,
    }
  if (status === 409) return { kind: 'done', error: message ?? 'Struk ini sudah dibatalkan', errors }
  if (status === 422 && message) return { kind: 'invalid', error: message, errors }
  return { kind: 'other', error: GENERIC, errors }
}

/** The failure as the shared error dialog reads it (status, safe text, wait): what `showError` takes. */
export function failureOf(f: VoidFailure): FailureLike {
  if (isWrongPin(f)) return { code: 'PIN_INVALID' }
  switch (f.kind) {
    case 'offline':
      return { status: 0 }
    case 'forbidden':
      return { status: 403 }
    case 'gone':
      return { status: 404 }
    case 'locked':
      return { status: 429, retryAfter: f.retryAfter }
    case 'done':
      return { status: 409, error: f.error }
    case 'invalid':
      return { status: 422, error: f.error }
    default:
      return { status: 500 }
  }
}

/** A wrong PIN is a 422 with `errors.pin`; the dialog shows it on the field and clears the PIN. */
export const isWrongPin = (f: VoidFailure) => f.kind === 'invalid' && f.errors.pin === 'PIN salah'

export type PinSetForm = { pin: string; confirm: string; currentPin: string }

/** Checks of the set/change PIN form. `hasPin` means a change, which needs the current PIN. */
export function pinSetErrors(f: PinSetForm, hasPin: boolean): Partial<Record<keyof PinSetForm, string>> {
  const e: Partial<Record<keyof PinSetForm, string>> = {}
  if (hasPin && !/^[0-9]{6}$/.test(f.currentPin)) e.currentPin = 'Masukkan PIN lama (6 angka)'
  if (!/^[0-9]{6}$/.test(f.pin)) e.pin = 'PIN harus 6 angka'
  else if (/^(\d)\1{5}$/.test(f.pin) || f.pin === '123456' || f.pin === '654321')
    e.pin = 'PIN terlalu mudah ditebak. Hindari angka berulang dan urutan.'
  if (!e.pin && f.confirm !== f.pin) e.confirm = 'Ulangi PIN harus sama'
  return e
}

export const lockText = (lockedUntil: string | null, now = Date.now()) => {
  if (!lockedUntil) return null
  const ms = new Date(lockedUntil).getTime() - now
  return ms > 0 ? `Terkunci ${Math.max(1, Math.ceil(ms / 60000))} menit lagi` : null
}

// ---- UMK-1991: the refund of a paid QRIS or VA sale (same record as a void, `refundStatus` says where the money is) ----

export type RefundState = 'pending' | 'succeeded' | 'failed'

export function refundStateText(
  status: RefundState | null | undefined,
  amountText = 'dana',
): { label: string; color: 'warning' | 'success' | 'danger'; body: string } | null {
  switch (status) {
    case 'pending':
      return {
        label: 'Refund diproses',
        color: 'warning',
        body: 'Gateway menerima permintaan refund; dana belum kembali ke pelanggan. Penjualan sudah dibatalkan dan stok sudah kembali. Status diperbarui otomatis saat gateway memastikan. Menekan Refund lagi hanya menampilkan refund yang sama.',
      }
    case 'succeeded':
      return { label: 'Refund selesai', color: 'success', body: `Gateway memastikan ${amountText} kembali ke pelanggan.` }
    case 'failed':
      return {
        label: 'Refund gagal',
        color: 'danger',
        body: 'Gateway menolak refund. Uang pelanggan belum kembali. Pemilik bisa mencoba lagi, atau menandainya dikembalikan manual bila uang sudah dikembalikan di luar gateway.',
      }
    default:
      return null
  }
}

export const MANUAL_NOTE_MAX = 200

/** The owner's "dikembalikan manual" note: how the money went back (required, at most 200 characters). */
export function manualNoteError(note: string): string | undefined {
  const t = note.trim()
  if (!t) return 'Tulis cara uang dikembalikan, misalnya transfer ke rekening pelanggan'
  if (t.length > MANUAL_NOTE_MAX) return `Catatan maksimal ${MANUAL_NOTE_MAX} karakter`
  return undefined
}
