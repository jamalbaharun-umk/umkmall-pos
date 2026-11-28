import { Button, TextField } from '@umkmall/ui/primitives'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { Empty, NoAccess, Page, PageError, PageLoading, Panel } from '@/components/page'
import { useCan } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { listUnpriced, savePrices } from './-api'
import { byCategory, pricesBody, pricesToast, remainingText, type PriceErrors } from './-onboarding'

export const Route = createFileRoute('/mulai/harga')({
  loader: () => listUnpriced(),
  component: PricesScreen,
  pendingComponent: PageLoading,
  errorComponent: PageError,
})

/**
 * UMK-2128 "Isi harga" (design 44, screen 3): the template's products wait without a price and stay off the till.
 * Type the prices you know; "Mulai jualan" saves them and opens the till, the rest can be filled later.
 */
function PricesScreen() {
  const { data } = Route.useLoaderData()
  const canEdit = useCan('catalog.manage')
  const navigate = useNavigate()
  const router = useRouter()
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<PriceErrors>({})
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const inputs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({})
  const typed = Object.values(texts).filter((t) => t.trim()).length
  const left = data.length - typed
  const groups = byCategory(data)

  async function save(after: 'kasir' | 'stay') {
    if (busy.current) return
    const body = pricesBody(texts)
    if (!body.ok) {
      setErrors(body.errors)
      inputs.current[Object.keys(body.errors)[0]]?.focus()
      return
    }
    setErrors({})
    if (body.items.length === 0) {
      if (after === 'kasir') window.location.assign('/kasir')
      return
    }
    busy.current = true
    setSaving(true)
    try {
      const r = await savePrices({ data: body.items })
      if (!r.ok) {
        showError(r, { action: 'menyimpan harga', retry: () => void save(after) })
        return
      }
      const failed = Object.fromEntries(r.data.failed.map((f) => [f.id, f.error]))
      setErrors(failed)
      setTexts((t) => Object.fromEntries(Object.entries(t).filter(([id]) => failed[id])))
      if (r.data.priced > 0) notifySuccess(pricesToast(r.data))
      if (r.data.failed.length === 0 && after === 'kasir') window.location.assign('/kasir')
      else await router.invalidate()
    } catch (e) {
      showError(e, { action: 'menyimpan harga', retry: () => void save(after) })
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  function fillNow() {
    const first = data.find((p) => !texts[p.id]?.trim())
    if (first) inputs.current[first.id]?.focus()
  }

  return (
    <Page title="Isi harga" crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Isi harga' }]}>
      {!canEdit ? (
        <NoAccess permission="Mengelola katalog" />
      ) : data.length === 0 ? (
        <Panel>
          <Empty
            title="Semua produk sudah punya harga"
            action={
              <Button asChild type="primary" color="primary" size="small" width="auto">
                <a href="/kasir">Buka kasir</a>
              </Button>
            }
          >
            Produk siap dijual di kasir.
          </Empty>
        </Panel>
      ) : (
        <Panel className="flex flex-col gap-4 p-4 md:p-6">
          <form
            noValidate
            className="flex flex-col gap-6"
            onSubmit={(e) => {
              e.preventDefault()
              void save('stay')
            }}
          >
            {groups.map(([category, items]) => (
              <section key={category} className="flex flex-col gap-3">
                <h2 className="text-base font-semibold text-default-primary">{category}</h2>
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
                  {items.map((p) => (
                    <TextField
                      key={p.id}
                      ref={(el) => {
                        inputs.current[p.id] = el
                      }}
                      label={`${p.name} (per ${p.unit.toLowerCase()})`}
                      inputMode="numeric"
                      placeholder="Isi harga"
                      prefix="Rp"
                      value={texts[p.id] ?? ''}
                      onChange={(e) => {
                        const value = e.target.value
                        setTexts((t) => ({ ...t, [p.id]: value }))
                      }}
                      error={errors[p.id]}
                      disabled={saving}
                    />
                  ))}
                </div>
              </section>
            ))}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
          <p className="text-default-secondary">{remainingText(left)}</p>
          <ActionRow>
            <Button width="auto" type="outline" color="primary" disabled={saving} onClick={fillNow}>
              Isi sekarang
            </Button>
            <Button width="auto" disabled={saving} onClick={() => void save('kasir')}>
              Mulai jualan
            </Button>
          </ActionRow>
          <p className="text-sm text-default-secondary">
            Harga yang sudah diketik ikut disimpan.{' '}
            <button type="button" className="font-semibold text-default-brand underline" onClick={() => void navigate({ to: '/catalog/products' })}>
              Lihat semua produk
            </button>
          </p>
        </Panel>
      )}
    </Page>
  )
}
