import { Badge, Button, SelectionCard } from '@umkmall/ui/primitives'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { Empty, NoAccess, Page, PageError, PageLoading, Panel } from '@/components/page'
import { useCan } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { applyTemplate, listTemplates } from './-api'
import { applyToast, templateButtonLabel } from './-onboarding'

export const Route = createFileRoute('/mulai/template')({
  loader: () => listTemplates(),
  component: TemplateScreen,
  pendingComponent: PageLoading,
  errorComponent: PageError,
})

/**
 * UMK-2128 "Pilih jenis usaha" (design 44, screen 2): pick one of the seven templates, see what it holds, then
 * "Pakai template X". Products arrive without a price; the next screen asks for them.
 */
function TemplateScreen() {
  const templates = Route.useLoaderData()
  const canEdit = useCan('catalog.manage')
  const navigate = useNavigate()
  const [key, setKey] = useState(templates[0]?.key ?? '')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const chosen = templates.find((t) => t.key === key)

  async function apply() {
    if (!chosen || busy.current) return
    busy.current = true
    setSaving(true)
    try {
      const r = await applyTemplate({ data: chosen.key })
      if (!r.ok) {
        showError(r, { action: 'memakai template', retry: () => void apply() })
        return
      }
      notifySuccess(applyToast(r.data))
      void navigate({ to: r.data.unpriced > 0 ? '/mulai/harga' : '/catalog/products' })
    } catch (e) {
      showError(e, { action: 'memakai template', retry: () => void apply() })
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return (
    <Page
      title="Pilih jenis usaha"
      crumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Mulai', to: '/mulai' }, { label: 'Template' }]}
    >
      {!canEdit ? (
        <NoAccess permission="Mengelola katalog" />
      ) : templates.length === 0 ? (
        <Panel>
          <Empty title="Belum ada template">Tambahkan produk sendiri atau impor dari CSV.</Empty>
        </Panel>
      ) : (
        <Panel className="flex flex-col gap-4 p-4 md:p-6">
          <SelectionCard
            label="Jenis usaha"
            columns={2}
            options={templates.map((t) => ({
              value: t.key,
              label: t.name,
              description: t.description,
              badge: (
                <Badge color="light" size="small">
                  {t.productCount} produk
                </Badge>
              ),
            }))}
            value={[key]}
            onValueChange={(v) => setKey(v[0] ?? '')}
            disabled={saving}
          />
          {chosen && (
            <div className="flex flex-col gap-1 text-default-secondary">
              <p>
                <span className="font-semibold text-default-primary">Isi:</span> {chosen.categories.join(', ')}. Contoh:{' '}
                {chosen.sample.join(', ')}, dan lainnya.
              </p>
              <p>Tunai dan QRIS toko, pajak 0%. Harga masih kosong untuk Anda isi.</p>
            </div>
          )}
          <ActionRow>
            <Button width="auto" type="outline" color="light" disabled={saving} onClick={() => void navigate({ to: '/mulai' })}>
              Kembali
            </Button>
            <Button width="auto" disabled={!chosen || saving} onClick={() => void apply()}>
              {chosen ? templateButtonLabel(chosen.name) : 'Pakai template'}
            </Button>
          </ActionRow>
        </Panel>
      )}
    </Page>
  )
}
