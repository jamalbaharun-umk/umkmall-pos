import { Badge, Button, Switch } from '@umkmall/ui/primitives'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { useGuides } from '@/components/guide'
import { Page, PageLoading, Panel } from '@/components/page'
import { notifySuccess, showError } from '@/lib/feedback'
import { GUIDES } from '@/guides'
import { seenText } from './-guides'

export const Route = createFileRoute('/pengaturan/panduan')({
  component: GuideCenter,
})

/**
 * UMK-2134 "Panduan" (design 46, screen 5): every guide with whether this person has seen it, "Ulangi" per guide
 * (opens its screen, where it starts again), "Ulangi semua", and the "Teks besar" switch (20 px bubbles).
 */
function GuideCenter() {
  const guides = useGuides()
  const navigate = useNavigate()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  // Only screens this person can open (the navigation hides the others).
  const visible = GUIDES.filter((g) => Boolean((router.routesByPath as unknown as Record<string, unknown>)[g.to]))

  if (!guides?.progress) return <PageLoading />
  const progress = guides.progress
  const seen = visible.filter((g) => progress.has(g.key)).length

  async function again(key: string | null, to?: string) {
    if (!guides || busy) return
    setBusy(key ?? '*')
    const ok = await guides.reset(key)
    setBusy(null)
    if (!ok) {
      showError({ code: 'GUIDE_PROGRESS_FAILED', status: 0 }, { action: 'mengulang panduan', retry: () => void again(key, to) })
      return
    }
    notifySuccess(key ? 'Panduan akan diputar lagi' : 'Semua panduan akan diputar lagi')
    if (to) void navigate({ to })
  }

  return (
    <Page title="Panduan" crumbs={[{ label: 'Pengaturan', to: '/pengaturan' }, { label: 'Panduan' }]}>
      <Panel className="flex flex-col gap-4 p-4 md:p-6">
        <div>
          <p className="font-semibold text-default-primary">Panduan Anda</p>
          <p className="text-default-secondary">{seenText(seen, visible.length)}</p>
        </div>
        <Switch
          label="Teks besar"
          checked={guides.largeText}
          onCheckedChange={(on) => guides.setLargeText(on)}
        />
        <ul className="flex flex-col divide-y divide-border-light">
          {visible.map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 text-default-primary">{g.title}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge color={progress.has(g.key) ? 'success' : 'light'} size="small">
                  {progress.has(g.key) ? 'Sudah' : 'Belum'}
                </Badge>
                <Button
                  type="text"
                  size="small"
                  width="auto"
                  disabled={busy !== null}
                  aria-label={`Ulangi panduan ${g.title}`}
                  onClick={() => void again(g.key, g.to)}
                >
                  Ulangi
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-default-secondary">Ketuk Ulangi untuk membuka layar itu dan memutar panduannya.</p>
        <ActionRow>
          <Button width="auto" type="outline" color="light" onClick={() => void navigate({ to: '/pengaturan' })}>
            Kembali
          </Button>
          <Button width="auto" disabled={busy !== null} onClick={() => void again(null)}>
            Ulangi semua
          </Button>
        </ActionRow>
      </Panel>
    </Page>
  )
}
