import { Button } from '@umkmall/ui/primitives'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, type ReactNode } from 'react'
import { ActionRow } from '@/components/action-row'
import { notifySuccess } from '@/lib/feedback'
import { Empty, Page, PageError, PageLoading, Panel } from '@/components/page'
import { api } from '@/lib/api.server'
import { getSessionToken } from '@/lib/session.server'
import { devSignInUser } from '@/lib/sign-in'
import { OwnerSignIn } from './-owner-sign-in'
import { MetricWidgets } from './laporan/-dashboard-widgets'

const getHome = createServerFn().handler(async () => {
  const devSignIn = Boolean(devSignInUser())
  // Signed out: the WhatsApp sign-in card (UMK-2065). There is no UMKMall cookie to sign in from any more.
  if (!getSessionToken()) return { signedIn: false as const, devSignIn }
  const res = await api('/catalog/products?perPage=1')
  if (!res.ok) throw new Error('Gagal memuat toko')
  const { total } = (await res.json()) as { total: number }
  return { signedIn: true as const, products: total, devSignIn }
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
  // Sign-in and sign-out are full-page POSTs; they land here with a one-shot flag for the toast.
  useEffect(() => {
    if (!masuk && !keluar) return
    // Next tick: the Toaster renders after the page, so it subscribes after this effect runs.
    // Not cleared on re-run: stripping the flag below re-runs this effect before the timer fires.
    setTimeout(() => notifySuccess(masuk ? 'Berhasil masuk' : 'Anda sudah keluar'))
    void navigate({ search: ({ masuk: _m, keluar: _k, ...rest }) => rest, replace: true })
  }, [masuk, keluar, navigate])
  return home.signedIn ? (
    <Dashboard products={home.products} />
  ) : (
    <OwnerSignIn failed={gagal} devSignIn={home.devSignIn} />
  )
}

/**
 * Lakasir's dashboard. Its metric widgets (revenue, sales and discount today, best sellers, expiring stock) come from
 * U5 as one `<MetricWidgets />` line below the title; until then the page shows where to start.
 */
function Dashboard({ products }: { products: number }) {
  return (
    <Page title="Dashboard">
      <MetricWidgets />
      <Panel>
        {products === 0 ? (
          <Empty
            title="Belum ada produk"
            action={
              <Button asChild type="primary" color="primary" size="small" width="auto">
                <Link to="/catalog/products/baru">Tambah produk</Link>
              </Button>
            }
          >
            Tambahkan produk pertama untuk mulai berjualan.
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
    </Page>
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
