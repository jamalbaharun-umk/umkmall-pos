// Pure helpers of the production screens (UMK-2132, design 45): types of pos-api's answers, the form checks that
// mirror pos-api's zod rules, the payload builder, the refusal texts, the idempotency key and the figures the screens
// show. No React, no I/O. pos-api computes every quantity and cost; nothing here recomputes one.
import { check, compact, type FieldErrors } from '../../lib/form-checks'

export type PlanIngredient = {
  productId: string
  name: string
  unit: string
  needed: number
  available: number
  enough: boolean
}
export type Plan = {
  recipeId: string
  product: { id: string; name: string }
  batches: number
  yieldQty: number
  yieldUnit: string
  plannedYield: number
  ingredients: PlanIngredient[]
  deletedIngredientIds: string[]
  canProduce: boolean
}

export type RunLine = { ingredientId: string; name: string; unit: string; quantity: number; cost: number }
export type RunSummary = {
  id: string
  /** Store day, YYYY-MM-DD. */
  date: string
  recipeId: string
  productId: string
  productName: string
  batches: number
  plannedYield: number
  actualYield: number
  yieldUnit: string
  ingredientCost: number
  costPerPortion: number
  note: string | null
  createdAt: string
  yieldDifference: number
}
export type Run = RunSummary & { lines: RunLine[] }
export type RunPage = { data: RunSummary[]; page: number; perPage: number; total: number }

export type Shortage = { productId?: string; name: string; unit: string; needed: number; available: number }

// pos-api's limits (production.service.ts).
export const MAX_BATCHES = 1_000
export const MAX_YIELD = 10_000_000
export const MAX_NOTE = 500
export const PER_PAGE = 20

/** A whole-number field as typed: "1.500" and "1500" both mean 1500; anything else is NaN. */
export const whole = (v: string): number => {
  const t = v.trim()
  return /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : /^\d+$/.test(t) ? Number(t) : Number.NaN
}
/** The text the shared whole-number check accepts: the thousands dots of "1.500" dropped. */
const plain = (v: string) => (/^\d{1,3}(\.\d{3})+$/.test(v.trim()) ? v.trim().replace(/\./g, '') : v)

export type RunDraft = { recipeId: string; batches: string; actualYield: string; note: string }
export const emptyRunDraft = (): RunDraft => ({ recipeId: '', batches: '1', actualYield: '', note: '' })

/** Errors of the plan inputs only (recipe and batches), keyed like pos-api's (`recipeId`, `batches`). */
export function validatePlanInput(d: Pick<RunDraft, 'recipeId' | 'batches'>): FieldErrors {
  return compact({
    recipeId: d.recipeId ? undefined : 'Pilih resep',
    batches: check.wholeNumber(plain(d.batches), { min: 1, max: MAX_BATCHES, label: 'Jumlah batch' }),
  })
}

/** Field errors of the whole form, keyed like pos-api's. */
export function validateRun(d: RunDraft): FieldErrors {
  return compact({
    ...validatePlanInput(d),
    actualYield: check.wholeNumber(plain(d.actualYield), { min: 1, max: MAX_YIELD, label: 'Hasil sebenarnya' }),
    note: d.note.trim().length > MAX_NOTE ? `Maksimal ${MAX_NOTE} karakter` : undefined,
  })
}

/** The plan inputs as the query of `GET /production-runs/plan`, or null while they are not valid yet. */
export function planQuery(d: Pick<RunDraft, 'recipeId' | 'batches'>): { recipeId: string; batches: number } | null {
  return Object.keys(validatePlanInput(d)).length ? null : { recipeId: d.recipeId, batches: whole(d.batches) }
}

export type RunPayload = { recipeId: string; batches: number; actualYield: number; note: string | null }
/** The body of `POST /production-runs`: whole numbers only, a blank note is null. Call after validateRun. */
export function buildRunPayload(d: RunDraft): RunPayload {
  return { recipeId: d.recipeId, batches: whole(d.batches), actualYield: whole(d.actualYield), note: d.note.trim() || null }
}

