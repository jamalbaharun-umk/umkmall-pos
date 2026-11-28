import { describe, expect, it } from 'vitest'
import {
  applyBlocker,
  alertDetail,
  alertsFooter,
  alertTitle,
  applyCostConfirm,
  checkTargetMargin,
  permilleText,
  priceCompare,
  priceConfirm,
  pickerOptions,
  buildManualCost,
  buildPayload,
  costShares,
  draftOf,
  emptyDraft,
  flagsOf,
  marginPercent,
  newLine,
  percentText,
  type Recipe,
  type RecipeLine,
  unitCostText,
  validateDraft,
  validateManualCost,
} from './-recipe'

const line = (over: Partial<RecipeLine> = {}): RecipeLine => ({
  id: 'l1',
  kind: 'ingredient',
  ingredientId: 'i1',
  subRecipeId: null,
  name: 'Beras',
  quantity: 1500,
  unit: 'g',
  wastePercent: 5,
  unitCost: { amount: 14, per: 1, source: 'purchase' },
  cost: 21000,
  missingCost: false,
  deleted: false,
  ...over,
})
const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: 'r1',
  product: { id: 'p1', name: 'Nasi goreng', type: 'product', unit: 'porsi', costPrice: 0, sellingPrice: 18000 },
  yieldQty: 10,
  yieldUnit: 'porsi',
  laborCost: 50000,
  note: null,
  lines: [line()],
  batchCost: 72320,
  costPerPortion: 7232,
  fullCostPerPortion: 12232,
  fixedCostsIncluded: false,
  missingCostIngredientIds: [],
  deletedIngredientIds: [],
  createdAt: '',
  updatedAt: '',
  suggestedPrice: null,
  ...over,
})
const filled = () => ({
  ...emptyDraft(),
  productId: 'p1',
  lines: [{ ...newLine(), refId: 'i1', quantity: '1.500', wastePercent: '5' }],
})

describe('marginPercent', () => {
  it('matches the design example (Rp18.000 over Rp7.232 is 59,8%)', () => {
    expect(marginPercent(18000, 7232)).toBe(59.8)
    expect(percentText(59.8)).toBe('59,8%')
  })
  it('is null without a selling price and negative when cost is above it', () => {
    expect(marginPercent(0, 100)).toBeNull()
    expect(marginPercent(1000, 1500)).toBe(-50)
    expect(percentText(60)).toBe('60%')
  })
})

describe('costShares', () => {
  it('orders by cost, drops zero-cost lines and names a deleted ingredient', () => {
    const shares = costShares([
      line({ name: 'Kecap', cost: 5000 }),
      line({ name: 'Telur', cost: 22000 }),
      line({ name: 'Garam', cost: 0, missingCost: true }),
      line({ name: null, cost: 100 }),
    ])
    expect(shares).toEqual([
      { label: 'Telur', value: 22000 },
      { label: 'Kecap', value: 5000 },
      { label: 'Bahan dihapus', value: 100 },
    ])
  })
})

describe('buildPayload', () => {
  it('sends whole numbers, ingredient or sub-recipe, a null note and no blank unit', () => {
    const d = filled()
    d.yieldUnit = '  '
    d.lines.push({ ...newLine('sub_recipe'), refId: 'r2', quantity: '2', wastePercent: '0' })
    expect(buildPayload(d)).toEqual({
      yieldQty: 1,
      laborCost: 0,
      note: null,
      lines: [
        { ingredientId: 'i1', quantity: 1500, wastePercent: 5 },
        { subRecipeId: 'r2', quantity: 2, wastePercent: 0 },
      ],
    })
  })
  it('round-trips a server recipe through the draft', () => {
    const p = buildPayload(draftOf(recipe({ note: ' enak ' })))
    expect(p).toMatchObject({ yieldQty: 10, yieldUnit: 'porsi', laborCost: 50000, note: 'enak' })
    expect(p.lines).toEqual([{ ingredientId: 'i1', quantity: 1500, wastePercent: 5 }])
  })
})

describe('validateDraft', () => {
  it('accepts a complete draft, grouped thousands included', () => {
    expect(validateDraft(filled(), { creating: true })).toEqual({})
  })
  it('flags what pos-api would refuse, on the same keys', () => {
    const d = filled()
    d.productId = ''
    d.yieldQty = '0'
    d.laborCost = '1,5'
    d.lines = [
      { ...newLine(), refId: '', quantity: '0', wastePercent: '101' },
      { ...newLine(), refId: 'i1', quantity: '2', wastePercent: '0' },
      { ...newLine(), refId: 'i1', quantity: '2', wastePercent: '0' },
    ]
    const e = validateDraft(d, { creating: true })
    expect(e.productId).toBe('Pilih produk')
    expect(e.yieldQty).toBe('Hasil harus lebih dari 0')
    expect(e.laborCost).toBe('Upah harus bilangan bulat')
    expect(e['lines.0.ingredientId']).toBe('Pilih bahan')
    expect(e['lines.0.quantity']).toBe('Takaran harus lebih dari 0')
    expect(e['lines.0.wastePercent']).toBe('Susut maksimal 100')
    expect(e['lines.2.ingredientId']).toBe('Sudah ada di resep ini')
  })
  it('needs no product when editing and refuses an empty recipe', () => {
    const d = { ...filled(), productId: '', lines: [] }
    expect(validateDraft(d, { creating: false })).toEqual({ lines: 'Isi minimal satu bahan' })
  })
})

