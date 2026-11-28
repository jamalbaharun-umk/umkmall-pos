import { useRouter } from '@tanstack/react-router'
import { Button, SegmentedControl, Select, TextField } from '@umkmall/ui'
import { Trash2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { ActionRow } from '@/components/action-row'
import { Panel } from '@/components/page'
import { act, ErrorText, type FieldErrors } from '@/components/pos-page'
import { clearKeys } from '@/lib/form-checks'
import { createRecipe, type PickerProduct, updateRecipe } from './-api'
import { ProductSearchSelect } from './-picker'
import {
  buildPayload,
  draftOf,
  emptyDraft,
  type LineDraft,
  newLine,
  type Recipe,
  type RecipeDraft,
  type RecipeSummary,
  validateDraft,
} from './-recipe'

export type Choices = { recipes: RecipeSummary[]; ingredients: PickerProduct[]; products: PickerProduct[] }

const KIND = [
  { value: 'ingredient', label: 'Bahan' },
  { value: 'sub_recipe', label: 'Sub-resep' },
] as const

/**
 * The recipe form, shared by "Resep baru" and "Ubah resep". pos-api checks every rule again (cycles, depth, deleted
 * ingredients) and answers 422 with a field path; those messages land on the same fields, the rest in the error dialog.
 */
export function RecipeEditor({
  recipe,
  choices,
  onCancel,
  onSaved,
}: {
  recipe?: Recipe
  choices: Choices
  onCancel: () => void
  onSaved: (id: string) => void | Promise<void>
}) {
  const router = useRouter()
  const creating = !recipe
  const [d, setD] = useState<RecipeDraft>(() => (recipe ? draftOf(recipe) : emptyDraft()))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  // Names of what the saved lines already use, so a picker shows them before any search.
  const known: PickerProduct[] = (recipe?.lines ?? []).flatMap((l) =>
    l.kind === 'ingredient' && l.ingredientId ? [{ id: l.ingredientId, name: l.name ?? 'Bahan dihapus', sku: '', unit: l.unit ?? '' }] : [],
  )
  const subOptions = choices.recipes
    .filter((r) => r.id !== recipe?.id)
    .map((r) => ({ value: r.id, label: r.product.name, hint: `${r.yieldQty} ${r.yieldUnit}` }))
  const taken = new Set(choices.recipes.map((r) => r.product.id))
  const productOptions = choices.products.filter((p) => !taken.has(p.id))

  const set = (patch: Partial<RecipeDraft>, ...keys: string[]) => {
    setD((x) => ({ ...x, ...patch }))
    setErrors((e) => clearKeys(e, keys))
  }
  const setLine = (key: string, patch: Partial<LineDraft>, i: number) => {
    setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
    setErrors((e) => clearKeys(e, [`lines.${i}.ingredientId`, `lines.${i}.subRecipeId`, `lines.${i}.quantity`, `lines.${i}.wastePercent`, 'lines']))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const local = validateDraft(d, { creating })
    setErrors(local)
    if (Object.keys(local).length) return setFormError('Periksa kembali isian yang ditandai.')
    setFormError(undefined)
    lock.current = true
    setBusy(true)
    const body = buildPayload(d)
    const r = await act(
      () =>
        recipe
          ? updateRecipe({ data: { id: recipe.id, body } })
          : createRecipe({ data: { ...body, productId: d.productId } }),
      'Resep disimpan',
      'menyimpan resep',
    )
    lock.current = false
    setBusy(false)
    if (!r.ok) {
      setErrors(r.errors)
      return setFormError(Object.keys(r.errors).length ? 'Periksa kembali isian yang ditandai.' : undefined)
    }
    const saved = (r.res as { data?: Recipe }).data
    await router.invalidate()
    await onSaved(saved?.id ?? recipe!.id)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {creating && (
        <Panel className="p-4 md:p-6">
          <h2 className="mb-3 font-semibold text-default-primary">Produk yang dijual</h2>
          <ProductSearchSelect
            label="Produk"
            kind="sale"
            value={d.productId}
            initial={productOptions}
            error={errors.productId}
            onPick={(p) => set({ productId: p.id }, 'productId')}
          />
          <p className="mt-2 text-sm text-default-secondary">Satu produk punya satu resep. Bahan baku tidak punya resep.</p>
        </Panel>
      )}

      <Panel className="p-4 md:p-6">
        <h2 className="mb-3 font-semibold text-default-primary">Bahan dan sub-resep</h2>
        <ul className="flex flex-col gap-4">
          {d.lines.map((l, i) => (
            <li key={l.key} className="flex flex-col gap-3 rounded-lg border border-default-secondary p-3 md:p-4">
              <SegmentedControl
                aria-label={`Jenis baris ${i + 1}`}
                size="small"
                options={KIND}
                value={l.kind}
                onChange={(kind) => setLine(l.key, { kind, refId: '' }, i)}
              />
              <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_1fr_1fr]">
                {l.kind === 'ingredient' ? (
                  <ProductSearchSelect
                    label={`Bahan ${i + 1}`}
                    kind="ingredient"
                    value={l.refId}
                    initial={choices.ingredients}
                    known={known}
                    error={errors[`lines.${i}.ingredientId`]}
                    onPick={(p) => setLine(l.key, { refId: p.id }, i)}
                  />
                ) : (
                  <Select
                    aria-label={`Sub-resep ${i + 1}`}
                    size="small"
                    showSearch
                    placeholder="Pilih sub-resep"
                    emptyMessage="Belum ada resep lain"
                    error={errors[`lines.${i}.subRecipeId`]}
                    options={subOptions}
                    value={l.refId || undefined}
                    onValueChange={(v) => setLine(l.key, { refId: v }, i)}
                  />
                )}
                <TextField
                  label={l.kind === 'ingredient' ? 'Takaran (satuan pakai)' : 'Takaran (porsi)'}
                  inputMode="numeric"
                  value={l.quantity}
                  error={errors[`lines.${i}.quantity`]}
                  onChange={(e) => setLine(l.key, { quantity: e.target.value }, i)}
                />
                <TextField
                  label="Susut (%)"
                  inputMode="numeric"
                  value={l.wastePercent}
                  error={errors[`lines.${i}.wastePercent`]}
                  onChange={(e) => setLine(l.key, { wastePercent: e.target.value }, i)}
                />
              </div>
              <ActionRow align="end">
                <Button
                  width="auto"
                  size="small"
                  type="text"
                  color="danger"
                  aria-label={`Hapus baris ${i + 1}`}
                  disabled={busy}
                  onClick={() => {
                    setD((x) => ({ ...x, lines: x.lines.filter((x2) => x2.key !== l.key) }))
                    setErrors({})
                  }}
                >
                  <Trash2 className="size-4" aria-hidden /> Hapus baris
                </Button>
              </ActionRow>
            </li>
          ))}
        </ul>
        {errors.lines && <p className="mt-2 text-sm text-default-error">{errors.lines}</p>}
        <div className="mt-4">
          <ActionRow align="start">
            <Button width="auto" type="outline" color="primary" disabled={busy} onClick={() => setD((x) => ({ ...x, lines: [...x.lines, newLine('ingredient')] }))}>
              Tambah bahan
            </Button>
            <Button width="auto" type="outline" color="primary" disabled={busy} onClick={() => setD((x) => ({ ...x, lines: [...x.lines, newLine('sub_recipe')] }))}>
              Tambah sub-resep
            </Button>
          </ActionRow>
        </div>
        <p className="mt-3 text-sm text-default-secondary">Takaran dalam satuan pakai bahan (gram, ml, pcs). Sub-resep maksimal 3 tingkat.</p>
      </Panel>

      <Panel className="p-4 md:p-6">
        <h2 className="mb-3 font-semibold text-default-primary">Hasil dan upah</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <TextField label="Hasil per batch" required inputMode="numeric" value={d.yieldQty} error={errors.yieldQty} onChange={(e) => set({ yieldQty: e.target.value }, 'yieldQty')} />
          <TextField label="Satuan hasil" value={d.yieldUnit} maxLength={20} error={errors.yieldUnit} onChange={(e) => set({ yieldUnit: e.target.value }, 'yieldUnit')} />
          <TextField label="Upah per batch (Rp)" inputMode="numeric" value={d.laborCost} error={errors.laborCost} onChange={(e) => set({ laborCost: e.target.value }, 'laborCost')} />
        </div>
        <div className="mt-3">
          <TextField label="Catatan" multiline rows={2} maxLength={500} value={d.note} error={errors.note} onChange={(e) => set({ note: e.target.value }, 'note')} />
        </div>
      </Panel>

      <ErrorText>{formError}</ErrorText>
      <ActionRow>
        <Button width="auto" type="outline" color="light" disabled={busy} onClick={onCancel}>
          Batal
        </Button>
        <Button width="auto" htmlType="submit" isLoading={busy}>
          Simpan resep
        </Button>
      </ActionRow>
    </form>
  )
}
