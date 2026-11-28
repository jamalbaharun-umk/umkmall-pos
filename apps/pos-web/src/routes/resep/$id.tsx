import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import {
  Alert,
  Badge,
  Button,
  DonutChart,
  Dialog,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
} from '@umkmall/ui'
import { useRef, useState, type FormEvent } from 'react'
import { ActionRow } from '@/components/action-row'
import { act, ErrorText, type FieldErrors, LoadError, Page, Pending, rupiah, useConfirm } from '@/components/pos-page'
import { Panel } from '@/components/page'
import { applyRecipeCost, deleteRecipe, loadProductionRefusal, loadRecipe, loadRecipeChoices, removeIngredientCost, setIngredientCost, setSellingPrice } from './-api'
import { RecipeEditor } from './-editor'
import { SuggestedPricePanel } from './-suggest'
import {
  applyBlocker,
  applyCostConfirm,
  buildManualCost,
  costShares,
  FLAG_TEXT,
  flagsOf,
  marginPercent,
  percentText,
  priceConfirm,
  type Recipe,
  type RecipeLine,
  unitCostText,
  validateManualCost,
} from './-recipe'

// UMK-2125, design 43: the cost of one portion, where it comes from, and the actions on it.
export const Route = createFileRoute('/resep/$id')({
  loader: async ({ params }) => {
    const [recipe, choices, refusal] = await Promise.all([loadRecipe({ data: params.id }), loadRecipeChoices(), loadProductionRefusal({ data: params.id })])
    return { recipe, choices, refusal }
  },
  component: RecipePage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

function RecipePage() {
  const { recipe: r, choices, refusal } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const { ask, dialog } = useConfirm()
  const [editing, setEditing] = useState(false)
  const [costFor, setCostFor] = useState<RecipeLine | null>(null)
  const [applying, setApplying] = useState(false)
  const [pricing, setPricing] = useState(false)
  const blocker = applyBlocker(r)
  const margin = marginPercent(r.product.sellingPrice, r.costPerPortion)
  const shares = costShares(r.lines)

  async function runApplyCost() {
    if (applying) return
    setApplying(true)
    // A 422 (a missing cost, a deleted ingredient, cost above the selling price) opens the shared error dialog with pos-api's text.
    const res = await act(() => applyRecipeCost({ data: r.id }), `Harga modal ${r.product.name} jadi ${rupiah(r.costPerPortion)}`, 'memakai harga modal')
    setApplying(false)
    if (res.ok) await router.invalidate()
  }

  // Overwrites the product's cost price, so the owner confirms the new and the old figure first.
  const applyCost = () =>
    ask(applyCostConfirm(r.costPerPortion, r.product.costPrice), runApplyCost, { label: 'Lanjutkan', color: 'primary', action: 'memakai harga modal' })

  // The owner's own change of the selling price to the suggested one: confirmed first, then the catalog route (`catalog.manage`).
  const applyPrice = (price: number) =>
    ask(
      priceConfirm(price, r.product.sellingPrice),
      async () => {
        if (pricing) return
        setPricing(true)
        const res = await act(() => setSellingPrice({ data: { productId: r.product.id, price } }), `Harga jual ${r.product.name} jadi ${rupiah(price)}`, 'mengubah harga jual')
        setPricing(false)
        if (res.ok) await router.invalidate()
      },
      { label: 'Lanjutkan', color: 'primary', action: 'mengubah harga jual' },
    )

  const remove = () =>
    ask(
      `Hapus resep ${r.product.name}?`,
      async () => {
        const res = await act(() => deleteRecipe({ data: r.id }), 'Resep dihapus', 'menghapus resep')
        if (res.ok) await navigate({ to: '/resep' })
      },
      { body: 'Produk dan harga modalnya tidak berubah. Resep yang memakai resep ini sebagai sub-resep menolak penghapusan.' },
    )

  if (editing)
    return (
      <Page crumbs={[{ label: 'Resep', to: '/resep' }, { label: r.product.name, to: '/resep/$id', params: { id: r.id } }, { label: 'Ubah' }]} title={`Ubah resep ${r.product.name}`}>
        <RecipeEditor recipe={r} choices={choices} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
      </Page>
    )

  return (
    <Page
      crumbs={[{ label: 'Resep', to: '/resep' }, { label: r.product.name }]}
      title={r.product.name}
      actions={
        <>
          <Button width="auto" type="outline" color="danger" onClick={remove}>
            Hapus resep
          </Button>
          <Button width="auto" type="outline" color="primary" onClick={() => setEditing(true)}>
            Ubah resep
          </Button>
          {/* UMK-2126: opens a production run with this recipe chosen; pos-api's refusal (for example a sub-recipe) disables it. */}
          {refusal ? (
            <Button width="auto" type="outline" color="primary" disabled>
              Produksi
            </Button>
          ) : (
            <Button width="auto" type="outline" color="primary" asChild>
              <Link to="/produksi/baru" search={{ recipeId: r.id }}>
                Produksi
              </Link>
            </Button>
          )}
          <Button width="auto" isLoading={applying} onClick={applyCost}>
            Pakai harga modal
          </Button>
        </>
      }
    >
      {(r.deletedIngredientIds.length > 0 || r.missingCostIngredientIds.length > 0) && (
        <div className="flex flex-col gap-2">
          {r.deletedIngredientIds.length > 0 && (
            <Alert variant="danger" size="small" role="alert">
              Ada bahan yang sudah dihapus dari katalog. Biayanya masih dihitung, tetapi ganti bahan itu di resep.
            </Alert>
          )}
          {r.missingCostIngredientIds.length > 0 && (
            <Alert variant="warning" size="small" role="alert">
              Ada bahan yang belum punya harga, jadi biaya per porsi belum lengkap. Isi pembelian atau atur harga manual.
            </Alert>
          )}
        </div>
      )}

      {refusal && (
        <Alert variant="info" size="small" role="status">
          Produksi belum bisa dicatat dari resep ini. {refusal.message}.
        </Alert>
      )}

      <section aria-label="Biaya" className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Biaya per porsi" value={rupiah(r.costPerPortion)} hint={`Dari ${r.yieldQty} ${r.yieldUnit} per batch`} />
        <StatTile label="Harga jual" value={rupiah(r.product.sellingPrice)} hint={`Harga modal produk ${rupiah(r.product.costPrice)}`} />
        <StatTile label="Margin" value={margin === null ? '–' : percentText(margin)} hint={margin === null ? 'Harga jual belum diisi' : 'Dari harga jual dan biaya per porsi'} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Panel>
          <h2 className="p-4 pb-2 font-semibold text-default-primary">Bahan dan sub-resep</h2>
          <LinesTable r={r} onSetCost={setCostFor} />
        </Panel>
        <div className="flex flex-col gap-4">
          <DonutChart
            boxed
            title="Komposisi biaya"
            unit="rupiah"
            centerLabel="Biaya per batch"
            total={r.batchCost}
            parts={shares}
            state={shares.length === 0 ? 'empty' : 'ready'}
            emptyText="Belum ada biaya untuk digambar"
          />
          <SuggestedPricePanel key={`${r.costPerPortion}:${r.product.sellingPrice}`} recipe={r} onUse={applyPrice} busy={pricing} />
          <Panel className="p-4">
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Biaya per batch" value={rupiah(r.batchCost)} />
              <Row label="Upah per batch" value={rupiah(r.laborCost)} />
              <Row label="HPP lengkap per porsi" value={rupiah(r.fullCostPerPortion)} strong />
            </dl>
            <p className="mt-3 text-sm text-default-secondary">
              Biaya per porsi dibulatkan ke atas sekali. HPP lengkap menambah upah per batch dibagi hasil; biaya tetap tidak ikut dihitung. Angka ini hanya untuk dibaca.
            </p>
            {blocker && <p className="mt-2 text-sm text-default-secondary">{blocker}</p>}
            {r.note && <p className="mt-2 text-sm text-default-primary">Catatan: {r.note}</p>}
          </Panel>
        </div>
      </div>

      <Dialog open={costFor !== null} onOpenChange={(o) => !o && setCostFor(null)} centered size="medium" title="Harga bahan manual">
        {costFor && (
          <ManualCostForm
            line={costFor}
            onCancel={() => setCostFor(null)}
            onDone={async () => {
              setCostFor(null)
              await router.invalidate()
            }}
          />
        )}
      </Dialog>
      {dialog}
    </Page>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-default-secondary">{label}</dt>
      <dd className={strong ? 'font-bold text-default-primary' : 'font-medium text-default-primary'}>{value}</dd>
    </div>
  )
}

function LineFlags({ l }: { l: RecipeLine }) {
  return (
    <>
      {flagsOf(l).map((f) => (
        <Badge key={f} color={f === 'deleted' ? 'danger' : 'warning'} size="small">
          {FLAG_TEXT[f]}
        </Badge>
      ))}
    </>
  )
}

/** A manual price can be set for an ingredient that has none; one set earlier can be changed (a purchase wins over it). */
const canSetCost = (l: RecipeLine) => l.kind === 'ingredient' && !l.deleted && !!l.ingredientId && (l.unitCost === null || l.unitCost.source === 'manual')

function LinesTable({ r, onSetCost }: { r: Recipe; onSetCost: (l: RecipeLine) => void }) {
  const nameOf = (l: RecipeLine) =>
    l.kind === 'sub_recipe' && l.subRecipeId ? (
      <Link to="/resep/$id" params={{ id: l.subRecipeId }} className="hover:underline">
        {l.name ?? 'Sub-resep'}
      </Link>
    ) : (
      (l.name ?? 'Bahan dihapus')
    )
  const qty = (l: RecipeLine) => `${l.quantity.toLocaleString('id-ID')} ${l.unit ?? ''}`.trim()
  const setCost = (l: RecipeLine) =>
    canSetCost(l) && (
      <Button width="auto" size="small" type="text" onClick={() => onSetCost(l)}>
        {l.unitCost ? 'Ubah harga' : 'Atur harga'}
      </Button>
    )
  return (
    <>
      <div className="hidden md:block">
        <Table density="comfortable">
          <TableHeader>
            <TableRow>
              <TableHead>Bahan</TableHead>
              <TableHead className="text-right">Takaran</TableHead>
              <TableHead className="text-right">Susut</TableHead>
              <TableHead>Harga satuan</TableHead>
              <TableHead className="text-right">Biaya</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">
                  <span className="flex flex-wrap items-center gap-2">
                    {nameOf(l)}
                    {l.kind === 'sub_recipe' && (
                      <Badge color="light" size="small">
                        Sub-resep
                      </Badge>
                    )}
                    <LineFlags l={l} />
                  </span>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">{qty(l)}</TableCell>
                <TableCell className="text-right">{l.wastePercent}%</TableCell>
                <TableCell>{unitCostText(l)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">{l.missingCost ? '–' : rupiah(l.cost)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">{setCost(l)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y divide-default-secondary md:hidden">
        {r.lines.map((l) => (
          <li key={l.id} className="flex flex-col gap-1 px-4 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-default-primary">{nameOf(l)}</span>
              <span className="font-semibold whitespace-nowrap">{l.missingCost ? '–' : rupiah(l.cost)}</span>
            </span>
            <span className="text-sm text-default-secondary">
              {qty(l)} · susut {l.wastePercent}% · {unitCostText(l)}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <LineFlags l={l} />
              {setCost(l)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

function ManualCostForm({ line, onCancel, onDone }: { line: RecipeLine; onCancel: () => void; onDone: () => Promise<void> }) {
  const manual = line.unitCost?.source === 'manual' ? line.unitCost : null
  const [cost, setCost] = useState(manual ? String(manual.amount) : '')
  const [perQty, setPerQty] = useState(manual ? String(manual.per) : '1')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const productId = line.ingredientId!
  const unit = line.unit ?? 'satuan'

  async function run(task: () => Promise<{ ok: true } | { ok: false; error: string; errors?: FieldErrors; status?: number }>, success: string, action: string) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const r = await act(task, success, action)
    lock.current = false
    setBusy(false)
    if (!r.ok) return setErrors(r.errors)
    await onDone()
  }

  function save(e: FormEvent) {
    e.preventDefault()
    const local = validateManualCost(cost, perQty)
    setErrors(local)
    if (Object.keys(local).length) return
    void run(() => setIngredientCost({ data: { productId, ...buildManualCost(cost, perQty) } }), 'Harga bahan disimpan', 'menyimpan harga bahan')
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4 px-6 pb-6">
      <p className="text-sm text-default-secondary">
        {line.name}: isi harga kemasan dan isinya dalam {unit}. Pembelian terakhir selalu menggantikan harga manual.
      </p>
      <TextField label="Harga kemasan (Rp)" required inputMode="numeric" value={cost} error={errors.cost} onChange={(e) => setCost(e.target.value)} autoFocus />
      <TextField label={`Isi kemasan (${unit})`} required inputMode="numeric" value={perQty} error={errors.perQty} onChange={(e) => setPerQty(e.target.value)} />
      <ErrorText>{errors.form}</ErrorText>
      <ActionRow>
        <Button width="auto" type="outline" color="light" disabled={busy} onClick={onCancel}>
          Batal
        </Button>
        {manual && (
          <Button
            width="auto"
            type="outline"
            color="danger"
            disabled={busy}
            onClick={() => void run(() => removeIngredientCost({ data: productId }), 'Harga manual dihapus', 'menghapus harga manual')}
          >
            Hapus harga
          </Button>
        )}
        <Button width="auto" htmlType="submit" isLoading={busy}>
          Simpan
        </Button>
      </ActionRow>
    </form>
  )
}
