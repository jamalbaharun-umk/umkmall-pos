// Pure form checks shared by the ui-parity-b forms (no React, no server): unit-tested on their own.

export type FieldErrors = Record<string, string>

/** Client checks mirroring the zod rules, so an obviously wrong form never reaches the server. */
export const check = {
  /** pos-api's `Phone`: digits (spaces/dashes allowed), optional leading +, 8–15 digits. Blank is fine. */
  phone: (v: string) => {
    const t = v.trim()
    if (!t) return undefined
    const digits = t.replace(/\D/g, '').length
    return /^\+?[0-9][0-9 -]{6,18}[0-9]$/.test(t) && digits >= 8 && digits <= 15
      ? undefined
      : 'Nomor telepon tidak valid'
  },
  required: (v: string) => (v.trim() ? undefined : 'Wajib diisi'),
  wholeNumber: (v: string, { min = 0, max = Number.MAX_SAFE_INTEGER, label = 'Jumlah' } = {}) => {
    if (!v.trim()) return `${label} wajib diisi`
    if (/^-\d+$/.test(v.trim())) return `${label} tidak boleh negatif`
    if (!/^\d+$/.test(v.trim())) return `${label} harus bilangan bulat`
    const n = Number(v.trim())
    if (n < min) return min === 1 ? `${label} harus lebih dari 0` : `${label} minimal ${min}`
    if (n > max) return `${label} maksimal ${max.toLocaleString('id-ID')}`
    return undefined
  },
}

/** Drops undefined entries: `{ name: undefined }` means the field is fine. */
export const compact = (e: Record<string, string | undefined>): FieldErrors =>
  Object.fromEntries(Object.entries(e).filter((x): x is [string, string] => !!x[1]))

/** The errors without `keys`: an edited field stops showing its old message. Same object when nothing changes. */
export const clearKeys = (errors: FieldErrors, keys: string[]): FieldErrors =>
  keys.some((k) => k in errors) ? Object.fromEntries(Object.entries(errors).filter(([k]) => !keys.includes(k))) : errors
