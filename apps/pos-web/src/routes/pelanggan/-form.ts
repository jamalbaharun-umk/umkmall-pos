// Client-side checks for the U7 forms. They mirror pos-api's zod rules (common/validation.ts) so a person sees
// the same Indonesian message before submitting; the server still validates and its field errors win.

export type Values = Record<string, string>
export type Errors = Record<string, string>

export type Field = {
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'phone'
  options?: { label: string; value: string }[]
  optional?: boolean
  placeholder?: string
  max?: number
  noSpaces?: boolean
  /** Extra rule across fields (percentage ≤ 100, dates ordered): a message, or undefined when fine. */
  check?: (value: string, values: Values) => string | undefined
}

/** "10.000" or "10000" → 10000; anything else (decimals, letters) → NaN. */
export function parseRupiah(raw: string): number {
  const v = raw.trim()
  if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(v)) return Number.NaN
  return Number(v.replace(/\./g, ''))
}

const isRealDate = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const t = Date.parse(`${d}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d)
}

export const isPhone = (p: string) => {
  const digits = p.replace(/\D/g, '').length
  return /^\+?[0-9][0-9 -]{6,18}[0-9]$/.test(p.trim()) && digits >= 8 && digits <= 15
}

/** Field → message for every rule the value breaks (first rule per field). */
export function checkFields(fields: Field[], values: Values): Errors {
  const errors: Errors = {}
  for (const f of fields) {
    const v = (values[f.name] ?? '').trim()
    const fail = (m: string) => (errors[f.name] ??= m)
    if (!v) {
      if (!f.optional) fail('Wajib diisi')
      continue
    }
    if (f.max && v.length > f.max) fail(`Maksimal ${f.max} karakter`)
    if (f.noSpaces && /\s/.test(v)) fail('Kode tanpa spasi')
    if (f.type === 'number' && Number.isNaN(parseRupiah(v))) fail('Harus bilangan bulat')
    if (f.type === 'date' && !isRealDate(v)) fail('Tanggal tidak valid')
    if (f.type === 'phone' && !isPhone(v)) fail('Nomor telepon tidak valid')
    const extra = f.check?.(v, values)
    if (extra) fail(extra)
  }
  return errors
}

/** Form strings → API body: numbers parsed, blank optional fields sent as null (numbers omitted). */
export function toBody(fields: Field[], values: Values) {
  return Object.fromEntries(
    fields.flatMap((f): [string, unknown][] => {
      const raw = (values[f.name] ?? '').trim()
      if (f.type === 'number') return raw === '' ? [] : [[f.name, parseRupiah(raw)]]
      return [[f.name, raw === '' && f.optional ? null : raw]]
    }),
  )
}
