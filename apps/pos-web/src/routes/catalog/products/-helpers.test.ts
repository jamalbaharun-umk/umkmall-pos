import { describe, expect, it } from 'vitest'
import { clearRowErrors, formatRp, tierErrors, tiersToInput, unitErrors, unitHint, unitRowsOf, unitsToInput } from './-helpers'

describe('unit rows', () => {
  it('accepts the design example (dus of 24 at Rp78.000)', () => {
    expect(unitErrors([{ name: 'Dus', unitQty: '24', price: '78.000' }], 'pcs')).toEqual({})
    expect(unitsToInput([{ name: ' Dus ', unitQty: '24', price: '78.000' }])).toEqual([
      { name: 'Dus', unitQty: 24, price: 78000 },
    ])
  })
  it('refuses pack sizes 0, 1, negative and decimal, and prices that are not whole rupiah', () => {
    for (const q of ['0', '1', '-3', '2,5', '', '10001'])
      expect(unitErrors([{ name: 'Dus', unitQty: q, price: '100' }], 'pcs')['units.0.unitQty']).toBeTruthy()
    for (const p of ['0', '-1', '1,5', ''])
      expect(unitErrors([{ name: 'Dus', unitQty: '2', price: p }], 'pcs')['units.0.price']).toBeTruthy()
  })
  it('refuses a duplicate name in any case and the base unit name', () => {
    const e = unitErrors(
      [
        { name: 'Dus', unitQty: '24', price: '100' },
        { name: 'dus', unitQty: '12', price: '100' },
        { name: 'PCS', unitQty: '6', price: '100' },
      ],
      'pcs',
    )
    expect(e['units.0.name']).toBeUndefined()
    expect(e['units.1.name']).toBeTruthy()
    expect(e['units.2.name']).toBeTruthy()
  })
  it('round-trips server units into rows', () => {
    expect(unitRowsOf([{ name: 'Dus', unitQty: 24, price: 78000 }])).toEqual([
      { name: 'Dus', unitQty: '24', price: '78000' },
    ])
    expect(unitRowsOf(undefined)).toEqual([])
  })
})

describe('tier rows', () => {
  const ok = [
    { minQty: '12', price: '3.300' },
    { minQty: '48', price: '3.200' },
  ]
  it('accepts rising quantities with falling prices at or below the base price', () => {
    expect(tierErrors(ok, '3.500')).toEqual({})
    expect(tiersToInput(ok)).toEqual([
      { minQty: 12, price: 3300 },
      { minQty: 48, price: 3200 },
    ])
  })
  it('refuses minQty below 2, equal or descending', () => {
    expect(tierErrors([{ minQty: '1', price: '3000' }], '3500')['priceTiers.0.minQty']).toBeTruthy()
    const e = tierErrors(
      [
        { minQty: '12', price: '3300' },
        { minQty: '12', price: '3200' },
      ],
      '3500',
    )
    expect(e['priceTiers.1.minQty']).toBeTruthy()
  })
  it('refuses a price that does not fall or is above the base price', () => {
    const e = tierErrors(
      [
        { minQty: '12', price: '3300' },
        { minQty: '48', price: '3300' },
      ],
      '3500',
    )
    expect(e['priceTiers.1.price']).toBeTruthy()
    expect(tierErrors([{ minQty: '12', price: '3600' }], '3500')['priceTiers.0.price']).toBeTruthy()
  })
  it('does not blame the tier for a missing base price', () => {
    expect(tierErrors(ok, '')).toEqual({})
  })
})

describe('hints and formatting', () => {
  it('shows the price per base unit and the saving', () => {
    expect(unitHint({ name: 'Dus', unitQty: '24', price: '78000' }, 'pcs', '3500')).toBe(
      'Setara Rp3.250 per pcs. Beli 1 Dus hemat Rp6.000.',
    )
  })
  it('says "sekitar" for a fraction and omits a saving that is not one', () => {
    expect(unitHint({ name: 'Dus', unitQty: '3', price: '10000' }, 'pcs', '3000')).toBe('Setara sekitar Rp3.333 per pcs.')
  })
  it('is null until the numbers are valid', () => {
    expect(unitHint({ name: 'Dus', unitQty: '1', price: '100' }, 'pcs', '50')).toBeNull()
    expect(unitHint({ name: 'Dus', unitQty: '', price: '' }, 'pcs', '50')).toBeNull()
  })
  it('formats rupiah with dots', () => {
    expect(formatRp(1250000)).toBe('Rp1.250.000')
    expect(formatRp(0)).toBe('Rp0')
  })
})

describe('clearRowErrors', () => {
  const errors = { 'units.0.price': 'a', 'units.1.name': 'b', units: 'c', name: 'd' }
  it('clears one row (and the list-level message) or the whole list, leaving other fields', () => {
    expect(clearRowErrors(errors, 'units', 0)).toEqual({ 'units.1.name': 'b', name: 'd' })
    expect(clearRowErrors(errors, 'units')).toEqual({ name: 'd' })
  })
  it('returns the same object when nothing matches', () => {
    expect(clearRowErrors(errors, 'priceTiers')).toBe(errors)
  })
})
