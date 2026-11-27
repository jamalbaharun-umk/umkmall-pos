// UMK-1987 (WhatsApp receipt) and UMK-1973 (kasbon reminder). Pure logic, no React and no I/O: a phone number made
// into the 62... form WhatsApp wants, the two messages, and the wa.me link. The POS never sends anything (no WhatsApp
// API): it opens a message that is ready, and the person presses send in WhatsApp. Nothing here logs or stores a
// number, a name or a message.

export type Phone = { ok: true; digits: string; display: string } | { ok: false }

/** Indonesian mobile numbers (62 8xx...) have 9 to 12 digits after the country code. */
const NATIONAL = /^8\d{8,11}$/

/**
 * Whatever a person types ("0812 3456 7890", "+62 812-3456-7890", "62812...", "0062 812...", "(0812) 3456 7890") into
 * `62` + the national number, plus a spaced form for "Akan dibuka sebagai +62 812 3456 7890". Anything that is not a
 * complete Indonesian mobile number, or not a plausible international one written with + or 00, is `{ ok: false }`.
 */
export function normalizePhone(raw: string): Phone {
  const t = raw.trim()
  if (!t || /[^\d\s+().-]/.test(t)) return { ok: false }
  // A + is only allowed first.
  if (t.lastIndexOf('+') > 0) return { ok: false }
  const plus = t.startsWith('+')
  let d = t.replace(/\D/g, '')
  if (!d) return { ok: false }
  if (d.startsWith('00')) d = d.slice(2)
  else if (!plus && d.startsWith('0')) d = `62${d.slice(1)}`
  else if (!plus && d.startsWith('8')) d = `62${d}`
  if (d.startsWith('62')) {
    // "+62 0812...": people keep the trunk 0 after the country code.
    const national = d.slice(2).replace(/^0/, '')
    return NATIONAL.test(national) ? { ok: true, digits: `62${national}`, display: `+62 ${groups(national)}` } : { ok: false }
  }
  // Another country, only when written as +... or 00...: WhatsApp's own limit is 15 digits.
  const international = plus || /^\s*00/.test(t)
  if (!international || d.length < 8 || d.length > 15 || d.startsWith('0')) return { ok: false }
  return { ok: true, digits: d, display: `+${d}` }
}

/** "8123456789" → "812 3456 789": the first three digits, then groups of four. */
function groups(national: string): string {
  const rest = national.slice(3).match(/.{1,4}/g) ?? []
  return [national.slice(0, 3), ...rest].join(' ')
}

/** The wa.me link: the number in 62... form and the message, encoded. */
export const whatsappLink = (digits: string, message: string) =>
  `https://wa.me/${digits}?text=${encodeURIComponent(message)}`

const idr = (n: number) => `Rp${n.toLocaleString('id-ID')}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "26 Nov 2026" from an instant, in a timezone (the store's day); the month names are our own, not the runtime's. */
export function shortDate(iso: string, timeZone = 'Asia/Jakarta'): string {
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).formatToParts(
    new Date(iso),
  )
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1] ?? ''} ${get('year')}`
}

/** "14 Nov" (this year) or "14 Nov 2025" from a calendar date `YYYY-MM-DD`; `year` is the year that is left out. */
export function dayMonth(date: string, year: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[m - 1] ?? ''}${y === year ? '' : ` ${y}`}`
}

export type ReceiptSource = {
  number: number
  paymentMethod: string
  lines: { name: string; qty: number; unit?: string; unitQty?: number; unitPrice: number; discount?: number }[]
  subtotal: number
  /** Every manual discount (lines and order) and the voucher's, as the receipt carries them. */
  discount: number
  lineDiscount?: number
  voucherDiscount: number
  tax: number
  taxBps: number
  total: number
  rounding: number
  /** What the customer owes now: the server's `total + rounding`. Never recomputed here. */
  amountDue: number
  receivableRest: number | null
}

/**
 * The receipt message (design 33). Every figure is the server's receipt, none is recomputed here; a discount, tax,
 * rounding or kasbon balance is a line of its own only when there is one, so a plain sale reads exactly like the
 * design. The date is the day the sale counted (`paidAt`, else its creation).
 */
export function receiptMessage(r: ReceiptSource, storeName: string, at: string, timeZone?: string): string {
  const out = [`Terima kasih sudah belanja di ${storeName}.`, `Struk #${r.number} · ${shortDate(at, timeZone)}`]
  for (const l of r.lines) {
    // The unit is named only for a larger pack (a dus, not the base "pcs"), like the design's plain lines.
    out.push(`${l.name} ${l.qty}${l.unit && (l.unitQty ?? 1) > 1 ? ` ${l.unit}` : ''} × ${idr(l.unitPrice)}`)
    if (l.discount) out.push(`  Diskon ${idr(l.discount)}`)
  }
  const orderDiscount = r.discount - (r.lineDiscount ?? 0)
  if (orderDiscount > 0) out.push(`Diskon ${idr(orderDiscount)}`)
  if (r.voucherDiscount > 0) out.push(`Voucher ${idr(r.voucherDiscount)}`)
  if (r.tax > 0) out.push(`Pajak ${r.taxBps / 100}% ${idr(r.tax)}`)
  const method = r.paymentMethod.toLowerCase()
  if (r.rounding === 0) out.push(`Total ${idr(r.total)} (${method})`)
  else {
    // Cash rounding: the customer paid the rounded amount, so that line carries the method (the printed receipt's
    // "Harus dibayar").
    out.push(`Total ${idr(r.total)}`)
    out.push(`Pembulatan ${r.rounding < 0 ? '−' : ''}${idr(Math.abs(r.rounding))}`)
    out.push(`Harus dibayar ${idr(r.amountDue)} (${method})`)
  }
  if (r.receivableRest) out.push(`Sisa kasbon ${idr(r.receivableRest)}`)
  out.push('Sampai jumpa lagi!')
  return out.join('\n')
}

export type ReminderSource = {
  memberName: string
  rest: number
  /** `YYYY-MM-DD`, the oldest open due date. */
  dueDate: string
  overdueDays: number
}

/**
 * The kasbon reminder (design 34): the polite message for a balance past due, and a softer one for a balance
 * that is not due yet. `year` is the store's current year, which a date drops.
 */
export function reminderMessage(r: ReminderSource, storeName: string, year: number): string {
  const due = dayMonth(r.dueDate, year)
  const head = `Halo ${r.memberName}, kami dari ${storeName}.`
  return r.overdueDays > 0
    ? `${head} Mengingatkan kasbon ${idr(r.rest)} yang jatuh tempo ${due}. Terima kasih, mohon konfirmasi bila sudah dibayar.`
    : `${head} Mengingatkan jatuh tempo kasbon ${idr(r.rest)} pada ${due}. Terima kasih.`
}

/** The "Bu Rina terakhir diingatkan 2 hari lalu. Tetap kirim?" question, only when it was under three days ago. */
export const REMIND_AGAIN_DAYS = 3
export function remindedAgainNote(name: string, daysAgo: number | null): string | null {
  if (daysAgo === null || daysAgo >= REMIND_AGAIN_DAYS) return null
  return `${name} terakhir diingatkan ${daysAgo === 0 ? 'hari ini' : `${daysAgo} hari lalu`}. Tetap kirim?`
}
