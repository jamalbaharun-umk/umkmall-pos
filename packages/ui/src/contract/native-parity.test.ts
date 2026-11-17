/**
 * The contract, checked against the NATIVE half of the library.
 *
 * Every other guard in this package runs contract → web code, or (UMK-900) code → contract.
 * This one runs **contract → native**, which nothing did. The gap it closes is not a variant
 * the contract has never heard of — that is UMK-900's direction — but the opposite: a variant
 * the contract DOES declare that the native sibling simply does not accept. The prop is
 * absent, so nothing fails to compile; the screen that wanted it quietly renders the default.
 * Five such gaps were live when this file was written, against a fully green suite on both
 * packages.
 *
 * SITED IN `packages/ui`, DELIBERATELY. `turbo.json`'s `test` task is cacheable with no
 * `inputs` or `dependsOn`, so a task hash covers a package's own files and not its workspace
 * dependencies'. The same guard written in `apps/mobile` would replay a cached PASS over a
 * live regression here.
 * See docs/solutions/conventions/a-guard-test-only-guards-its-own-package.md
 *
 * THE CONTRACT IS IMPORTED, NOT PARSED. A regex over `variants.ts` is the obvious way to
 * write this and it is the vacuous one: a pattern that stops matching yields zero entries,
 * every loop below runs zero times, and the suite goes green over a contract nobody read.
 * The real object cannot go quiet that way. Only the NATIVE side is read as text, because
 * `react-native`'s entry is Flow and will not load under vitest — the same reason
 * `native/__tests__/exports.test.ts` scans instead of importing.
 *
 * PROVED RED, one injection per assertion (UMK-986, plus the UMK-1371 row). Seven of nine isolate to exactly one
 * failing assertion. Two cannot, and the reason is the data model rather than a weak test —
 * recorded here so a later reader does not credit the red to the wrong assertion (UMK-958):
 *
 * | Injection | Reds |
 * | -- | -- |
 * | An unread axis added to an `implemented` entry | 1 — axis coverage |
 * | A `partial`'s `missingAxes` no longer matching the module | 1 — partial exactness |
 * | A `partial` reason truncated below the floor | 1 — argues itself |
 * | `Toaster` dropped from the allowlist | 1 — unclaimed component |
 * | `theme.ts` re-declaring `TextColor` locally | 1 — alias derivation |
 * | A `partial` flipped to `implemented` | 1 — axis coverage |
 * | An `implemented` entry flipped to `absent` | **2** — stale absence AND unclaimed, because
 *   an absent entry also leaves the `claimed` set the last assertion is built from |
 * | An `implemented` entry pointed at a missing module | **3** — the module read, plus the two
 *   assertions that go on to read that same path |
 * | `labelSize?: string` declared in native `TextField.tsx`, where the entry records it as
 *   missing (UMK-1371, run 2026-10-12) | 1 — no stale missing prop |
 *
 * The bucket floor is the one assertion with no isolating injection: emptying a bucket
 * requires flipping every entry in it, and each flip independently reds a per-entry
 * assertion first. It is a backstop against a total collapse, not a primary check, and is
 * documented as such rather than dressed up with a proof it does not have.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contract, TEXT_COLORS, TEXT_ROLES, TEXT_WEIGHTS, type ComponentContract } from './variants'
import { NATIVE_COMPONENTS } from '../native/__tests__/exports.test'

const NATIVE_DIR = resolve(__dirname, '..', 'native')

/** The module a contract key maps to, honouring an explicit `module` override. */
const moduleName = (name: string, entry: ComponentContract): string =>
  ('module' in entry.native && entry.native.module) || name

const modulePath = (name: string, entry: ComponentContract): string =>
  resolve(NATIVE_DIR, `${moduleName(name, entry)}.tsx`)

/**
 * THE SECOND CHANNEL, and the one that made this guard wrong on its first run.
 *
 * Three contract axes are declared as references to exported constants rather than inline
 * arrays — `Text`'s `role`, `weight` and `color` are `TEXT_ROLES`, `TEXT_WEIGHTS`,
 * `TEXT_COLORS`. `native/theme.ts` derives a type alias from each (`export type TextColor =
 * (typeof TEXT_COLORS)[number]`) and `native/Text.tsx` spells the alias. That IS reading the
 * axis out of the contract; it just does not spell `Of<'color'>`, and a detector that knows
 * only the direct form reports a fully implemented component as missing all three.
 *
 * Matched by ARRAY IDENTITY, not by axis name. `contract.Text.axes.color` and `TEXT_COLORS`
 * are the same object, so this cannot drift onto an unrelated axis that happens to be called
 * `color` — `Button.color` is a different array and stays on the direct form.
 */
const SHARED_VOCABULARY: readonly { values: readonly string[]; alias: RegExp }[] = [
  { values: TEXT_ROLES, alias: /\bTextRole\b/ },
  { values: TEXT_WEIGHTS, alias: /\bTextWeight\b|\bWeightFor</ },
  { values: TEXT_COLORS, alias: /\bTextColor\b/ },
]

