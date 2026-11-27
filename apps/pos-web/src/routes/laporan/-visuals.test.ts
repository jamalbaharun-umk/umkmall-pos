import { describe, expect, it } from 'vitest'
import { visualIsEmpty, visualQuery, type Visual } from './-visuals'

const bars = (values: number[], categories = ['a', 'b']): Visual => ({
  id: 'x',
  kind: 'bars',
  title: 'T',
  unit: 'rupiah',
  orientation: 'vertical',
  categories,
  series: [{ label: 'S', values }],
})

describe('visualIsEmpty', () => {
  it('is empty with no category or only zeros, not with one value', () => {
    expect(visualIsEmpty(bars([], []))).toBe(true)
    expect(visualIsEmpty(bars([0, 0]))).toBe(true)
    expect(visualIsEmpty(bars([0, 5]))).toBe(false)
    expect(visualIsEmpty(bars([-5, 0]))).toBe(false)
  })
  it('judges segments by their positive parts', () => {
    const seg = (values: number[]): Visual => ({ id: 's', kind: 'segments', title: 'T', unit: 'rupiah', parts: values.map((value, i) => ({ label: `p${i}`, value })) })
    expect(visualIsEmpty(seg([0, 0]))).toBe(true)
    expect(visualIsEmpty(seg([0, 3]))).toBe(false)
  })
})

describe('visualQuery', () => {
  it('keeps only the keys pos-api reads', () => {
    expect(visualQuery({ from: '2026-11-20', to: '2026-11-26', tenantId: 'x', evil: '1' })).toBe('from=2026-11-20&to=2026-11-26')
    expect(visualQuery({ period: 'week' })).toBe('period=week')
    expect(visualQuery({})).toBe('')
  })
})
