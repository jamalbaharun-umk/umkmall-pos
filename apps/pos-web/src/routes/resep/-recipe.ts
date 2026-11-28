// Pure helpers of the recipe screens (UMK-2125, design 43): types of pos-api's answers, the payload builder,
// the checks that mirror pos-api's zod rules, and the figures the screens show. No React, no I/O.
// pos-api computes every cost; nothing here recomputes a total, it only presents what the server sent.
import { check, compact, type FieldErrors } from '../../lib/form-checks'
import { rupiah } from '../../lib/rupiah'

export type RecipeSummary = {
  id: string
  product: { id: string; name: string; type: string }
  yieldQty: number
  yieldUnit: string
  costPerPortion: number
  fullCostPerPortion: number
  missingCost: boolean
  deletedIngredient: boolean
}

export type UnitCost = { amount: number; per: number; source: 'purchase' | 'manual' }

export type RecipeLine = {
  id: string
  kind: 'ingredient' | 'sub_recipe'
  ingredientId: string | null
  subRecipeId: string | null
  name: string | null
  quantity: number
  unit: string | null
  wastePercent: number
  unitCost: UnitCost | null
  /** This line's share of one batch, in rupiah (rounded up for display only). */
  cost: number
  missingCost: boolean
  deleted: boolean
}

export type Recipe = {
  id: string
  product: { id: string; name: string; type: string; unit: string; costPrice: number; sellingPrice: number }
  yieldQty: number
  yieldUnit: string
  laborCost: number
  note: string | null
  lines: RecipeLine[]
  batchCost: number
  costPerPortion: number
  fullCostPerPortion: number
  fixedCostsIncluded: boolean
  missingCostIngredientIds: string[]
  deletedIngredientIds: string[]
  createdAt: string
  updatedAt: string
  /** UMK-2126: pos-api's suggested selling price for `targetMargin`; null while the cost is incomplete or zero. */
  suggestedPrice: SuggestedPrice | null
}

export type SuggestedPrice = {
  targetMargin: number
  price: number
  currentPrice: number
  /** Margin of the current selling price in tenths of a percent (563 is 56,3%); null without a price. */
  marginAtCurrentPermille: number | null
}

/** One row of GET /recipes/cost-alerts (UMK-2126): a recipe whose cost per portion rose since the cost price was set. */
export type CostAlert = {
  recipeId: string
  product: { id: string; name: string }
  previousCost: number
  costPerPortion: number
  /** The rise in tenths of a percent (87 is 8,7%). */
  risePermille: number
  sellingPrice: number
  marginPermille: number | null
  suggested: { targetMargin: number; price: number | null }
}
export type CostAlerts = { thresholdPercent: number; total: number; rows: CostAlert[] }

export type LinePayload = { ingredientId?: string; subRecipeId?: string; quantity: number; wastePercent: number }
export type RecipePayload = {
  yieldQty: number
  yieldUnit?: string
  laborCost: number
  note: string | null
  lines: LinePayload[]
}

/** One line of the editor form: text fields as typed, the picked ingredient or sub-recipe by id. */
export type LineDraft = {
  key: string
  kind: 'ingredient' | 'sub_recipe'
  refId: string
  quantity: string
  wastePercent: string
}
export type RecipeDraft = {
  productId: string
  yieldQty: string
  yieldUnit: string
  laborCost: string
  note: string
  lines: LineDraft[]
}

// pos-api's limits (recipes.service.ts).
export const MAX_LINES = 100
export const MAX_WASTE = 100

const toInt = (v: string) => Number(v.trim().replace(/\./g, ''))
/** Drops the thousands dots of "1.500" so the shared whole-number check accepts what the owner typed. */
const plain = (v: string) => (/^\d{1,3}(\.\d{3})+$/.test(v.trim()) ? v.trim().replace(/\./g, '') : v)
/** A whole-number field as the owner types it: "1.500" and "1500" both mean 1500. */
const whole = (v: string) => (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(v.trim()) ? toInt(v) : Number.NaN)

let seq = 0
export const newLine = (kind: LineDraft['kind'] = 'ingredient'): LineDraft => ({
  key: `l${++seq}`,
  kind,
  refId: '',
  quantity: '',
  wastePercent: '0',
})

export const emptyDraft = (): RecipeDraft => ({
  productId: '',
  yieldQty: '1',
  yieldUnit: 'porsi',
  laborCost: '0',
  note: '',
  lines: [newLine()],
})

export function draftOf(r: Recipe): RecipeDraft {
  return {
    productId: r.product.id,
    yieldQty: String(r.yieldQty),
    yieldUnit: r.yieldUnit,
    laborCost: String(r.laborCost),
    note: r.note ?? '',
    lines: r.lines.map((l) => ({
      key: l.id,
      kind: l.kind,
      refId: (l.kind === 'ingredient' ? l.ingredientId : l.subRecipeId) ?? '',
      quantity: String(l.quantity),
      wastePercent: String(l.wastePercent),
    })),
  }
}

