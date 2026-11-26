import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard for the button rule (guideline section 6, UMK-2018): a group of two or more action buttons is an
 * `ActionRow` (components/action-row.tsx), never an ad-hoc flex or grid row, because only the wrapper keeps the
 * labels on one line, the height fixed, and stacks the group on a phone. A "group" is a container whose direct
 * children (by indentation) include two or more `<Button` that are labelled actions: not `type="text"`, `iconOnly`
 * or `size="compact" | "micro"` (toolbar, table-row and keypad buttons, which are not an action pair).
 */
const SRC = join(__dirname)

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx$/.test(n) ? [p] : []
  })
}

const indentOf = (l: string) => l.length - l.trimStart().length

/** Opening tags of `<Button ...>` may span lines: join up to the line that closes the tag. */
function buttonTag(lines: string[], i: number): string {
  let s = ''
  for (let k = i; k < lines.length && k < i + 14; k++) {
    s += lines[k] + ' '
    if (/>\s*$/.test(lines[k]) && !/=>\s*$/.test(lines[k])) break
  }
  return s
}

export function findAdHocGroups(src: string): number[] {
  const lines = src.split('\n')
  const bad: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)<(div|span|p|footer|form|fieldset)\b[^>]*>\s*$/.exec(lines[i])
    if (!m) continue
    const ind = m[1].length
    let n = 0
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue
      if (indentOf(lines[j]) <= ind) break
      if (indentOf(lines[j]) !== ind + 2 || !lines[j].trimStart().startsWith('<Button')) continue
      const tag = buttonTag(lines, j)
      if (/type="text"|iconOnly|size="(compact|micro)"/.test(tag)) continue
      n++
    }
    if (n >= 2) bad.push(i + 1)
  }
  return bad
}

describe('button groups', () => {
  it('flags an ad-hoc row of two action buttons (the guard sees what it guards)', () => {
    const row = [
      '<div className="flex justify-end gap-2">',
      '  <Button type="outline">Batal</Button>',
      '  <Button>Simpan</Button>',
      '</div>',
    ].join('\n')
    expect(findAdHocGroups(row)).toEqual([1])
    expect(findAdHocGroups(row.replace('div', 'ActionRow').replace('/div', '/ActionRow'))).toEqual([])
  })

  it('every pair of action buttons in pos-web goes through ActionRow', () => {
    const offenders: string[] = []
    for (const f of files(SRC)) {
      for (const line of findAdHocGroups(readFileSync(f, 'utf8'))) offenders.push(`${f.slice(SRC.length + 1)}:${line}`)
    }
    expect(offenders, 'wrap these button groups in <ActionRow> (components/action-row.tsx)').toEqual([])
  })
})