/** Whether the plan on screen was made for what the form says now (an edit makes it stale until the next answer). */
export const planMatches = (plan: Plan | null, q: { recipeId: string; batches: number } | null): boolean =>
  !!plan && !!q && plan.recipeId === q.recipeId && plan.batches === q.batches

// --- Idempotency-Key (one per submit, reused on a retry of the same request) ---

export type KeyMemo = { key: string; signature: string }
const signatureOf = (p: RunPayload) => JSON.stringify([p.recipeId, p.batches, p.actualYield, p.note])
/**
 * The key to send for this payload: the remembered one when the payload is the same as the attempt it was made for
 * (a retry after a lost answer or a refusal), a new one when anything changed. pos-api answers a known key with
 * another request by 422, so a changed request must never reuse a key.
 */
export function keyFor(memo: KeyMemo | null, payload: RunPayload, make: () => string): KeyMemo {
  const signature = signatureOf(payload)
  return memo && memo.signature === signature ? memo : { key: make(), signature }
}
/** 8..100 characters of letters, digits, `_` and `-` (pos-api's IdempotencyKey). */
export const newKey = (): string => `prod-${globalThis.crypto.randomUUID()}`

// --- Texts ---

const num = (n: number) => n.toLocaleString('id-ID')
const clipName = (s: string, max = 28) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const SHOWN_SHORTAGES = 3
const MAX_TEXT = 215

/** "Telur hanya ada 14 pcs, produksi butuh 20 pcs." or a list of every short ingredient, shortened to fit the dialog. */
export function shortageText(shortages: readonly Shortage[]): string {
  if (shortages.length === 0) return 'Bahan tidak cukup.'
  if (shortages.length === 1) {
    const n = shortages[0]
    return `${clipName(n.name)} hanya ada ${num(n.available)} ${n.unit}, produksi butuh ${num(n.needed)} ${n.unit}.`
  }
  // Up to three named, fewer when the names are long: the dialog only shows text of at most 220 characters.
  for (let count = Math.min(SHOWN_SHORTAGES, shortages.length); count >= 1; count--) {
    const shown = shortages.slice(0, count).map((n) => `${clipName(n.name, 22)} (ada ${num(n.available)} ${n.unit}, butuh ${num(n.needed)} ${n.unit})`)
    const rest = shortages.length - count
    const text = `Bahan tidak cukup: ${shown.join('; ')}${rest > 0 ? `; dan ${rest} bahan lain` : ''}.`
    if (text.length <= MAX_TEXT || count === 1) return text
  }
  return 'Bahan tidak cukup.'
}

export type RunRefusal = { error: string; todo?: string; code?: string; errors?: Record<string, string>; status: number }
const GENERIC = 'Terjadi kesalahan. Coba lagi sebentar lagi.'

/**
 * What an error dialog says about a refused `POST /production-runs`: the three 422 codes of the production service get
 * their own "what to do"; anything else keeps pos-api's own text (the shared dialog filters it). A 5xx is generic.
 */
export function runRefusal(status: number, body: unknown): RunRefusal {
  const b = (body && typeof body === 'object' ? body : {}) as { message?: unknown; code?: unknown; errors?: unknown; shortages?: unknown }
  if (status >= 500 || typeof b.message !== 'string') return { error: GENERIC, status }
  const errors = b.errors && typeof b.errors === 'object' ? (b.errors as Record<string, string>) : undefined
  const code = typeof b.code === 'string' ? b.code : undefined
  const base = { status, ...(code ? { code } : {}), ...(errors ? { errors } : {}) }
  if (code === 'INSUFFICIENT_STOCK') {
    const shortages = Array.isArray(b.shortages) ? (b.shortages as Shortage[]).filter((s) => s && typeof s.name === 'string') : []
    return {
      ...base,
      error: shortages.length ? shortageText(shortages) : 'Bahan tidak cukup untuk produksi ini.',
      todo: 'Beli atau tambah stok bahan itu, atau kurangi jumlah batch.',
    }
  }
  if (code === 'INGREDIENT_DELETED')
    return { ...base, error: b.message, todo: 'Buka resepnya, ganti bahan yang sudah dihapus, lalu catat produksi lagi.' }
  if (code === 'PRODUCT_NOT_STOCKED')
    return { ...base, error: b.message, todo: 'Atur produk hasil resep ini agar memakai stok, atau pilih resep lain.' }
  return { ...base, error: b.message }
}