/**
 * Does this native source read the named axis OUT OF THE CONTRACT?
 *
 * The contract-derived forms only — `Of<'x'>`, `Axes['x']`, or the shared-vocabulary alias
 * above. A looser signal was tried first and rejected: matching the bare prop name
 * (`treatment?:`) also matches a local variable, a comment or an unrelated field, so it
 * reports an axis as covered whenever the word appears anywhere in the file. Each form here
 * can only be written by a component that actually reached for the contract.
 */
const readsAxis = (source: string, axis: string, values: readonly string[]): boolean => {
  if (new RegExp(`Of<'${axis}'>|Axes\\['${axis}'\\]`).test(source)) return true
  const shared = SHARED_VOCABULARY.find((v) => v.values === values)
  return shared ? shared.alias.test(source) : false
}

const entries = Object.entries(contract) as [string, ComponentContract][]
const withSibling = entries.filter(([, e]) => e.native.state !== 'absent')
const implemented = entries.filter(([, e]) => e.native.state === 'implemented')
const partial = entries.filter(([, e]) => e.native.state === 'partial')
const absent = entries.filter(([, e]) => e.native.state === 'absent')

describe('every contract entry states what native does with it', () => {
  /**
   * THE ANTI-VACUITY FLOOR, per BUCKET rather than per total (UMK-958). A total of 42 stays
   * green while one whole bucket empties — and an empty bucket is exactly how this guard
   * would stop meaning anything, because every assertion below iterates one of them.
   */
  it('sorts all 67 entries into three non-empty buckets', () => {
    expect(entries).toHaveLength(67)
    expect(implemented.length).toBeGreaterThan(15)
    expect(partial.length).toBeGreaterThan(0)
    /* Sized to the bucket EMPTYING, not to today's count — it started at 19 and drops with
       every component built, so a floor near the current number would need editing on each
       port and would stop being read. */
    expect(absent.length).toBeGreaterThan(3)
    expect(implemented.length + partial.length + absent.length).toBe(entries.length)
  })

  it('reads a real, non-trivial native module for every entry claiming one', () => {
    for (const [name, entry] of withSibling) {
      const path = modulePath(name, entry)
      expect(existsSync(path), `${name}: native.state is '${entry.native.state}' but ${path} does not exist`).toBe(true)
      /* A file read that silently returns nothing would make every axis below report as
         missing on an `implemented` entry — loud — but would make a `partial` entry's
         recorded gap look complete. So the read is asserted here, once, per module. */
      expect(readFileSync(path, 'utf8').length, `${name}: native module is empty`).toBeGreaterThan(200)
    }
  })

  /**
   * The stale-absence check, and the half people forget. "No native sibling" is a claim with
   * a shelf life: the moment someone builds one under UMK-952's on-demand rule, this entry is
   * lying in the other direction and no other assertion here would notice.
   */
  it('has no native module for an entry recorded absent', () => {
    for (const [name, entry] of absent) {
      const path = modulePath(name, entry)
      expect(
        existsSync(path),
        `${name}: recorded absent, but ${path} exists — build it and the record must say 'implemented' or 'partial'`,
      ).toBe(false)
    }
  })

  it('finds every declared axis in the module of an implemented entry', () => {
    for (const [name, entry] of implemented) {
      const source = readFileSync(modulePath(name, entry), 'utf8')
      const missing = Object.entries(entry.axes)
        .filter(([axis, values]) => !readsAxis(source, axis, values))
        .map(([axis]) => axis)
      expect(missing, `${name} claims full native parity but reads no contract axis ${missing.join(', ')}`).toEqual([])
    }
  })

  /**
   * EXACTLY the recorded gap — not "at least". Both directions matter and only one of them
   * is obvious: a gap that GROWS must red, and so must a gap that someone CLOSES, because a
   * closed gap still recorded as open is how this file rots into a list of things that used
   * to be true.
   */
  it('finds exactly the recorded gap on a partial entry, no more and no fewer', () => {
    for (const [name, entry] of partial) {
      if (entry.native.state !== 'partial') continue
      const source = readFileSync(modulePath(name, entry), 'utf8')
      const found = Object.entries(entry.axes)
        .filter(([axis, values]) => !readsAxis(source, axis, values))
        .map(([axis]) => axis)
      expect([...found].sort(), `${name}: recorded missingAxes do not match what the module reads`).toEqual(
        [...(entry.native.missingAxes ?? [])].sort(),
      )
    }
  })

  /**
   * THE PROP HALF OF "A CLOSED GAP MUST RED" (UMK-1371). `missingProps` is recorded and not
   * enumerated — prop names are not contract vocabulary, so nothing here can say which props a
   * native module SHOULD have. What can be said is the stale direction: a name recorded as
   * missing that the native module now DECLARES. Until this assertion that record stayed green
   * for good, and seven of the ten entries UMK-1371 closed were prop-only gaps the guard above
   * never looked at.
   *
   * A DECLARATION, not a mention: `name?:` or `name:` in the comment-stripped source. Records
   * that are not a bare prop name (`size="xsmall"`, `option.detail`, `aria-label`) are a value
   * or a path rather than a declaration and are skipped — they stay hand-kept.
   *
   * It cannot see the opposite drift: a prop the web gains tomorrow that nobody records.
   *
   * NOR A PROP THAT ARRIVES WITHOUT BEING SPELLED. The match is on the name followed by `:` in the
   * module's own text, so a prop the interface gains by inheritance or a mapped type —
   * `extends Pick<TextInputProps, 'spellCheck'>`, `extends PressableProps` — is declared and
   * invisible here: the record stays, stale and green. Closing a gap that way means removing the
   * record by hand.
   */
  it('records no missing prop the native module now declares', () => {
    /* Line comments first — see docs/solutions/conventions/a-comment-can-blind-a-regex-guard-test.md */
    const code = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '')
    let checked = 0
    for (const [name, entry] of partial) {
      if (entry.native.state !== 'partial') continue
      const source = code(readFileSync(modulePath(name, entry), 'utf8'))
      const stale = (entry.native.missingProps ?? [])
        .filter((prop) => /^[A-Za-z]+$/.test(prop))
        .filter((prop) => {
          checked += 1
          return new RegExp(`(^|[\\s{;,(])${prop}\\??:`, 'm').test(source)
        })
      expect(stale, `${name}: recorded as missing, but the native module declares ${stale.join(', ')}`).toEqual([])
    }
    /* The records thinning to nothing would make every filter above run zero times. */
    expect(checked, 'checked no recorded prop at all — the loop went dark').toBeGreaterThan(10)
  })

  it('makes every partial and absent entry argue itself', () => {
    for (const [name, entry] of [...partial, ...absent]) {
      if (entry.native.state === 'implemented') continue
      expect(entry.native.reason.length, `${name}: needs a reason, not a bare state`).toBeGreaterThan(40)
      if (entry.native.state === 'partial') {
        expect(entry.native.owner, `${name}: a partial entry needs the ticket that closes it`).toMatch(/^UMK-\d+$/)
        const recorded = [...(entry.native.missingAxes ?? []), ...(entry.native.missingProps ?? [])]
        expect(recorded.length, `${name}: partial but records nothing missing`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The reverse direction, scoped to what this guard can see: a native component that no
   * contract entry claims.
   *
   * The component list is IMPORTED from `native/__tests__/exports.test.ts` rather than
   * re-parsed here. That file already holds the enumerated, order-asserted list and is the
   * thing a new sibling reddens first; a second hand-parse in this file would be a third
   * place to keep the same list, and the one that silently disagrees.
   *
   * `Toaster` is the one legitimate unclaimed name — a host rather than a variant-bearing
   * component, with no contract entry at all. UMK-900 owns reasoning that allowlist, so it
   * is named here rather than skipped by silence.
   */
  it('publishes no native component the contract does not claim', () => {
    expect(NATIVE_COMPONENTS.length, 'imported no native component list — the link went dark').toBeGreaterThan(20)

    /**
     * Compound exports of ONE contract entry — `Tabs` publishes four names.
     *
     * `Toaster` WAS HERE and is not: it had no contract entry at all until UMK-979, so it was
     * allowlisted as "the one entry-less host". It has one now, which is what made its native
     * gap visible — the allowlist was excusing a component the contract had started to claim.
     */
    const CLAIMED_ELSEWHERE = new Set(['TabsList', 'TabsTrigger', 'TabsContent'])
    const claimed = new Set(withSibling.map(([name, entry]) => moduleName(name, entry)))
    const unclaimed = NATIVE_COMPONENTS.filter((n) => !claimed.has(n) && !CLAIMED_ELSEWHERE.has(n))
    expect(unclaimed, 'native publishes these with no contract entry claiming a sibling').toEqual([])
  })

  /**
   * The second channel, asserted rather than assumed. `readsAxis` treats a `TextColor` in a
   * native module as proof the contract was read — which is only true while `theme.ts`
   * actually derives that alias from the contract's own constant. If someone re-declares it
   * locally, every `Text` axis silently reverts to "covered" on evidence that no longer
   * means anything, and nothing else here would catch it.
   */
  it('derives the shared-vocabulary aliases from the contract, which is what makes them evidence', () => {
    const theme = readFileSync(resolve(NATIVE_DIR, 'theme.ts'), 'utf8')
    expect(theme).toMatch(/import\s*\{[^}]*\}\s*from\s*'\.\.\/contract'/)
    for (const [alias, source] of [
      ['TextColor', 'TEXT_COLORS'],
      ['TextRole', 'TEXT_ROLES'],
      ['TextWeight', 'TEXT_WEIGHTS'],
    ]) {
      expect(theme, `${alias} must be derived from the contract's ${source}`).toMatch(
        new RegExp(`export type ${alias} = \\(typeof ${source}\\)\\[number\\]`),
      )
    }
  })
})
