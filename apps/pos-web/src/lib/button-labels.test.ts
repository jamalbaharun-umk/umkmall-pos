import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { actionRowClass } from './action-row'
import { SCROLL_ROW } from './scroll-row'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []
  })
}

describe('button labels', () => {
  it('a back-button label is at most three words', () => {
    const long: string[] = []
    for (const f of files(join(__dirname, '..', 'routes')))
      for (const m of readFileSync(f, 'utf8').matchAll(/>(Kembali[^<>{}\n]*)</g))
        if (m[1].trim().split(/\s+/).length > 3) long.push(`${f}: ${m[1]}`)
    expect(long).toEqual([])
  })

  it('an Empty-state action is wrapped in the action row (44 px high buttons)', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'page.tsx'), 'utf8')
    expect(src).toMatch(/\{action && <div className=\{actionRowClass\(/)
    expect(actionRowClass()).toContain('[&>*]:h-11!')
  })

  it('the report tab row is one scrolling line', () => {
    const src = readFileSync(join(__dirname, '..', 'routes', 'laporan', '-ui.tsx'), 'utf8')
    expect(src).toContain('${SCROLL_ROW}')
    expect(src).not.toContain('flex-wrap')
    expect(SCROLL_ROW).toContain('overflow-x-auto')
  })
})
