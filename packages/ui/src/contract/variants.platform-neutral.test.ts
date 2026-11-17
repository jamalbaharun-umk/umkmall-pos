/**
 * The contract must stay consumable by a future `.native.tsx` sibling (R8), which means its
 * import graph may reach nothing web-specific — no React, no `cva`, no `clsx`, no DOM type.
 *
 * Sited in `packages/ui`, deliberately. `turbo.json`'s `test` task is cacheable with no
 * `inputs` or `dependsOn`, so a task hash covers a package's OWN files and not its workspace
 * dependencies'. The same guard written in `apps/main-website` would replay a cached PASS
 * over a live regression here.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * The check is a bare-specifier ban rather than a deny-list of package names. A deny-list
 * has to be kept current — the first platform dependency nobody thought to list walks
 * straight through it. "Imports nothing but its own relative siblings" needs no maintenance
 * and is the actual requirement.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contract, TEXT_ROLES, TEXT_ROLE_WEIGHTS, type ComponentContract } from './variants'

const CONTRACT_DIR = resolve(__dirname)
const ENTRY = join(CONTRACT_DIR, 'index.ts')

/**
 * Every module-load form, keyed on the SPECIFIER rather than on a bound name.
 *
 * A form list keyed on the imported binding — `import { x } from` / `export { x } from` —
 * has a hole in the middle that neither end reaches: `export * from '<module>'` re-exports
 * every symbol of its target but has no brace list to match a name against and no
 * `import`/`require` keyword before the specifier. `contract/index.ts` is exactly that
 * shape, so it is a form this directory already writes.
 * See docs/solutions/conventions/a-guards-form-list-must-cover-export-star-and-barrels.md
 */
const SPECIFIER_FORMS = [
  /\bimport\s[^'"()]*?\bfrom\s*['"]([^'"]+)['"]/g, // import x / { x } / * as x from '…'
  /\bexport\s[^'"()]*?\bfrom\s*['"]([^'"]+)['"]/g, // export { x } / * / * as ns from '…'
  /\bimport\s*['"]([^'"]+)['"]/g, //                  bare side-effect import '…'
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //        dynamic import('…')
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //       require('…')
]

/**
 * DOM and React globals are AMBIENT — they need no import, so the specifier scan above
 * cannot see them. A short list is correct here precisely because the surface is closed:
 * these are the names a vocabulary file would plausibly reach for.
 */
const AMBIENT_PLATFORM_TYPES = /\b(?:React\.|JSX\.|HTML[A-Z]\w*Element|SVGElement|\bdocument\b|\bwindow\b)/

const specifiers = (source: string): string[] =>
  SPECIFIER_FORMS.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]))

/** Resolve a relative specifier the way TS would, without pulling in a resolver. */
const resolveLocal = (fromFile: string, spec: string): string => {
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not this candidate; try the next shape.
    }
  }
  throw new Error(`${fromFile} imports '${spec}', which resolves to no file`)
}

/** Walk the graph from the barrel, following relative edges only. */
const walk = (entry: string) => {
  const seen = new Set<string>()
  const bare: { file: string; spec: string }[] = []
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const spec of specifiers(source)) {
      if (spec.startsWith('.')) queue.push(resolveLocal(file, spec))
      else bare.push({ file, spec })
    }
  }
  return { files: seen, bare }
}

