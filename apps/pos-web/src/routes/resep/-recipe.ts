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
}

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