/** Field errors keyed like pos-api's (`yieldQty`, `lines.0.quantity`), so server and client messages land on one field. */
export function validateDraft(d: RecipeDraft, { creating }: { creating: boolean }): FieldErrors {
  const errors: Record<string, string | undefined> = {
    productId: creating && !d.productId ? 'Pilih produk' : undefined,
    yieldQty: check.wholeNumber(plain(d.yieldQty), { min: 1, max: 1_000_000, label: 'Hasil' }),
    laborCost: check.wholeNumber(plain(d.laborCost), { max: 1_000_000_000_000, label: 'Upah' }),
    yieldUnit: d.yieldUnit.trim().length > 20 ? 'Maksimal 20 karakter' : undefined,
    note: d.note.trim().length > 500 ? 'Maksimal 500 karakter' : undefined,
    lines: d.lines.length === 0 ? 'Isi minimal satu bahan' : d.lines.length > MAX_LINES ? `Maksimal ${MAX_LINES} baris` : undefined,
  }
  const seen = new Set<string>()
  d.lines.forEach((l, i) => {
    errors[`lines.${i}.${l.kind === 'ingredient' ? 'ingredientId' : 'subRecipeId'}`] = !l.refId
      ? l.kind === 'ingredient'
        ? 'Pilih bahan'
        : 'Pilih sub-resep'
      : seen.has(`${l.kind}:${l.refId}`)
        ? 'Sudah ada di resep ini'
        : undefined
    seen.add(`${l.kind}:${l.refId}`)
    errors[`lines.${i}.quantity`] = check.wholeNumber(plain(l.quantity), { min: 1, max: 10_000_000, label: 'Takaran' })
    errors[`lines.${i}.wastePercent`] = check.wholeNumber(plain(l.wastePercent), { max: MAX_WASTE, label: 'Susut' })
  })
  return compact(errors)
}

/** The body for POST/PATCH /recipes: whole numbers only, blank unit left out, blank note null. Call after validateDraft. */
export function buildPayload(d: RecipeDraft): RecipePayload {
  const unit = d.yieldUnit.trim()
  return {
    yieldQty: whole(d.yieldQty),
    ...(unit ? { yieldUnit: unit } : {}),
    laborCost: whole(d.laborCost),
    note: d.note.trim() || null,
    lines: d.lines.map((l) => ({
      ...(l.kind === 'ingredient' ? { ingredientId: l.refId } : { subRecipeId: l.refId }),
      quantity: whole(l.quantity),
      wastePercent: whole(l.wastePercent),
    })),
  }
}

/** Margin of the selling price over the cost per portion, in percent with one decimal; null without a price. */
export function marginPercent(sellingPrice: number, costPerPortion: number): number | null {
  if (!(sellingPrice > 0)) return null
  return Math.round(((sellingPrice - costPerPortion) / sellingPrice) * 1000) / 10
}

export const percentText = (p: number) => `${p.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`

export type CostShare = { label: string; value: number }
/** The parts of the donut: lines with a cost, largest first. A line without a cost has no share to show. */
export function costShares(lines: readonly RecipeLine[]): CostShare[] {
  return lines
    .filter((l) => l.cost > 0)
    .map((l) => ({ label: l.name ?? 'Bahan dihapus', value: l.cost }))
    .sort((a, b) => b.value - a.value)
}

/** "Rp14 per g" or "Rp17.000 per 1.000 ml · harga manual"; "Belum ada harga" without one. */
export function unitCostText(l: Pick<RecipeLine, 'unitCost' | 'unit' | 'kind'>): string {
  if (l.kind === 'sub_recipe') return 'Dari resep'
  const c = l.unitCost
  if (!c) return 'Belum ada harga'
  const unit = l.unit ?? ''
  const per = c.per === 1 ? unit : `${c.per.toLocaleString('id-ID')} ${unit}`
  return `${rupiah(c.amount)} per ${per.trim()}${c.source === 'manual' ? ' (harga manual)' : ''}`.replace(' per  ', ' ')
}

export type RecipeFlag = 'deleted' | 'missing'
/** The warnings a recipe or a line carries, in the order the screen shows them. */
export function flagsOf(x: { deleted?: boolean; deletedIngredient?: boolean; missingCost?: boolean }): RecipeFlag[] {
  return [...(x.deleted || x.deletedIngredient ? (['deleted'] as const) : []), ...(x.missingCost ? (['missing'] as const) : [])]
}
export const FLAG_TEXT: Record<RecipeFlag, string> = {
  deleted: 'Bahan dihapus',
  missing: 'Harga bahan belum ada',
}

/** The sentence under the cost: what is blocking "Pakai harga modal", or null when nothing is. */
export function applyBlocker(r: Pick<Recipe, 'deletedIngredientIds' | 'missingCostIngredientIds' | 'product'>): string | null {
  if (r.product.type === 'ingredient') return 'Modal bahan baku diambil dari pembelian, bukan dari resep.'
  if (r.deletedIngredientIds.length) return 'Ada bahan yang sudah dihapus dari katalog. Ganti bahan itu dulu.'
  if (r.missingCostIngredientIds.length) return 'Ada bahan yang belum punya harga. Isi pembelian atau harga manual dulu.'
  return null
}

