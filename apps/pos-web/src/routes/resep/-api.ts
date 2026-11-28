import { isRedirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { refusalOf } from '@/lib/refusal'
import type { Recipe, RecipePayload, RecipeSummary, SuggestedPrice } from './-recipe'

// Server functions of the recipe screens (UMK-2125). pos-api computes every cost; these only relay.
// A mutation returns a Result instead of throwing, so forms and `act()` can show the toast or the error dialog.

export type Result<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; errors?: Record<string, string>; status?: number }

export type PickerProduct = { id: string; name: string; sku: string; unit: string }
export type PickerKind = 'ingredient' | 'sale'

const enc = encodeURIComponent
const OFFLINE = 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.'
const LOAD_ERRORS: Record<number, string> = {
  403: 'Anda tidak punya izin untuk ini.',
  404: 'Resep tidak ditemukan, mungkin sudah dihapus.',
}

async function load<T>(path: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new Error(LOAD_ERRORS[res.status] ?? 'Gagal memuat data resep.')
  return (await res.json()) as T
}

async function send<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  const res = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }).catch((e: unknown) => {
    if (isRedirect(e)) throw e // session ended: go to sign-in
    return null
  })
  if (!res) return { ok: false, error: OFFLINE, status: 0 }
  if (res.ok) return { ok: true, data: (res.status === 204 ? undefined : await res.json().catch(() => undefined)) as T }
  const r = await refusalOf(res)
  return { ok: false, ...r }
}

export const loadRecipes = createServerFn().handler(async () => (await load<{ data: RecipeSummary[] }>('/recipes')).data)

export const loadRecipe = createServerFn()
  .validator((id: string) => id)
  .handler(({ data }) => load<Recipe>(`/recipes/${enc(data)}`))

/** What the editor's pickers need: the other recipes (sub-recipes) and the product names already holding a recipe. */
export const loadRecipeChoices = createServerFn().handler(async () => {
  const [recipes, ingredients, products] = await Promise.all([
    load<{ data: RecipeSummary[] }>('/recipes'),
    pickerPage('', 'ingredient'),
    pickerPage('', 'sale'),
  ])
  return { recipes: recipes.data, ingredients, products }
})

async function pickerPage(q: string, kind: PickerKind): Promise<PickerProduct[]> {
  const params = new URLSearchParams({ perPage: '20' })
  // Ingredients come from the stock list; the recipe's own product is anything sold (never an ingredient).
  if (kind === 'ingredient') {
    params.set('use', 'stock')
    params.set('type', 'ingredient')
  } else params.set('use', 'sale')
  const term = q.trim().slice(0, 100)
  if (term) params.set('q', term)
  const page = await load<{ data: (PickerProduct & Record<string, unknown>)[] }>(`/catalog/products?${params}`)
  return page.data.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit }))
}

export const searchPickerProducts = createServerFn()
  .validator((d: { q: string; kind: PickerKind }) => ({ q: String(d.q ?? ''), kind: d.kind === 'sale' ? ('sale' as const) : ('ingredient' as const) }))
  .handler(({ data }) => pickerPage(data.q, data.kind))

export const createRecipe = createServerFn({ method: 'POST' })
  .validator((d: RecipePayload & { productId: string }) => d)
  .handler(({ data }) => send<Recipe>('/recipes', 'POST', data))

export const updateRecipe = createServerFn({ method: 'POST' })
  .validator((d: { id: string; body: RecipePayload }) => d)
  .handler(({ data }) => send<Recipe>(`/recipes/${enc(data.id)}`, 'PATCH', data.body))

export const deleteRecipe = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => send<undefined>(`/recipes/${enc(data)}`, 'DELETE'))

/** "Pakai harga modal": pos-api answers 422 with the reason (missing cost, deleted ingredient, above the selling price). */
export const applyRecipeCost = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data }) => send<{ productId: string; costPrice: number; sellingPrice: number }>(`/recipes/${enc(data)}/apply-cost`, 'POST'))

export const setIngredientCost = createServerFn({ method: 'POST' })
  .validator((d: { productId: string; cost: number; perQty: number }) => d)
  .handler(({ data: { productId, ...body } }) => send<{ cost: number; perQty: number }>(`/ingredient-costs/${enc(productId)}`, 'PUT', body))

export const removeIngredientCost = createServerFn({ method: 'POST' })
  .validator((productId: string) => productId)
  .handler(({ data }) => send<undefined>(`/ingredient-costs/${enc(data)}`, 'DELETE'))

/** UMK-2126: the suggested price for another target margin (pos-api computes it; 422 outside 1..90 is a Result). */
export const loadSuggestedPrice = createServerFn()
  .validator((d: { id: string; targetMargin: number }) => d)
  .handler(async ({ data }) => {
    const res = await send<Recipe>(`/recipes/${enc(data.id)}?targetMargin=${Number(data.targetMargin)}`, 'GET')
    return res.ok ? ({ ok: true, data: res.data.suggestedPrice } as Result<SuggestedPrice | null>) : res
  })

/** "Pakai harga jual": the owner's own change of the selling price, through the catalog route (`catalog.manage`). */
export const setSellingPrice = createServerFn({ method: 'POST' })
  .validator((d: { productId: string; price: number }) => d)
  .handler(({ data }) => send<{ id: string }>(`/catalog/products/${enc(data.productId)}`, 'PATCH', { sellingPrice: data.price }))

/**
 * pos-api's refusal of producing this recipe (a recipe used as a sub-recipe, a deleted ingredient, a product without stock),
 * read from the production plan for one batch. Null when producing is allowed or the plan could not be read: the production
 * screen has its own error states, so a failed read never blocks the button.
 */
export const loadProductionRefusal = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data }): Promise<{ code: string; message: string } | null> => {
    const res = await api(`/production-runs/plan?recipeId=${enc(data)}&batches=1`).catch((e: unknown) => {
      if (isRedirect(e)) throw e
      return null
    })
    if (!res?.ok) return null
    const plan = (await res.json().catch(() => null)) as { refusal?: { code: string; message: string } | null } | null
    return plan?.refusal ?? null
  })
