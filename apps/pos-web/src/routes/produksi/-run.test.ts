import { describe, expect, it } from 'vitest'
import { REASON } from '../catalog/products/-stock-reasons'
import {
  buildRunPayload,
  costShares,
  dayText,
  differenceText,
  emptyRunDraft,
  keyFor,
  listQuery,
  newKey,
  parseListSearch,
  planBlocker,
  planMatches,
  planQuery,
  rangeError,
  runRefusal,
  shortageText,
  signedText,
  successText,
  validatePlanInput,
  validateRun,
  whole,
  yieldBars,
  type Plan,
  type RunSummary,
} from './-run'

const RECIPE = '0f8fad5b-d9cb-469f-a165-70867728950e'
const draft = (over = {}) => ({ ...emptyRunDraft(), recipeId: RECIPE, batches: '2', actualYield: '19', ...over })

const plan = (over: Partial<Plan> = {}): Plan => ({
  recipeId: RECIPE,
  product: { id: 'p', name: 'Nasi goreng' },
  batches: 2,
  yieldQty: 10,
  yieldUnit: 'porsi',
  plannedYield: 20,
  ingredients: [
    { productId: 'a', name: 'Beras', unit: 'g', needed: 3000, available: 8500, enough: true },
    { productId: 'b', name: 'Telur', unit: 'pcs', needed: 20, available: 14, enough: false },
  ],
  deletedIngredientIds: [],
  canProduce: false,
  ...over,
})

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'r1',
  date: '2026-11-26',
  recipeId: RECIPE,
  productId: 'p',
  productName: 'Nasi goreng',
  batches: 2,
  plannedYield: 20,
  actualYield: 19,
  yieldUnit: 'porsi',
  ingredientCost: 144632,
  costPerPortion: 7613,
  note: null,
  createdAt: '2026-11-26T03:00:00.000Z',
  yieldDifference: -1,
  ...over,
})

describe('production form (UMK-2132, design 45)', () => {
  it('reads whole numbers with or without a thousands dot', () => {
    expect(whole('1.500')).toBe(1500)
    expect(whole('1500')).toBe(1500)
    expect(whole(' 12 ')).toBe(12)
    expect(whole('1,5')).toBeNaN()
    expect(whole('1.50')).toBeNaN()
    expect(whole('')).toBeNaN()
    expect(whole('-3')).toBeNaN()
  })

  it('accepts a valid form, "1.500" included', () => {
    expect(validateRun(draft())).toEqual({})
    expect(validateRun(draft({ batches: '1.000', actualYield: '1.500' }))).toEqual({})
  })

  it('mirrors pos-api: recipe required, batches 1..1000, yield 1..10.000.000, note up to 500', () => {
    expect(validateRun(draft({ recipeId: '' })).recipeId).toBe('Pilih resep')
    expect(validateRun(draft({ batches: '' })).batches).toBe('Jumlah batch wajib diisi')
    expect(validateRun(draft({ batches: '0' })).batches).toBe('Jumlah batch harus lebih dari 0')
    expect(validateRun(draft({ batches: '1001' })).batches).toBe('Jumlah batch maksimal 1.000')
    expect(validateRun(draft({ batches: '1,5' })).batches).toBe('Jumlah batch harus bilangan bulat')
    expect(validateRun(draft({ actualYield: '' })).actualYield).toBe('Hasil sebenarnya wajib diisi')
    expect(validateRun(draft({ actualYield: '0' })).actualYield).toBe('Hasil sebenarnya harus lebih dari 0')
    expect(validateRun(draft({ actualYield: '10000001' })).actualYield).toBe('Hasil sebenarnya maksimal 10.000.000')
    expect(validateRun(draft({ note: 'x'.repeat(501) })).note).toBe('Maksimal 500 karakter')
    expect(validateRun(draft({ note: 'x'.repeat(500) }))).toEqual({})
  })

  it('builds the body with whole numbers and a blank note as null', () => {
    expect(buildRunPayload(draft({ batches: '1.000', actualYield: '1.500', note: '  ' }))).toEqual({
      recipeId: RECIPE,
      batches: 1000,
      actualYield: 1500,
      note: null,
    })
    expect(buildRunPayload(draft({ note: ' hujan, adonan kurang ' })).note).toBe('hujan, adonan kurang')
  })

  it('asks for a plan only for valid recipe and batches', () => {
    expect(planQuery(draft())).toEqual({ recipeId: RECIPE, batches: 2 })
    expect(planQuery(draft({ batches: '1.000' }))).toEqual({ recipeId: RECIPE, batches: 1000 })
    expect(planQuery(draft({ batches: 'x' }))).toBeNull()
    expect(planQuery(draft({ recipeId: '' }))).toBeNull()
    expect(validatePlanInput(draft({ batches: '0' }))).toHaveProperty('batches')
  })

  it('knows when the plan on screen is stale', () => {
    const q = { recipeId: RECIPE, batches: 2 }
    expect(planMatches(plan(), q)).toBe(true)
    expect(planMatches(plan(), { ...q, batches: 3 })).toBe(false)
    expect(planMatches(plan(), { ...q, recipeId: 'other' })).toBe(false)
    expect(planMatches(null, q)).toBe(false)
    expect(planMatches(plan(), null)).toBe(false)
  })
})

