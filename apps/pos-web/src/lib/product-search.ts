// Pure helpers of the line pickers (purchase, stock opname): which products a search asks for and which
// options the list shows. The search itself is pos-api's `GET /catalog/products?q=` (name, SKU or barcode).

export type PickerProduct = {
  id: string
  name: string
  sku: string
  costPrice: number
}
export type PickerOption = { value: string; label: string; hint: string }

/** Rows per search. A store of 500+ products is paged by the search term, never loaded whole. */
export const PICKER_PAGE_SIZE = 20
export const PICKER_DEBOUNCE_MS = 250

/** The search term as pos-api receives it: trimmed, at most 100 characters (its `q` limit). */
export const normalizeQuery = (raw: string): string => raw.trim().slice(0, 100)

/** pos-api path for one page of stock-tracked products matching `raw` (empty: the first page). */
export function searchPath(raw: string): string {
  const q = normalizeQuery(raw)
  const params = new URLSearchParams({
    type: 'product',
    perPage: String(PICKER_PAGE_SIZE),
  })
  if (q) params.set('q', q)
  return `/catalog/products?${params.toString()}`
}

/**
 * The options for one picker: the search results, plus the picked product when the results no longer hold it
 * (the owner searched for something else after picking), so the trigger keeps showing its name.
 */
export function pickerOptions(results: readonly PickerProduct[], picked: PickerProduct | undefined): PickerOption[] {
  const rows = picked && !results.some((p) => p.id === picked.id) ? [picked, ...results] : results
  return rows.map((p) => ({ value: p.id, label: p.name, hint: p.sku }))
}

/** Remember every product a search returned, so a pick can read its cost later. Returns a new map. */
export function remember(known: ReadonlyMap<string, PickerProduct>, seen: readonly PickerProduct[]) {
  const next = new Map(known)
  for (const p of seen) next.set(p.id, p)
  return next
}

/** Keeps only the newest of overlapping requests: `next()` numbers a request, `isLatest(n)` says whether it still counts. */
export function latestOnly() {
  let n = 0
  return { next: () => ++n, isLatest: (x: number) => x === n }
}
