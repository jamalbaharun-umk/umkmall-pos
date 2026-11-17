/**
 * The web `.mdx` pages hold NO prose of their own — they are frames around the shared source.
 *
 * The extraction is only worth anything while that stays true. The obvious way it stops being
 * true is the easy one: someone edits a Guidelines page, finds themselves in a `.mdx`, and
 * writes a paragraph there. It renders perfectly on the web, the native playbook never sees
 * it, and the two surfaces are back to disagreeing — with no build error and nothing red,
 * which is the state this whole arrangement was built to leave.
 *
 * So this asserts the shape rather than the content: a frame page is a comment, two imports, a
 * `<Meta>` and a `<Markdown>`, and nothing else. Any prose line is a failure that names the
 * file and says where the words belong.
 *
 * FOUR PAGES ARE EXEMPT, and each one is exempt for the same reason: it documents a mechanism
 * that exists only on the web, so sharing it would put instructions on a surface where they are
 * false. Named individually rather than skipped by a pattern, so the exemption cannot quietly
 * grow — a fifth entry is an edit a reviewer sees.
 *
 * - `Contributing.mdx` — Storybook's CSF indexer, why `meta.title` must be a literal, how a
 *   story lands in a section. Native has none of those mechanisms.
 * - `Prototyping.mdx` — an npm script, a Storybook download link and a browser bundle
 *   (UMK-1027 KTD2). There is no native equivalent of any of the three.
 * - `PrototypingWithAI.mdx` — the same workflow, plus a prompt that embeds the generated
 *   contract reference. It is about writing web prototypes, which the playbook does not do.
 * - `PrototypingWithAnAgent.mdx` — an MCP endpoint served by the web Storybook itself, over a
 *   manifest that same build emits (UMK-1027). A `claude mcp add` against a Railway URL is not
 *   a thing the native playbook can offer, and a shared page would say otherwise.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOC_PAGES } from './generated'

const MDX_DIR = resolve(__dirname, '..', '..', '..', '..', 'apps', 'design', 'src', 'docs')

/** The pages that legitimately own their own words — see the docblock for why each one does. */
const WEB_ONLY = [
  'Contributing.mdx',
  'Prototyping.mdx',
  'PrototypingWithAI.mdx',
  'PrototypingWithAnAgent.mdx',
]

/** A line that is neither blank, nor part of the frame, nor inside the leading comment. */
const isProse = (line: string): boolean => {
  const t = line.trim()
  if (t === '') return false
  if (t.startsWith('import ')) return false
  if (t.startsWith('<Meta ')) return false
  if (t.startsWith('<Markdown>')) return false
  return true
}

describe('the web mdx pages are frames, not prose', () => {
  const files = readdirSync(MDX_DIR).filter((f) => f.endsWith('.mdx'))

  it('finds the pages it means to check, so the loop is not vacuous', () => {
    expect(files.length).toBe(14)
    expect(files.filter((f) => !WEB_ONLY.includes(f))).toHaveLength(10)
    /* And the shared module has a page for each of them. */
    expect(Object.keys(DOC_PAGES)).toHaveLength(10)
  })

  it.each(readdirSync(MDX_DIR).filter((f) => f.endsWith('.mdx') && !WEB_ONLY.includes(f)))(
    '%s carries no prose of its own',
    (file) => {
      const source = readFileSync(resolve(MDX_DIR, file), 'utf8')
      /* Drop the leading `{/* … *​/}` comment block: it explains where the prose went, which is
         exactly what a reader opening this file needs. */
      const body = source.slice(source.indexOf('*/}') + 3)
      const offenders = body.split('\n').filter(isProse)
      expect(
        offenders,
        `${file} should be a frame — put these words in packages/ui/src/docs/*.md and run npm run docs:build`,
      ).toEqual([])
    },
  )

  it('renders the shared page each frame names', () => {
    for (const file of readdirSync(MDX_DIR).filter((f) => f.endsWith('.mdx') && !WEB_ONLY.includes(f))) {
      const source = readFileSync(resolve(MDX_DIR, file), 'utf8')
      const key = /<Markdown>\{DOC_PAGES\.([A-Z_]+)\}<\/Markdown>/.exec(source)?.[1]
      expect(key, `${file} names no shared page`).toBeTruthy()
      expect(Object.keys(DOC_PAGES)).toContain(key)
    }
  })
})
