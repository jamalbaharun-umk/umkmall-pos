import { Alert, Button } from '@umkmall/ui/primitives'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState, type ReactNode } from 'react'
import { ActionRow } from '@/components/action-row'
import { notifySuccess } from '@/lib/feedback'
import { Empty, Page, PageError, PageLoading, Panel } from '@/components/page'
import { api } from '@/lib/api.server'
import { getSessionToken } from '@/lib/session.server'
import { devSignInUser } from '@/lib/sign-in'
import { OwnerSignIn } from './-owner-sign-in'
import { useCan, useSoloStatus } from '@/components/shell'
import { OwnerPinPrompt } from '@/components/owner-pin-prompt'
import { shouldAskOwnerPin } from '@/lib/owner-pin'
import { DashboardWidgets } from './-dashboard'

const getHome = createServerFn().handler(async () => {
  const devSignIn = Boolean(devSignInUser())
  // Signed out: the WhatsApp sign-in card (UMK-2065). There is no UMKMall cookie to sign in from any more.
  if (!getSessionToken()) return { signedIn: false as const, devSignIn }
  const res = await api('/catalog/products?perPage=1')
  if (!res.ok) throw new Error('Gagal memuat toko')
  const { total } = (await res.json()) as { total: number }
  // UMK-2128: template products waiting for a price; an actor without catalog.manage is refused and sees none.
  const waiting = await api('/onboarding/unpriced')
  const unpriced = waiting.ok ? ((await waiting.json()) as { total: number }).total : 0
  return { signedIn: true as const, products: total, unpriced, devSignIn }
})

export const Route = createFileRoute('/')({
  validateSearch: (search): { gagal?: number; masuk?: 1; keluar?: 1 } => ({
    ...(search.gagal === undefined
      ? {}
      : { gagal: Number.isInteger(Number(search.gagal)) ? Number(search.gagal) : 1 }),
    ...(search.masuk ? { masuk: 1 as const } : {}),
    ...(search.keluar ? { keluar: 1 as const } : {}),
  }),
  loader: () => getHome(),
  component: Home,
  pendingComponent: PageLoading,
  errorComponent: PageError,
})

function Home() {
  const home = Route.useLoaderData()
  const { gagal, masuk, keluar } = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  // Design 40: the owner without a PIN is asked for one right after signing in. Read once: the flag is stripped below.
  const solo = useSoloStatus()
  const [askPin, setAskPin] = useState(() => shouldAskOwnerPin(solo, Boolean(masuk)))
  // Sign-in and sign-out are full-page POSTs; they land here with a one-shot flag for the toast.
  useEffect(() => {
    if (!masuk && !keluar) return
    // Next tick: the Toaster renders after the page, so it subscribes after this effect runs.
    // Not cleared on re-run: stripping the flag below re-runs this effect before the timer fires.
    setTimeout(() => notifySuccess(masuk ? 'Berhasil masuk' : 'Anda sudah keluar'))
    void navigate({ search: ({ masuk: _m, keluar: _k, ...rest }) => rest, replace: true })
  }, [masuk, keluar, navigate])
  return home.signedIn ? (
    <>
      <Dashboard products={home.products} unpriced={home.unpriced} />
      <OwnerPinPrompt open={askPin} onClose={() => setAskPin(false)} />
    </>
  ) : (
    <OwnerSignIn failed={gagal} devSignIn={home.devSignIn} />
  )
}

/**
 * The dashboard. With `reports.view` it is the chart widgets (design feature 35, UMK-1972); the quick start below stays
 * for a signed-in actor without that permission (no card shows) and for a store with no product yet.
 */
function Dashboard({ products, unpriced }: { products: number; unpriced: number }) {
  const canReport = useCan('reports.view')
  return (
    <Page title="Dashboard">
      {unpriced > 0 && (
        <Alert variant="warning" size="small">
          {unpriced} produk belum punya harga dan belum tampil di kasir.{' '}
          <Link to="/mulai/harga" className="font-semibold underline">
            Isi harga
          </Link>
        </Alert>
      )}
      {/* A store without products starts here first (UMK-2128); the charts would be empty anyway. */}
      {products === 0 && <QuickStartPanel products={products} />}
      {canReport && <DashboardWidgets />}
      {!canReport && products > 0 && <QuickStartPanel products={products} />}
    </Page>
  )
}

function QuickStartPanel({ products }: { products: number }) {
  const canEdit = useCan('catalog.manage')
  return (
    <>
      <Panel>
        {products === 0 ? (
          <Empty
            title="Belum ada produk"
            action={
              canEdit && (
                <Button asChild type="primary" color="primary" size="small" width="auto">
                  <Link to="/mulai">Mulai siapkan toko</Link>
                </Button>
              )
            }
          >
            {canEdit
              ? 'Pilih template usaha, pindahkan data dari CSV, atau mulai dari HPP.'
              : 'Pemilik toko belum menambahkan produk.'}
          </Empty>
        ) : (
          <QuickStart>
            <Button asChild type="outline" color="primary" size="small" width="auto">
              <Link to="/catalog/products">Produk ({products})</Link>
            </Button>
            <Button asChild type="primary" color="primary" size="small" width="auto">
              <a href="/kasir">Buka kasir</a>
            </Button>
          </QuickStart>
        )}
      </Panel>
    </>
  )
}

function QuickStart({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold text-default-primary">Siap berjualan</p>
        <p className="text-sm text-default-secondary">Buka kasir untuk mencatat penjualan hari ini.</p>
      </div>
      <ActionRow className="sm:w-auto">{children}</ActionRow>
    </div>
  )
}
