/**
 * Storybook's sidebar order and `COMPONENT_CATEGORIES` are ONE list, reconciled here.
 *
 * `apps/design/.storybook/preview.ts` hand-writes its `storySort.order` array — it has to be a
 * literal there for the same class of reason `meta.title` does, and rewriting that file is not
 * this guard's business. What it must not be is a SECOND SOURCE. The native playbook renders
 * its menu from `COMPONENT_CATEGORIES`, so a category reordered in one place and not the other
 * gives two surfaces showing the same components under differently-ordered headings — the
 * drift a person comparing them is least likely to notice, because every individual page looks
 * right.
 *
 * READ AS TEXT, not imported: `preview.ts` pulls in Storybook's runtime, which does not load
 * under vitest. The parse is narrow on purpose — it takes the top-level strings of the
 * `order` array and drops the nested `['Guidelines']` marker arrays, which are a Storybook
 * mechanism (they pin a category's first child) rather than part of the order this asserts.
 *
 * Sited in `packages/ui` with the list it guards, per
 * docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md. That means it reads
 * across into `apps/design`, and the caching caveat is the usual one: this reds on a change to
 * THIS package, and a `preview.ts`-only edit is caught by `apps/design`'s own run.
 *
 * PROVED RED, one injection per assertion:
 *
 * | Injection | Reds |
 * | -- | -- |
 * | Two categories swapped in the SIDEBAR | 1 — the order comparison |
 * | Two categories swapped in the CONTRACT | 1 — the same one, from the other side |
 * | `Foundations` demoted below the seven | 1 — the top-level split |
 * | The children's indent shifted so the parse misses them | **2** — the floor AND the order,
 *   because a dark parse yields an empty list that compares unequal. The floor is the one that
 *   names the cause, and it is per LEVEL rather than a total for exactly that reason: six
 *   top-level names with zero children looks healthy from a total, which is the bug the first
 *   version of this guard actually had |
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPONENT_CATEGORIES } from './variants'

const PREVIEW = resolve(__dirname, '..', '..', '..', '..', 'apps', 'design', '.storybook', 'preview.ts')

describe('the Storybook sidebar and COMPONENT_CATEGORIES are one order', () => {
  const source = readFileSync(PREVIEW, 'utf8')
  const orderBlock = source.slice(source.indexOf('order: ['))

  /**
   * The array is NESTED, and the nesting is the whole structure: the six top-level entries sit
   * at one indent, and a section's children — Foundations' pages, Components' categories — sit
   * one level deeper inside a bare `[ … ]` that follows their section's name. A flat scan of
   * the file finds the six and misses every category, which is what the first version of this
   * did and why its floor is set where it is.
   */
  const topLevel = [...orderBlock.matchAll(/^ {10}'([^']+)',$/gm)].map((m) => m[1])

  /** The children of one section: the `[ … ]` block that follows its name. */
  const childrenOf = (section: string): string[] => {
    const at = orderBlock.indexOf(`'${section}',`)
    const open = orderBlock.indexOf('[', at)
    const close = orderBlock.indexOf('\n          ],', open)
    /* 12 spaces: the children themselves. A nested `['Guidelines']` marker sits deeper still
       and is a Storybook mechanism for pinning a category's first child, not part of this
       order. */
    return [...orderBlock.slice(open, close).matchAll(/^ {12}'([^']+)',$/gm)].map((m) => m[1])
  }

  it('parses both levels out of preview.ts, so the comparisons are not vacuous', () => {
    /* Per LEVEL, because a parse that finds the six top-level names and no children looks
       healthy from a total — which is precisely the failure the first version of this had. */
    expect(topLevel).toContain('Components')
    expect(topLevel.length).toBeGreaterThanOrEqual(6)
    expect(childrenOf('Components').length).toBeGreaterThanOrEqual(7)
    expect(childrenOf('Foundations').length).toBeGreaterThanOrEqual(6)
  })

  it('lists the seven Components categories in the same order', () => {
    expect(childrenOf('Components')).toEqual(COMPONENT_CATEGORIES.filter((c) => c !== 'Foundations'))
  })

  it('puts Foundations before Components in both, as a top-level section', () => {
    expect(topLevel.indexOf('Foundations')).toBeGreaterThan(-1)
    expect(topLevel.indexOf('Foundations')).toBeLessThan(topLevel.indexOf('Components'))
    expect(COMPONENT_CATEGORIES[0]).toBe('Foundations')
  })
})
