import { describe, expect, it } from 'vitest'
import {
  latestOnly,
  normalizeQuery,
  PICKER_PAGE_SIZE,
  pickerOptions,
  remember,
  searchPath,
  type PickerProduct,
} from './product-search'

const p = (id: string, name = id, sku = `SKU-${id}`): PickerProduct => ({
  id,
  name,
  sku,
  costPrice: 1000,
})

describe('searchPath', () => {
  it('asks for one page of stock-tracked products, with no q when empty', () => {
    expect(searchPath('')).toBe(`/catalog/products?type=product&perPage=${PICKER_PAGE_SIZE}`)
    expect(searchPath('   ')).toBe(`/catalog/products?type=product&perPage=${PICKER_PAGE_SIZE}`)
  })
  it('encodes the term (name, SKU or barcode) and trims it', () => {
    expect(searchPath('  es teh & gula ')).toContain('q=es+teh+%26+gula')
  })
  it('caps the term at pos-api limit of 100', () => {
    expect(normalizeQuery('a'.repeat(150))).toHaveLength(100)
  })
})

describe('pickerOptions', () => {
  it('shows name with the SKU as hint', () => {
    expect(pickerOptions([p('1', 'Es Teh', 'ET-1')], undefined)).toEqual([
      { value: '1', label: 'Es Teh', hint: 'ET-1' },
    ])
  })
  it('keeps the picked product first when the results no longer hold it', () => {
    expect(pickerOptions([p('2')], p('1')).map((o) => o.value)).toEqual(['1', '2'])
  })
  it('does not duplicate a picked product the results hold', () => {
    expect(pickerOptions([p('1'), p('2')], p('1')).map((o) => o.value)).toEqual(['1', '2'])
  })
})

describe('remember', () => {
  it('adds products without mutating the old map and refreshes a known one', () => {
    const a = remember(new Map(), [p('1')])
    const b = remember(a, [{ ...p('1'), costPrice: 2000 }, p('2')])
    expect(a.size).toBe(1)
    expect(b.get('1')?.costPrice).toBe(2000)
    expect(b.size).toBe(2)
  })
})

describe('latestOnly', () => {
  it('counts only the newest request', () => {
    const l = latestOnly()
    const first = l.next()
    const second = l.next()
    expect(l.isLatest(first)).toBe(false)
    expect(l.isLatest(second)).toBe(true)
  })
})