describe('the variant contract is platform-neutral', () => {
  const { files, bare } = walk(ENTRY)

  it('reaches every file in the contract directory', () => {
    /** A graph walk that reached only the barrel would pass this suite vacuously. */
    const onDisk = readdirSync(CONTRACT_DIR)
      .filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'))
      .map((f) => join(CONTRACT_DIR, f))
    expect([...files].sort()).toEqual(onDisk.sort())
    expect(files.size).toBeGreaterThan(1)
  })

  it('imports nothing outside its own directory', () => {
    expect(bare).toEqual([])
  })

  it('names no ambient DOM or React type', () => {
    const offenders = [...files].filter((f) => AMBIENT_PLATFORM_TYPES.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('the contract declares what it claims to', () => {
  it('gives every component an axis, or marks it unimplemented', () => {
    for (const [name, entry] of Object.entries<ComponentContract>(contract)) {
      const declared = Object.keys(entry.axes).length + (entry.pendingAxes?.length ?? 0)
      if (entry.status === 'implemented') {
        expect(declared, `${name} is implemented but declares no axis`).toBeGreaterThan(0)
      } else {
        expect(entry.slice, `${name} is unimplemented but names no owning slice`).toBeTruthy()
      }
    }
  })

  it('attaches a reason to every recorded divergence', () => {
    const all = Object.values<ComponentContract>(contract).flatMap((c) => c.divergences ?? [])
    expect(all.length).toBeGreaterThanOrEqual(3)
    for (const d of all) {
      expect(d.figma).toBeTruthy()
      expect(d.ours).toBeTruthy()
      expect(d.reason.length).toBeGreaterThan(40)
    }
  })

  /**
   * A DIVERGENCE MUST NOT CLAIM A PROP THAT DOES NOT EXIST.
   *
   * `Upload`'s boolean-slots entry claimed for two slices that five `Show *` booleans had been
   * collapsed onto slot props, while two of the five — the info row and the tooltip — had never
   * been built at all. No guard reads divergence PROSE, so the record was simply wrong and
   * nothing said so. This reads the component's own source for the props the entry names, which
   * is the smallest thing that could have caught it.
   */
  it('backs the Upload slot-collapse record with props that exist', () => {
    const source = readFileSync(
      resolve(__dirname, '../primitives/Upload/Upload.tsx'),
      'utf8',
    )
    /* SLICED TO THE PROPS BLOCK, and matched without an indentation anchor. Keying on two
       leading spaces made the guard a formatting assertion: a prop re-nested one level deeper —
       or a `showTooltip` boolean added inside a nested object — walked straight through it. */
    const start = source.indexOf('export type UploadProps')
    expect(start, 'UploadProps is no longer declared under that name').toBeGreaterThan(-1)
    const props = source.slice(start, source.indexOf('\n};', start))
    for (const prop of ['helperText', 'tooltip', 'icon', 'preview', 'busy']) {
      expect(props, `Upload declares no \`${prop}\` prop`).toMatch(
        new RegExp(`\\b${prop}\\?:`),
      )
    }
    /* And no boolean beside a slot — the collapse the entry actually claims. */
    expect(props).not.toMatch(/\bshow[A-Z]\w*\?:/)
  })

  it('records the four states Upload invents, each naming what Figma publishes instead', () => {
    const upload = contract.Upload.divergences ?? []
    /* One entry PER state, not one covering all four: a reader has to be able to tell "we added
       this" from "Figma has this" for each, and a single lumped entry cannot say that. */
    const matched = new Set<unknown>()
    for (const state of ['drag-over', 'busy', 'preview', 'failure']) {
      const entry = upload.find((d) => d.figma.includes(state) || d.ours.includes(state))
      expect(entry, `no divergence records \`${state}\``).toBeTruthy()
      expect(entry!.figma).toMatch(/\bno\b/)
      matched.add(entry)
    }
    /* DISTINCT, which is the whole assertion. Without this the loop above is satisfied by ONE
       record that happens to mention all four words — the exact consolidation the comment says
       it prevents, passing green. */
    expect(matched.size, 'the four states share fewer than four divergence records').toBe(4)
  })

  it('records the three divergences slice 1 reasoned about', () => {
    expect(contract.Button.booleans).toContain('disabled')
    expect(contract.Button.axes.color).not.toContain('disable')
    expect(contract.TextField.booleans).toEqual(['error', 'disabled'])
    expect(contract.Button.axes.width).toEqual(['auto', 'full'])
  })

  it('the web Dialog accepts every boolean its contract entry lists', () => {
    const src = readFileSync(join(__dirname, '../primitives/Dialog/Dialog.tsx'), 'utf8')
    for (const b of contract.Dialog.booleans ?? []) {
      expect(src, `Dialog.tsx has no \`${b}\` prop`).toMatch(new RegExp(`\\b${b}\\??:\\s*boolean`))
    }
  })

  it('publishes only the weights each role actually has', () => {
    expect(TEXT_ROLE_WEIGHTS.display).toEqual(['bold', 'semibold'])
    expect(TEXT_ROLE_WEIGHTS.h1).toEqual(['bold', 'semibold'])
    expect(TEXT_ROLE_WEIGHTS.paragraph).toHaveLength(4)
    expect(Object.keys(TEXT_ROLE_WEIGHTS)).toEqual([...TEXT_ROLES])
  })
})
