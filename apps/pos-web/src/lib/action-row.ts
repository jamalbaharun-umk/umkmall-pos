/**
 * The one layout rule for a group of buttons (owner ruling 2026-11-26): a label never wraps and a button never grows
 * taller than its size; a group that does not fit at natural width STACKS, full width, primary on top.
 *
 * Convention: children are written in reading order for desktop, secondary first and the PRIMARY LAST
 * (`Batal`, `Simpan`). On a phone the column is reversed, so the primary sits on top and the secondary below it.
 *
 *  - `end` (default, dialogs and forms): a column on a phone, one right-aligned row of natural-width buttons from `sm`.
 *  - `start`: the same, left-aligned (a button group under a card or table).
 *  - `stacked`: a column at every width (a narrow card such as the receipt or the pairing screen).
 *
 * `[&>*]:` styles the direct children, so a `Button`, a `Button asChild` link or a wrapped element all get it; the
 * stretch of a flex column makes them full width without a width class.
 */
export type ActionRowAlign = 'end' | 'start'

/**
 * Guideline "Panduan Dasar UI POS" section 6 (UMK-2018): one line, a fixed 44 px height, a 12 px radius (no pill), the
 * natural width plus 18 px padding on a desktop. `!` beats the Button's own size padding and `rounded-full` (that is
 * the only way to do it without touching `packages/ui`, whose Button has no 44 px / 12 px step).
 */
const BASE = 'flex w-full gap-2 [&>*]:h-11! [&>*]:py-0! [&>*]:rounded-[12px]! [&>*]:shrink-0 [&>*]:whitespace-nowrap sm:[&>*]:px-[18px]!'

export function actionRowClass(opts: { align?: ActionRowAlign; stacked?: boolean; className?: string } = {}): string {
  const { align = 'end', stacked = false, className } = opts
  const layout = stacked
    ? 'flex-col-reverse'
    : `flex-col-reverse sm:flex-row sm:items-center ${align === 'end' ? 'sm:justify-end' : 'sm:justify-start'}`
  return [BASE, layout, className].filter(Boolean).join(' ')
}