/** The sentence under the plan table when the run cannot be made, or null when it can (or there is no plan). */
export function planBlocker(plan: Plan | null): string | null {
  if (!plan || plan.canProduce) return null
  if (plan.deletedIngredientIds.length) return 'Ada bahan resep yang sudah dihapus dari katalog. Ganti bahan itu di resep dulu.'
  const short = plan.ingredients.filter((i) => !i.enough)
  if (short.length) return `Stok ${short.map((i) => i.name).slice(0, 3).join(', ')}${short.length > 3 ? ' dan lainnya' : ''} kurang. Beli atau tambah stok, atau kurangi jumlah batch.`
  return 'Produk hasil resep ini tidak memakai stok, jadi produksinya tidak bisa dicatat.'
}

/** How much of an ingredient is missing: 0 when there is enough. */
export const shortBy = (i: Pick<PlanIngredient, 'needed' | 'available'>) => Math.max(0, i.needed - i.available)

export const quantityText = (n: number, unit: string) => `${num(n)} ${unit}`.trim()

/** "Sesuai rencana", "Kurang 1 porsi", "Lebih 2 porsi": the actual yield against the planned one. */
export function differenceText(diff: number, unit: string): string {
  if (diff === 0) return 'Sesuai rencana'
  return `${diff < 0 ? 'Kurang' : 'Lebih'} ${num(Math.abs(diff))} ${unit}`.trim()
}
/** A signed figure for a table cell: "−1", "+2", "0". */
export const signedText = (diff: number) => (diff < 0 ? `−${num(-diff)}` : diff > 0 ? `+${num(diff)}` : '0')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
/** "26 Nov 2026" (or "26 Nov" short) from a store day; an unreadable value is returned as it is. */
export function dayText(date: string, short = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return date
  const d = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`
  return short ? d : `${d} ${m[1]}`
}

export const successText = (yieldQty: number, unit: string) => `Produksi dicatat: ${num(yieldQty)} ${unit} masuk stok`.trim()

// --- List filters ---

const DAY = /^\d{4}-\d{2}-\d{2}$/
export type ListSearch = { page?: number; from?: string; to?: string }
/** The list's filters from the address bar: anything unknown is dropped. */
export function parseListSearch(s: Record<string, unknown>): ListSearch {
  const page = Number(s.page) > 1 ? Math.floor(Number(s.page)) : undefined
  const from = typeof s.from === 'string' && DAY.test(s.from) ? s.from : undefined
  const to = typeof s.to === 'string' && DAY.test(s.to) ? s.to : undefined
  return { ...(page && { page }), ...(from && { from }), ...(to && { to }) }
}
/** The query of `GET /production-runs`. */
export function listQuery(s: ListSearch): string {
  const q = new URLSearchParams({ page: String(s.page ?? 1), perPage: String(PER_PAGE) })
  if (s.from) q.set('from', s.from)
  if (s.to) q.set('to', s.to)
  return q.toString()
}
/** An error under "Sampai tanggal" when the range is backwards, else undefined. */
export const rangeError = (from: string, to: string) => (from && to && to < from ? 'Harus sama atau setelah tanggal awal' : undefined)

// --- Charts ---

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** Planned against actual yield of the runs shown (the newest few), for a grouped bar chart on one scale. */
export function yieldBars(rows: readonly RunSummary[], max = 8) {
  const shown = rows.slice(0, max)
  return {
    categories: shown.map((r) => `${dayText(r.date, true)} · ${clip(r.productName, 16)}`),
    series: [
      { label: 'Rencana', values: shown.map((r) => r.plannedYield) },
      { label: 'Hasil nyata', values: shown.map((r) => r.actualYield) },
    ],
  }
}

export type CostShare = { label: string; value: number }
/** The parts of the cost donut: ingredient lines with a cost, largest first. */
export function costShares(lines: readonly RunLine[]): CostShare[] {
  return lines
    .filter((l) => l.cost > 0)
    .map((l) => ({ label: l.name, value: l.cost }))
    .sort((a, b) => b.value - a.value)
}
