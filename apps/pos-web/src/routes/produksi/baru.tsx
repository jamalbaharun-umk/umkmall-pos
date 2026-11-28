import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Alert, Badge, Button, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextField } from '@umkmall/ui'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ActionRow } from '@/components/action-row'
import { Panel } from '@/components/page'
import { act, Empty, ErrorText, type FieldErrors, LoadError, Page, Pending, req } from '@/components/pos-page'
import { clearKeys } from '@/lib/form-checks'
import { createRun, loadPlan, loadRecipeOptions } from './-api'
import {
  buildRunPayload,
  emptyRunDraft,
  keyFor,
  type KeyMemo,
  newKey,
  type Plan,
  planBlocker,
  planMatches,
  planQuery,
  quantityText,
  type Run,
  type RunDraft,
  shortBy,
  successText,
  validateRun,
} from './-run'

// UMK-2132, design 45 (screens 1 and 2): plan a run (what it takes against what is on hand), then record the real yield.
export const Route = createFileRoute('/produksi/baru')({
  loader: () => loadRecipeOptions(),
  component: NewRunPage,
  pendingComponent: Pending,
  errorComponent: LoadError,
})

const PLAN_DELAY_MS = 300

type PlanState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; plan: Plan }
  | { kind: 'error'; message: string }

function NewRunPage() {
  const recipes = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [d, setD] = useState<RunDraft>(emptyRunDraft)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string>()
  const [plan, setPlan] = useState<PlanState>({ kind: 'idle' })
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  // The Idempotency-Key of the last attempt: kept while the payload is unchanged, so a retry cannot record twice.
  const memo = useRef<KeyMemo | null>(null)
  const seq = useRef(0)
  // Set once the owner types their own yield: the plan then stops proposing one.
  const yieldTouched = useRef(false)

  const query = planQuery(d)
  const recipeId = query?.recipeId
  const batches = query?.batches
  const current = plan.kind === 'ready' && planMatches(plan.plan, query) ? plan.plan : null

  // The plan follows the recipe and the batches: read again a moment after the last keystroke; an older answer is dropped.
  useEffect(() => {
    if (!recipeId || !batches) {
      setPlan({ kind: 'idle' })
      return
    }
    const mine = ++seq.current
    setPlan({ kind: 'loading' })
    const timer = setTimeout(async () => {
      const res = await loadPlan({ data: { recipeId, batches } }).catch(() => null)
      if (mine !== seq.current) return
      if (!res) return setPlan({ kind: 'error', message: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' })
      if (!res.ok) return setPlan({ kind: 'error', message: res.errors?.recipeId ?? res.errors?.batches ?? res.error })
      setPlan({ kind: 'ready', plan: res.data })
      // The yield proposes the planned one until the owner types their own.
      setD((x) => (yieldTouched.current ? x : { ...x, actualYield: String(res.data.plannedYield) }))
    }, PLAN_DELAY_MS)
    return () => clearTimeout(timer)
  }, [recipeId, batches, reload])

  const set = (patch: Partial<RunDraft>, ...keys: string[]) => {
    setD((x) => ({ ...x, ...patch }))
    setErrors((e) => clearKeys(e, keys))
  }

  const blocker = planBlocker(current)
  const unit = current?.yieldUnit ?? ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const local = validateRun(d)
    setErrors(local)
    if (Object.keys(local).length) return setFormError('Periksa kembali isian yang ditandai.')
    setFormError(undefined)
    const payload = buildRunPayload(d)
    memo.current = keyFor(memo.current, payload, newKey)
    const key = memo.current.key
    lock.current = true
    setBusy(true)
    const r = await act(() => createRun({ data: { key, body: payload } }), successText(payload.actualYield, unit), 'mencatat produksi')
    lock.current = false
    setBusy(false)
    if (!r.ok) {
      setErrors(r.errors)
      setFormError(Object.keys(r.errors).length ? 'Periksa kembali isian yang ditandai.' : undefined)
      // A refusal means nothing was written, but the stock may have changed since: read the plan again.
      if ('status' in r.res && r.res.status === 422) setReload((n) => n + 1)
      return
    }
    memo.current = null
    const saved = (r.res as { data?: Run }).data
    await router.invalidate()
    if (saved?.id) await navigate({ to: '/produksi/$id', params: { id: saved.id } })
    else await navigate({ to: '/produksi' })
  }

  if (recipes.length === 0)
    return (
      <Page crumbs={[{ label: 'Produksi', to: '/produksi' }, { label: 'Baru' }]} title="Produksi baru">
        <Panel>
          <Empty
            title="Belum ada resep"
            hint="Produksi memakai resep untuk tahu bahan yang keluar. Buat resep dulu."
            action={
              <Button width="auto" asChild>
                <Link to="/resep/baru">Buat resep</Link>
              </Button>
            }
          />
        </Panel>
      </Page>
    )

  return (
    <Page crumbs={[{ label: 'Produksi', to: '/produksi' }, { label: 'Baru' }]} title="Produksi baru">
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <Panel className="p-4 md:p-6">
          <h2 className="mb-3 font-semibold text-default-primary">1. Rencana</h2>
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_1fr]">
            <Select
                label={req('Resep')}
                showSearch
                placeholder="Pilih resep"
                emptyMessage="Resep tidak ditemukan"
                error={errors.recipeId}
                options={recipes.map((r) => ({ value: r.id, label: r.product.name, hint: `${r.yieldQty} ${r.yieldUnit} per batch` }))}
                value={d.recipeId || undefined}
                onValueChange={(v) => set({ recipeId: v }, 'recipeId')}
              />
            <TextField
              label="Jumlah batch"
              required
              inputMode="numeric"
              value={d.batches}
              error={errors.batches}
              onChange={(e) => set({ batches: e.target.value }, 'batches')}
            />
          </div>
          <PlanView state={plan} current={current} blocker={blocker} onRetry={() => setReload((n) => n + 1)} />
        </Panel>

        <Panel className="p-4 md:p-6">
          <h2 className="mb-3 font-semibold text-default-primary">2. Hasil nyata</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label={unit ? `Hasil sebenarnya (${unit})` : 'Hasil sebenarnya'}
              required
              inputMode="numeric"
              value={d.actualYield}
              error={errors.actualYield}
              onChange={(e) => {
                yieldTouched.current = true
                set({ actualYield: e.target.value }, 'actualYield')
              }}
            />
          </div>
          <div className="mt-3">
            <TextField label="Catatan" multiline rows={2} maxLength={500} value={d.note} error={errors.note} onChange={(e) => set({ note: e.target.value }, 'note')} />
          </div>
          <p className="mt-3 text-sm text-default-secondary">
            Bahan keluar dari batch tertua lebih dulu. Biaya per porsi dihitung dari biaya bahan sebenarnya dibagi hasil sebenarnya, dibulatkan ke atas.
          </p>
        </Panel>

        <ErrorText>{formError}</ErrorText>
        <ActionRow>
          <Button width="auto" type="outline" color="light" disabled={busy} onClick={() => void navigate({ to: '/produksi' })}>
            Batal
          </Button>
          <Button width="auto" htmlType="submit" isLoading={busy} disabled={!current?.canProduce}>
            Catat produksi
          </Button>
        </ActionRow>
      </form>
    </Page>
  )
}