describe('Idempotency-Key', () => {
  const p = buildRunPayload(draft())
  let n = 0
  const make = () => `k${++n}`

  it('keeps the key for a retry of the same request and renews it when anything changed', () => {
    const first = keyFor(null, p, make)
    expect(keyFor(first, { ...p }, make)).toBe(first)
    expect(keyFor(first, { ...p }, make).key).toBe(first.key)
    for (const changed of [{ batches: 3 }, { actualYield: 18 }, { note: 'x' }, { recipeId: 'other' }]) {
      const next = keyFor(first, { ...p, ...changed }, make)
      expect(next.key).not.toBe(first.key)
    }
  })

  it('makes keys pos-api accepts', () => {
    const k = newKey()
    expect(k).toMatch(/^[A-Za-z0-9_-]{8,100}$/)
    expect(newKey()).not.toBe(k)
  })
})

describe('texts', () => {
  it('names one short ingredient as the design does', () => {
    expect(shortageText([{ name: 'Telur', unit: 'pcs', needed: 20, available: 14 }])).toBe('Telur hanya ada 14 pcs, produksi butuh 20 pcs.')
  })

  it('lists several, groups digits and shortens a long list to fit the dialog', () => {
    const many = ['Telur', 'Kecap', 'Beras', 'Minyak', 'Garam'].map((name, i) => ({ name, unit: 'g', needed: 2000 + i, available: 1 }))
    const t = shortageText(many)
    expect(t).toContain('Telur (ada 1 g, butuh 2.000 g)')
    expect(t).toContain('dan 2 bahan lain')
    expect(t).not.toContain('Minyak')
    expect(t.length).toBeLessThanOrEqual(220)
    const long = shortageText(Array.from({ length: 4 }, () => ({ name: 'N'.repeat(80), unit: 'ml', needed: 10_000_000, available: 0 })))
    expect(long.length).toBeLessThanOrEqual(220)
    expect(shortageText([])).toBe('Bahan tidak cukup.')
  })

  it('turns pos-api 422 codes into what happened and what to do', () => {
    const stock = runRefusal(422, {
      message: 'Bahan tidak cukup: x',
      code: 'INSUFFICIENT_STOCK',
      errors: { batches: 'Bahan tidak cukup: x' },
      shortages: [{ name: 'Telur', unit: 'pcs', needed: 20, available: 14 }],
    })
    expect(stock).toMatchObject({ status: 422, code: 'INSUFFICIENT_STOCK', error: 'Telur hanya ada 14 pcs, produksi butuh 20 pcs.' })
    expect(stock.todo).toContain('kurangi jumlah batch')
    expect(stock.errors).toEqual({ batches: 'Bahan tidak cukup: x' })
    const deleted = runRefusal(422, { message: 'Ada bahan resep yang sudah dihapus', code: 'INGREDIENT_DELETED', errors: { recipeId: 'x' } })
    expect(deleted).toMatchObject({ code: 'INGREDIENT_DELETED', error: 'Ada bahan resep yang sudah dihapus' })
    expect(deleted.todo).toContain('ganti bahan')
    const unstocked = runRefusal(422, { message: 'Produk hasil resep ini tidak memakai stok', code: 'PRODUCT_NOT_STOCKED' })
    expect(unstocked.code).toBe('PRODUCT_NOT_STOCKED')
    expect(unstocked.todo).toContain('memakai stok')
  })

  it('keeps other refusals plain and hides a server fault', () => {
    expect(runRefusal(422, { message: 'Hasil harus lebih dari 0', errors: { actualYield: 'Hasil harus lebih dari 0' } })).toEqual({
      status: 422,
      error: 'Hasil harus lebih dari 0',
      errors: { actualYield: 'Hasil harus lebih dari 0' },
    })
    expect(runRefusal(500, { message: 'select * from secret' }).error).toBe('Terjadi kesalahan. Coba lagi sebentar lagi.')
    expect(runRefusal(502, null).error).toBe('Terjadi kesalahan. Coba lagi sebentar lagi.')
    expect(runRefusal(404, {}).status).toBe(404)
  })

  it('says why a plan cannot be produced, or nothing when it can', () => {
    expect(planBlocker(null)).toBeNull()
    expect(planBlocker(plan({ canProduce: true }))).toBeNull()
    expect(planBlocker(plan())).toBe('Stok Telur kurang. Beli atau tambah stok, atau kurangi jumlah batch.')
    expect(planBlocker(plan({ deletedIngredientIds: ['a'] }))).toContain('sudah dihapus')
    expect(planBlocker(plan({ ingredients: [] }))).toContain('tidak memakai stok')
  })

  it('words the yield against the plan', () => {
    expect(differenceText(0, 'porsi')).toBe('Sesuai rencana')
    expect(differenceText(-1, 'porsi')).toBe('Kurang 1 porsi')
    expect(differenceText(1500, 'pcs')).toBe('Lebih 1.500 pcs')
    expect(signedText(-1)).toBe('−1')
    expect(signedText(2)).toBe('+2')
    expect(signedText(0)).toBe('0')
    expect(successText(19, 'porsi')).toBe('Produksi dicatat: 19 porsi masuk stok')
    expect(dayText('2026-11-26')).toBe('26 Nov 2026')
    expect(dayText('2026-11-05', true)).toBe('5 Nov')
    expect(dayText('bukan tanggal')).toBe('bukan tanggal')
  })
})