describe('flags and texts', () => {
  it('lists deleted before missing', () => {
    expect(flagsOf({ deleted: true, missingCost: true })).toEqual(['deleted', 'missing'])
    expect(flagsOf({ deletedIngredient: true })).toEqual(['deleted'])
    expect(flagsOf({})).toEqual([])
  })
  it('writes the unit cost the way the design does', () => {
    expect(unitCostText(line())).toBe('Rp14 per g')
    expect(unitCostText(line({ unit: 'ml', unitCost: { amount: 17000, per: 1000, source: 'manual' } }))).toBe(
      'Rp17.000 per 1.000 ml (harga manual)',
    )
    expect(unitCostText(line({ unitCost: null }))).toBe('Belum ada harga')
    expect(unitCostText(line({ kind: 'sub_recipe' }))).toBe('Dari resep')
  })
  it('names what blocks "Pakai harga modal"', () => {
    expect(applyBlocker(recipe())).toBeNull()
    expect(applyBlocker(recipe({ deletedIngredientIds: ['x'], missingCostIngredientIds: ['y'] }))).toMatch(/dihapus/)
    expect(applyBlocker(recipe({ missingCostIngredientIds: ['y'] }))).toMatch(/belum punya harga/)
  })
})

describe('manual ingredient cost', () => {
  it('builds whole numbers and checks the pack size', () => {
    expect(buildManualCost('17.000', '1000')).toEqual({ cost: 17000, perQty: 1000 })
    expect(validateManualCost('17000', '0')).toEqual({ perQty: 'Isi kemasan harus lebih dari 0' })
    expect(validateManualCost('', '1')).toEqual({ cost: 'Harga wajib diisi' })
  })
})

describe('pickerOptions', () => {
  const rows = [
    { id: 'a', name: 'Nasi Goreng', sku: 'NG' },
    { id: 'b', name: 'Mie Goreng', sku: 'MG' },
  ]
  it('disables a product that already has a recipe and keeps the rest', () => {
    expect(pickerOptions(rows, new Set(['b']))).toEqual([
      { value: 'a', label: 'Nasi Goreng', hint: 'NG' },
      { value: 'b', label: 'Mie Goreng', hint: 'Sudah punya resep', disabled: true },
    ])
  })
  it('offers everything when no recipe exists', () => {
    expect(pickerOptions(rows, new Set()).some((o) => o.disabled)).toBe(false)
  })
})

describe('applyCostConfirm', () => {
  it('names the new and the old cost price', () => {
    const t = applyCostConfirm(12500, 10000)
    expect(t).toContain('menjadi')
    expect(t).toContain('sebelumnya')
    expect(t.endsWith('Lanjutkan?')).toBe(true)
    expect(t).toMatch(/12\.500/)
    expect(t).toMatch(/10\.000/)
  })
})

// UMK-2126: the cost-rise card and the suggested price panel only word what pos-api computed.
describe('cost-rise card wording', () => {
  it('prints tenths of a percent with integers only', () => {
    expect(permilleText(87)).toBe('8,7%')
    expect(permilleText(563)).toBe('56,3%')
    expect(permilleText(600)).toBe('60%')
    expect(permilleText(50)).toBe('5%')
    expect(permilleText(5)).toBe('0,5%')
    expect(permilleText(12345)).toBe('1.234,5%')
    expect(permilleText(-25)).toBe('−2,5%')
  })
  const row = {
    product: { id: 'p', name: 'Nasi goreng' },
    previousCost: 7232,
    costPerPortion: 7864,
    risePermille: 87,
    marginPermille: 563,
    suggested: { targetMargin: 60, price: 19700 },
  }
  it('words the title and the detail as design 43 screen 5 does', () => {
    expect(alertTitle(row)).toBe('Nasi goreng naik 8,7%')
    expect(alertDetail(row)).toBe('Dari Rp7.232 menjadi Rp7.864. Margin Anda kini 56,3%. Usulan harga (margin 60%) Rp19.700.')
  })
  it('leaves out what the server did not answer', () => {
    expect(alertDetail({ ...row, marginPermille: null, suggested: { targetMargin: 60, price: null } })).toBe('Dari Rp7.232 menjadi Rp7.864.')
  })
  it('says when the list is shortened', () => {
    expect(alertsFooter(2, 2)).toBe('Harga tidak berubah kecuali Anda mengubahnya.')
    expect(alertsFooter(7, 5)).toContain('Menampilkan 5 dari 7 resep.')
  })
})

describe('suggested price panel', () => {
  it('accepts whole percents from 1 to 90 only, like pos-api', () => {
    expect(checkTargetMargin('60')).toEqual({ value: 60 })
    expect(checkTargetMargin(' 1 ')).toEqual({ value: 1 })
    expect(checkTargetMargin('90')).toEqual({ value: 90 })
    for (const bad of ['', '0', '91', '1,5', '1.5', 'abc', '-5', '60%']) expect(checkTargetMargin(bad)).toHaveProperty('error')
  })
  it('compares the suggestion with the current price', () => {
    expect(priceCompare({ price: 19700, currentPrice: 18000 })).toBe('Rp1.700 di atas harga jual sekarang.')
    expect(priceCompare({ price: 15000, currentPrice: 18000 })).toBe('Rp3.000 di bawah harga jual sekarang.')
    expect(priceCompare({ price: 18000, currentPrice: 18000 })).toBe('Sama dengan harga jual sekarang.')
  })
  it('confirms with the new and the old price', () => {
    expect(priceConfirm(19700, 18000)).toBe('Harga jual menjadi Rp19.700 (sebelumnya Rp18.000). Lanjutkan?')
  })
})
