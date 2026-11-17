/**
 * `generated.ts` is what both platforms import; the `.md` files beside it are what a person
 * edits. This is what stops those two from being different things.
 *
 * A generated artifact that is committed has exactly one failure mode, and it is silent: the
 * source is edited, the generator is not re-run, and every reader keeps serving the previous
 * words. Nothing type-checks it — the module compiles perfectly with stale content — and the
 * web and native surfaces stay identical to each other while both being out of date, which is
 * the version of "in sync" that looks most convincing.
 *
 * It rebuilds IN MEMORY and compares, rather than shelling out to the generator: a test that
 * runs the build and then reads the file back would pass by having just written it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSource, readPages } from '../../../../scripts/docs/build.mjs'
import { DOC_PAGES } from './generated'

const DOCS = resolve(__dirname)

describe('the generated prose module matches its markdown sources', () => {
  const pages = readPages(DOCS)

  it('reads a real set of pages, so the comparison is not vacuous', () => {
    expect(pages.length).toBe(10)
    /* Per page, because one empty file among ten still compares equal to its own output. */
    for (const page of pages) expect(page.body.length, `${page.slug} is empty`).toBeGreaterThan(400)
  })

  it('is exactly what the generator would write today', () => {
    const onDisk = readFileSync(resolve(DOCS, 'generated.ts'), 'utf8')
    /* The whole file, not a key-by-key walk: the docblock and the header carry meaning too,
       and a diff of the whole thing says "run docs:build" more clearly than a missing key. */
    expect(onDisk).toBe(buildSource(pages))
  })

  it('publishes a key for every markdown file, and nothing else', () => {
    const expected = pages.map((p) => p.slug.replace(/-/g, '_').toUpperCase()).sort()
    expect(Object.keys(DOC_PAGES).sort()).toEqual(expected)
  })
})
