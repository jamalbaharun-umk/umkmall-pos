// UMK-2124 "Serahkan ke pembantu" (design 42): pure rules of the handover dialogs and the helper's sales-only till,
// unit-tested without React. Imports stay relative (vitest has no `@/` alias here).
import { cashRounding, parseRupiah } from './-money'

export const HANDOVER_TOAST = 'Kasir diserahkan ke pembantu'
export const RETURN_TOAST = 'Sesi pemilik dibuka lagi'
export const CLOSED_TOAST = 'Mode pembantu diakhiri'

/** The restricted till's header: "Mode pembantu · Dina", or just "Mode pembantu" without a name. */
export function helperTitle(name: string | null | undefined): string {
  const n = name?.trim()
  return n ? `Mode pembantu · ${n}` : 'Mode pembantu'
}

/** When the handover ends by itself (12 hours), as the till says it ("berakhir 21.30"); '' when unknown. */
export function endsAtText(expiresAt: string | null | undefined, timeZone?: string): string {
  const d = expiresAt ? new Date(expiresAt) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', ...(timeZone && { timeZone }) })
}

/** A helper sells for cash, debit or the store's static QRIS only (no kasbon, no online payment). */
const HELPER_KINDS = new Set(['cash', 'debit', 'wallet'])
export function helperMethods<M extends { kind: string }>(methods: M[]): M[] {
  return methods.filter((m) => HELPER_KINDS.has(m.kind))
}

/** The owner PIN field: 6 digits. */
export function pinInputError(pin: string): string | undefined {
  if (!pin) return 'Masukkan PIN pemilik'
  if (!/^[0-9]{6}$/.test(pin)) return 'PIN harus 6 angka'
  return undefined
}

/** The optional helper name: at most 40 letters (pos-api's rule). */
export function nameError(name: string): string | undefined {
  return name.trim().length > 40 ? 'Nama paling banyak 40 huruf' : undefined
}

/**
 * What the helper's sale sends as `paid`: cash is what the customer handed over (at least the total rounded up to
 * the next Rp100, UMK-1993); debit and the store's QRIS pay the exact total.
 */
export function helperPaid(kind: string | undefined, total: number, paidText: string): { amount: number } | { error: string } {
  if (kind !== 'cash') return { amount: total }
  if (!paidText.trim()) return { error: 'Wajib diisi: masukkan uang diterima' }
  const amount = parseRupiah(paidText)
  if (Number.isNaN(amount)) return { error: 'Harus bilangan bulat rupiah, misalnya 50.000' }
  if (amount < total + cashRounding(total)) return { error: 'Uang dibayar kurang dari jumlah yang harus dibayar' }
  return { amount }
}

type PinRefusal = { status?: number; code?: string; error?: string; errors?: Record<string, string>; retryAfter?: number }

/**
 * A refused owner PIN for the shared error dialog, in the owner's words (design 42: "PIN pemilik salah", 5 wrong
 * lock 5 minutes). Anything that is not about the PIN is passed on as it came.
 */
export function pinFailure(r: PinRefusal): PinRefusal & { todo?: string } {
  if (r.status === 429)
    return {
      status: 429,
      code: r.code,
      retryAfter: r.retryAfter,
      error: 'PIN pemilik dikunci karena 5 kali salah.',
    }
  if (r.status === 422 && r.code !== 'owner_pin_missing' && r.errors?.pin)
    return {
      status: 422,
      error: 'PIN pemilik salah.',
      todo: 'Periksa PIN lalu coba lagi. Salah 5 kali mengunci PIN 5 menit.',
    }
  return r
}