describe('list and charts', () => {
  it('reads the filters from the address and drops what it does not know', () => {
    expect(parseListSearch({})).toEqual({})
    expect(parseListSearch({ page: '3', from: '2026-11-01', to: '2026-11-30' })).toEqual({ page: 3, from: '2026-11-01', to: '2026-11-30' })
    expect(parseListSearch({ page: '1', from: 'kemarin', to: 5 })).toEqual({})
  })

  it('builds the list query and checks the range', () => {
    expect(listQuery({})).toBe('page=1&perPage=20')
    expect(listQuery({ page: 2, from: '2026-11-01' })).toBe('page=2&perPage=20&from=2026-11-01')
    expect(rangeError('2026-11-10', '2026-11-01')).toBe('Harus sama atau setelah tanggal awal')
    expect(rangeError('2026-11-01', '2026-11-01')).toBeUndefined()
    expect(rangeError('', '2026-11-01')).toBeUndefined()
  })

  it('compares planned and actual yield on one scale', () => {
    const bars = yieldBars([run(), run({ id: 'r2', date: '2026-11-22', plannedYield: 10, actualYield: 10, productName: 'Keripik singkong pedas manis' })])
    expect(bars.categories[0]).toBe('26 Nov · Nasi goreng')
    expect(bars.categories[1].endsWith('…')).toBe(true)
    expect(bars.series).toEqual([
      { label: 'Rencana', values: [20, 10] },
      { label: 'Hasil nyata', values: [19, 10] },
    ])
    expect(yieldBars(Array.from({ length: 12 }, (_, i) => run({ id: String(i) }))).categories).toHaveLength(8)
  })

  it('shares the ingredient cost, largest first, skipping free lines', () => {
    const line = (name: string, cost: number) => ({ ingredientId: name, name, unit: 'g', quantity: 1, cost })
    expect(costShares([line('Kecap', 5), line('Beras', 100), line('Air', 0)])).toEqual([
      { label: 'Beras', value: 100 },
      { label: 'Kecap', value: 5 },
    ])
  })
})

describe('label maps', () => {
  it('labels the stock history reasons of a production run', () => {
    expect(REASON.production).toBe('Hasil produksi')
    expect(REASON.production_use).toBe('Dipakai produksi')
    expect(REASON.sale).toBe('Penjualan')
  })
})