function PlanView({ state, current, blocker, onRetry }: { state: PlanState; current: Plan | null; blocker: string | null; onRetry: () => void }) {
  if (state.kind === 'idle')
    return <p className="mt-4 text-sm text-default-secondary">Pilih resep dan isi jumlah batch untuk melihat bahan yang akan terpakai.</p>
  if (state.kind === 'loading' || (state.kind === 'ready' && !current))
    return (
      <div role="status" aria-label="Memuat rencana" className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  if (state.kind === 'error')
    return (
      <div className="mt-4 flex flex-col gap-3">
        <Alert variant="danger" size="small" role="alert">
          {state.message}
        </Alert>
        <ActionRow align="start">
          <Button width="auto" type="outline" color="primary" onClick={onRetry}>
            Coba lagi
          </Button>
        </ActionRow>
      </div>
    )
  const plan = current!
  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-sm text-default-secondary">
        Hasil rencana <strong className="text-default-primary">{quantityText(plan.plannedYield, plan.yieldUnit)}</strong> dari {plan.batches.toLocaleString('id-ID')} batch {plan.product.name}.
      </p>
      {plan.ingredients.length === 0 ? (
        <p className="text-sm text-default-secondary">Resep ini belum punya bahan yang keluar dari stok.</p>
      ) : (
        <>
          <div className="hidden md:block">
            <Table density="comfortable">
              <TableHeader>
                <TableRow>
                  <TableHead>Bahan</TableHead>
                  <TableHead className="text-right">Pakai</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead>Keadaan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.ingredients.map((i) => (
                  <TableRow key={i.productId}>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{quantityText(i.needed, i.unit)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{quantityText(i.available, i.unit)}</TableCell>
                    <TableCell>
                      <Enough i={i} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="divide-y divide-default-secondary rounded-lg border border-default-secondary md:hidden">
            {plan.ingredients.map((i) => (
              <li key={i.productId} className="flex flex-col gap-1 px-3 py-2">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-default-primary">{i.name}</span>
                  <Enough i={i} />
                </span>
                <span className="text-sm text-default-secondary">
                  Pakai {quantityText(i.needed, i.unit)} · stok {quantityText(i.available, i.unit)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {blocker ? (
        <Alert variant="warning" size="small" role="alert">
          {blocker}
        </Alert>
      ) : (
        <p className="text-sm text-default-secondary">Stok cukup. Isi hasil sebenarnya di bawah, lalu catat produksi.</p>
      )}
    </div>
  )
}

function Enough({ i }: { i: Plan['ingredients'][number] }) {
  return i.enough ? (
    <Badge color="success" size="small">
      Cukup
    </Badge>
  ) : (
    <Badge color="danger" size="small">
      Kurang {quantityText(shortBy(i), i.unit)}
    </Badge>
  )
}

