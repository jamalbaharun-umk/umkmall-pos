/** What a refused save tells a form: a toast-safe message and, when the API named them, per-field messages. */
export type Refusal = { error: string; errors?: Record<string, string> }

export const GENERIC_ERROR = 'Terjadi kesalahan. Coba lagi sebentar lagi.'

/** Reads pos-api's `{ message, errors }` refusal body; a 5xx or unreadable body becomes a generic message. */
export async function refusalOf(res: Response): Promise<Refusal> {
  const body = (await res.json().catch(() => ({}))) as { message?: unknown; errors?: unknown }
  if (res.status >= 500 || typeof body.message !== 'string') return { error: GENERIC_ERROR }
  const errors =
    body.errors && typeof body.errors === 'object' ? (body.errors as Record<string, string>) : undefined
  return errors ? { error: body.message, errors } : { error: body.message }
}

/**
 * Splits field errors by the form's own field names: `fields` go on their inputs (a nested path like `barcodes.0`
 * goes to its list field), the rest is a form-level message. Returns the form-level text, or undefined.
 */
export function placeErrors(
  refusal: Refusal,
  fields: readonly string[],
): { byField: Record<string, string>; formError?: string } {
  const byField: Record<string, string> = {}
  const rest: string[] = []
  for (const [path, message] of Object.entries(refusal.errors ?? {})) {
    const field = fields.find((f) => path === f || path.startsWith(`${f}.`))
    if (field) byField[path === field ? field : path] = message
    else rest.push(message)
  }
  const formError = rest.length ? rest.join(' ') : Object.keys(byField).length ? undefined : refusal.error
  return { byField, formError }
}
