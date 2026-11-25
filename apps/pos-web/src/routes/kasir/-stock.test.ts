import { describe, expect, it } from 'vitest'
import { filterLabel, overStock, stockOverMessage, stockState } from './-stock'

describe('stockState', () => {
  it('untracked products have no stock to show', () => {
    expect(stockState(null, 5)).toBe('untracked')
    expect(stockState(undefined, 5)).toBe('untracked')
  })
  it('zero is out, at or below the threshold is low, above is enough', () => {
    expect(stockState(0, 5)).toBe('out')
    expect(stockState(0, 0)).toBe('out')
    expect(stockState(1, 5)).toBe('low')
    expect(stockState(5, 5)).toBe('low')
    expect(stockState(6, 5)).toBe('enough')
    expect(stockState(1, 0)).toBe('enough')
  })
  it('a negative on-hand reads as out', () => {
    expect(stockState(-2, 5)).toBe('out')
  })
})

describe('overStock', () => {
  const line = (stock: number | null, qty: number) => ({ name: 'x', stock, qty })
  it('flags a line above the stock, not one at the stock', () => {
    expect(overStock([line(3, 4)])).toHaveLength(1)
    expect(overStock([line(3, 3)])).toHaveLength(0)
    expect(overStock([line(0, 1)])).toHaveLength(1)
  })
  it('never flags an untracked product', () => {
    expect(overStock([line(null, 99_999)])).toHaveLength(0)
  })
  it('keeps only the offending lines', () => {
    const lines = [line(10, 2), line(3, 4), line(null, 1)]
    expect(overStock(lines)).toEqual([lines[1]])
  })
})

describe('copy', () => {
  it('uses the approved message', () => {
    expect(stockOverMessage(3)).toBe('Stok hanya 3. Kurangi jumlah atau perbarui stok dulu.')
  })
  it('puts the count in the filter label only when known', () => {
    expect(filterLabel('Menipis', 2)).toBe('Menipis (2)')
    expect(filterLabel('Semua', undefined)).toBe('Semua')
  })
})
