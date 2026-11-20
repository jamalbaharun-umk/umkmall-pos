import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression guard (QA D3): `@umkmall/ui` Select with `portal` AND `showSearch` never opens on a real pointer click (see
// packages/ui/POS-COPY.md, known upstream issues). `portal` alone works (dialog form Selects use it so their list is not
// clipped by the dialog's scroll box); no POS screen may combine the two until the library is fixed.
const routes = join(__dirname, '..')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []
  })

/** Each `<Select …/>` element's props, up to its self-closing `/>` (arrow functions in props never contain `/>`). */
const selectElements = (source: string) =>
  source
    .split(/<Select\b/)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('/>')))

const portalWithSearch = (source: string) =>
  selectElements(source).some((props) => /(^|\s)portal(\s|=|$)/.test(props) && /(^|\s)showSearch(\s|=|$)/.test(props))

describe('no portalled searchable Select', () => {
  it('flags only a Select that has both portal and showSearch', () => {
    expect(portalWithSearch('<Select\n  portal\n  showSearch\n  onValueChange={(v) => set(v)}\n/>')).toBe(true)
    expect(portalWithSearch('<Select portal options={o} />')).toBe(false)
    expect(portalWithSearch('<Select showSearch options={o} />\n<Select portal options={o} />')).toBe(false)
  })

  it('no route passes `portal` together with `showSearch`', () => {
    const offenders = files(routes).filter((f) => portalWithSearch(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
