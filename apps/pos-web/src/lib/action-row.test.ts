import { describe, expect, it } from 'vitest'
import { actionRowClass } from './action-row'

describe('actionRowClass', () => {
  it('never lets a label wrap or a button shrink', () => {
    for (const o of [{}, { stacked: true }, { align: 'start' as const }]) {
      const c = actionRowClass(o)
      expect(c).toContain('[&>*]:whitespace-nowrap')
      expect(c).toContain('[&>*]:shrink-0')
    }
  })

  it('has a fixed 44 px height and a 12 px radius, never a pill', () => {
    const c = actionRowClass()
    expect(c).toContain('[&>*]:h-11!')
    expect(c).toContain('[&>*]:rounded-[12px]!')
    expect(c).not.toContain('rounded-full')
  })

  it('stacks on a phone with the primary (last child) on top, then sits inline and right-aligned from sm', () => {
    const c = actionRowClass()
    expect(c).toContain('flex-col-reverse')
    expect(c).toContain('sm:flex-row')
    expect(c).toContain('sm:justify-end')
    expect(c).not.toContain('sm:justify-between')
  })

  it('left-aligns on request', () => {
    expect(actionRowClass({ align: 'start' })).toContain('sm:justify-start')
  })

  it('stays a column at every width when stacked', () => {
    const c = actionRowClass({ stacked: true })
    expect(c).toContain('flex-col-reverse')
    expect(c).not.toContain('sm:flex-row')
  })

  it('appends a caller class', () => {
    expect(actionRowClass({ className: 'mt-4' })).toMatch(/ mt-4$/)
  })
})
