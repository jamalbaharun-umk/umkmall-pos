// Pure helpers for the expense screens (UMK-1984). pos-api computes every total; these only label and group.

export type ExpensePeriod = 'today' | 'week' | 'month'
export type ExpenseSource = 'drawer' | 'outside'

export const PERIODS: { value: ExpensePeriod; label: string; noun: string }[] = [
  { value: 'today', label: 'Hari ini', noun: 'hari ini' },
  { value: 'week', label: 'Minggu ini', noun: 'minggu ini' },
  { value: 'month', label: 'Bulan ini', noun: 'bulan ini' },
]

/** A period from the URL: anything unknown is today. */
export const asPeriod = (v: unknown): ExpensePeriod =>
  v === 'week' || v === 'month' || v === 'today' ? v : 'today'

export const periodNoun = (p: ExpensePeriod) => PERIODS.find((x) => x.value === p)?.noun ?? 'hari ini'

export const SOURCES: { value: ExpenseSource; label: string }[] = [
  { value: 'drawer', label: 'Laci kasir' },
  { value: 'outside', label: 'Di luar laci' },
]

/** The list's wording for where the money came from. */
export const sourceLabel = (s: ExpenseSource) => (s === 'drawer' ? 'Dari laci' : 'Di luar laci')

export const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`

/** Digits only, grouped by thousands as the owner types: "45000" -> "45.000". Empty stays empty. */
export function formatAmountInput(text: string): string {
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12)
  return digits ? Number(digits).toLocaleString('id-ID') : ''
}

/** Whole rupiah from the grouped text; 0 when empty (pos-api refuses 0 with its own message). */
export const parseAmount = (text: string): number => Number(text.replace(/\D/g, '')) || 0

/** The form's own check before sending, in pos-api's words. */
export const amountError = (amount: number): string | undefined => (amount > 0 ? undefined : 'Harus lebih dari 0')

/** Does a drawer expense take more than the drawer should hold? (pos-api flags it again after saving.) */
export const exceedsDrawer = (source: ExpenseSource, amount: number, expectedCash: number | null) =>
  source === 'drawer' && expectedCash !== null && amount > expectedCash

export type DayGroup<T> = { date: string; rows: T[]; total: number }

/** Rows (already newest first) grouped by their date; `total` adds only the rows that are not voided. */
export function groupByDate<T extends { date: string; amount: number; voidedAt?: string | null }>(
  rows: readonly T[],
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const r of rows) {
    let g = groups[groups.length - 1]
    if (!g || g.date !== r.date) {
      g = { date: r.date, rows: [], total: 0 }
      groups.push(g)
    }
    g.rows.push(r)
    if (!r.voidedAt) g.total += r.amount
  }
  return groups
}

/** "Selasa, 24 Nov" for a store-local 'YYYY-MM-DD'. */
export const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`))
    .replace(/^(\p{L}+)\s/u, '$1, ')

/** "10.12" in the store's timezone (the browser's own would differ for a store in another zone). */
export const timeLabel = (iso: string, timeZone = 'Asia/Jakarta') =>
  new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
    .format(new Date(iso))
    .replace(':', '.')

/** Width of a bar in percent: the largest value fills it. */
export const barPercent = (value: number, max: number) =>
  max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0

export type EditChanges = Partial<
  Record<'category' | 'amount' | 'note' | 'date', { from: string | number | null; to: string | number | null }>
>

const FIELD_NAMES = { category: 'Kategori', amount: 'Jumlah', note: 'Catatan', date: 'Tanggal' } as const
const EMPTY = '(kosong)'

/** One line per changed field of an edit: "Jumlah: Rp10.000 menjadi Rp12.000". Category keys become labels. */
export function describeChanges(changes: EditChanges, categoryLabels: Record<string, string> = {}): string[] {
  const show = (field: keyof typeof FIELD_NAMES, v: string | number | null) => {
    if (v === null || v === '') return EMPTY
    if (field === 'amount') return rupiah(Number(v))
    if (field === 'category') return categoryLabels[String(v)] ?? String(v)
    if (field === 'date') return dayLabel(String(v))
    return String(v)
  }
  return (Object.keys(FIELD_NAMES) as (keyof typeof FIELD_NAMES)[])
    .filter((f) => changes[f])
    .map((f) => `${FIELD_NAMES[f]}: ${show(f, changes[f]!.from)} menjadi ${show(f, changes[f]!.to)}`)
}

/** The Indonesian sentence for the change of net profit against the previous period. */
export function profitChangeText(change: number, period: ExpensePeriod): string {
  const prev = { today: 'kemarin', week: 'minggu lalu', month: 'bulan lalu' }[period]
  if (change === 0) return `Sama dengan ${prev} pada waktu yang sama`
  return `${change > 0 ? 'Naik' : 'Turun'} ${rupiah(Math.abs(change))} dari ${prev} pada waktu yang sama`
}
