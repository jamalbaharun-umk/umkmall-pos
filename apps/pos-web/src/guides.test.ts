import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUIDES, GUIDE_STEPS, SHARED_TARGETS, guideFor, guideKeyOf } from './guides'
import { NAV } from './nav'

const SRC = __dirname
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : files(p)
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'guides.ts' ? [p] : []
  })
const source = files(SRC)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

describe('guides (UMK-2134, design 46)', () => {
  it('every navigation screen has a guide of 3 to 5 steps', () => {
    const missing = NAV.flatMap((g) => g.items)
      .map((i) => i.to)
      .filter((to) => !GUIDE_STEPS[to])
    expect(missing).toEqual([])
    for (const g of GUIDES) {
      expect(g.steps.length).toBeGreaterThanOrEqual(3)
      expect(g.steps.length).toBeLessThanOrEqual(5)
    }
  })

  it('has no guide for a screen that is not in the navigation', () => {
    const nav = new Set(NAV.flatMap((g) => g.items).map((i) => i.to))
    expect(Object.keys(GUIDE_STEPS).filter((to) => !nav.has(to))).toEqual([])
  })

  it('points every step at a target that some screen carries', () => {
    const unknown = GUIDES.flatMap((g) => g.steps.map((s) => s.target))
      .filter((t) => !(SHARED_TARGETS as readonly string[]).includes(t))
      .filter((t) => !source.includes(`data-guide="${t}"`))
    expect(unknown).toEqual([])
    for (const t of SHARED_TARGETS) expect(source).toContain(`data-guide="${t}"`)
  })

  it('says one short sentence per bubble, with a short title', () => {
    for (const s of GUIDES.flatMap((g) => g.steps)) {
      expect(s.title.length).toBeLessThanOrEqual(40)
      expect(s.text.length).toBeLessThanOrEqual(120)
      expect(s.text).toMatch(/^[A-Z"].*\.$/)
      // One sentence: no full stop followed by a new sentence inside.
      expect(s.text.slice(0, -1)).not.toMatch(/\. [A-Z]/)
    }
  })

  it('keys a guide by its path and finds it only on the screen itself', () => {
    expect(guideKeyOf('/')).toBe('dashboard')
    expect(guideKeyOf('/catalog/products')).toBe('catalog.products')
    expect(new Set(GUIDES.map((g) => g.key)).size).toBe(GUIDES.length)
    for (const g of GUIDES) expect(g.key).toMatch(/^[a-z0-9_.-]{1,60}$/)
    expect(guideFor('/catalog/products')?.key).toBe('catalog.products')
    expect(guideFor('/catalog/products/')?.key).toBe('catalog.products')
    expect(guideFor('/catalog/products/baru')).toBeUndefined()
    expect(guideFor('/')?.key).toBe('dashboard')
  })
})
