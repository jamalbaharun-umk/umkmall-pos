import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression guard (QA D3): `@umkmall/ui` Select with `portal` never opens on a real pointer click (see
// packages/ui/POS-COPY.md, known upstream issues). No POS screen may pass it until the library is fixed.
const routes = join(__dirname, '..')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []
  })

describe('no portalled Select', () => {
  it('no route passes `portal` to a component', () => {
    const offenders = files(routes).filter((f) => /^\s*portal(\s|=|$)/m.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