/** Body of PUT /ingredient-costs/:id. `perQty` is the pack size in base units (Rp17.000 for 1.000 ml). */
export function buildManualCost(cost: string, perQty: string): { cost: number; perQty: number } {
  return { cost: whole(cost), perQty: whole(perQty) }
}
export function validateManualCost(cost: string, perQty: string): FieldErrors {
  return compact({
    cost: check.wholeNumber(plain(cost), { max: 1_000_000_000_000, label: 'Harga' }),
    perQty: check.wholeNumber(plain(perQty), { min: 1, max: 10_000_000, label: 'Isi kemasan' }),
  })
}

export type PickerOption = { value: string; label: string; hint: string; disabled?: boolean }

/**
 * Options of the product picker. A product that already has a recipe stays visible but disabled, because pos-api
 * answers 409 for a second recipe per product. `taken` holds the product ids of the existing recipes.
 */
export function pickerOptions(rows: { id: string; name: string; sku: string }[], taken: ReadonlySet<string>): PickerOption[] {
  return rows.map((p) =>
    taken.has(p.id) ? { value: p.id, label: p.name, hint: 'Sudah punya resep', disabled: true } : { value: p.id, label: p.name, hint: p.sku },
  )
}

/** The text of the confirm before "Pakai harga modal": the new cost price per portion and the old one. */
export function applyCostConfirm(newCost: number, oldCost: number): string {
  return `Harga modal produk menjadi ${rupiah(newCost)} (sebelumnya ${rupiah(oldCost)}). Lanjutkan?`
}

// ---------- UMK-2126: cost-rise card, suggested price ----------

/** Tenths of a percent as text, integers only: 87 is "8,7%", 600 is "60%", 563 is "56,3%". */
export function permilleText(p: number): string {
  const sign = p < 0 ? '−' : ''
  const v = Math.abs(p)
  const tenth = v % 10
  return `${sign}${Math.trunc(v / 10).toLocaleString('id-ID')}${tenth ? `,${tenth}` : ''}%`
}

/** Title of one card row (design 43, screen 5): "Nasi goreng naik 8,7%". */
export const alertTitle = (a: Pick<CostAlert, 'product' | 'risePermille'>) => `${a.product.name} naik ${permilleText(a.risePermille)}`

/** The line under it: the old and the new cost, the margin now and the suggested price (never applied). */
export function alertDetail(a: Pick<CostAlert, 'previousCost' | 'costPerPortion' | 'marginPermille' | 'suggested'>): string {
  const parts = [`Dari ${rupiah(a.previousCost)} menjadi ${rupiah(a.costPerPortion)}.`]
  if (a.marginPermille !== null) parts.push(`Margin Anda kini ${permilleText(a.marginPermille)}.`)
  if (a.suggested.price !== null) parts.push(`Usulan harga (margin ${a.suggested.targetMargin}%) ${rupiah(a.suggested.price)}.`)
  return parts.join(' ')
}

export const alertsFooter = (total: number, shown: number) =>
  total > shown ? `Menampilkan ${shown} dari ${total} resep. Harga tidak berubah kecuali Anda mengubahnya.` : 'Harga tidak berubah kecuali Anda mengubahnya.'

/** Target margin of the "Harga usulan" panel: design 43 shows 60%; pos-api accepts whole percents 1..90. */
export const DEFAULT_TARGET_MARGIN = 60
export const MIN_TARGET_MARGIN = 1
export const MAX_TARGET_MARGIN = 90

/** The margin field as typed: a whole percent from 1 to 90, else the message to show under it. */
export function checkTargetMargin(v: string): { value: number } | { error: string } {
  const t = v.trim()
  if (!/^\d+$/.test(t)) return { error: 'Isi dengan angka bulat, misalnya 60' }
  const n = Number(t)
  if (n < MIN_TARGET_MARGIN || n > MAX_TARGET_MARGIN) return { error: `Target margin ${MIN_TARGET_MARGIN} sampai ${MAX_TARGET_MARGIN}%` }
  return { value: n }
}

/** How the suggested price compares with the current one; the panel words it, pos-api did the math. */
export function priceCompare(s: Pick<SuggestedPrice, 'price' | 'currentPrice'>): string {
  const diff = s.price - s.currentPrice
  if (diff === 0) return 'Sama dengan harga jual sekarang.'
  return diff > 0 ? `${rupiah(diff)} di atas harga jual sekarang.` : `${rupiah(-diff)} di bawah harga jual sekarang.`
}

/** The confirm before the suggested price becomes the selling price. */
export const priceConfirm = (price: number, current: number) => `Harga jual menjadi ${rupiah(price)} (sebelumnya ${rupiah(current)}). Lanjutkan?`
