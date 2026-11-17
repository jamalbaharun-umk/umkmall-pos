import { Alert, Button } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Store } from 'lucide-react'
import type { ReactNode } from 'react'
import { Empty, Page, PageError, PageLoading, Panel } from '@/components/page'
import { api } from '@/lib/api.server'
import { getSessionToken } from '@/lib/session.server'
import { MetricWidgets } from './laporan/-dashboard-widgets'

const getHome = createServerFn().handler(async () => {
  const devSignIn = process.env.NODE_ENV !== 'production' && Boolean(process.env.POS_DEV_USER_ID)
  if (!getSessionToken()) return { signedIn: false as const, devSignIn }
  const res = await api('/catalog/products?perPage=1')
  if (!res.ok) throw new Error('Gagal memuat toko')
  const { total } = (await res.json()) as { total: number }
  return { signedIn: true as const, products: total, devSignIn }
})

export const Route = createFileRoute('/')({
  validateSearch: (search): { gagal?: boolean } => (search.gagal ? { gagal: true } : {}),
  loader: () => getHome(),
  component: Home,
  pendingComponent: PageLoading,
  errorComponent: PageError,
})

function Home() {
  const home = Route.useLoaderData()
  const { gagal } = Route.useSearch()
  return home.signedIn ? <Dashboard products={home.products} /> : <SignIn failed={Boolean(gagal)} devSignIn={home.devSignIn} />
}

/** Lakasir's login: a centred card on the grey page. POS owners arrive from UMKMall instead of a password form. */
function SignIn({ failed, devSignIn }: { failed: boolean; devSignIn: boolean }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-default-secondary px-4">
      <Card variant="outlined" padding="large" className="flex w-full max-w-md flex-col items-center gap-5 bg-default-primary text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-weak-brand text-default-brand">
          <Store className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-default-primary">Masuk ke Kasir</h1>
          <p className="text-sm text-default-secondary">
            Buka akun UMKMall kamu, lalu pilih Kasir untuk membuka toko di sini.
          </p>
        </div>
        {failed && (
          <Alert variant="danger" className="w-full text-left">
            Gagal masuk. Tautan dari UMKMall hanya berlaku sekali dan beberapa menit, coba lagi dari UMKMall.
          </Alert>
        )}
        <Button asChild type="outline" color="primary" width="full">
          <a href="/kasir/masuk">Masuk sebagai kasir (PIN)</a>
        </Button>
        {devSignIn && (
          <form method="post" action="/masuk/dev" className="w-full">
            <Button htmlType="submit" type="primary" color="primary" width="full">
              Masuk (pengembangan)
            </Button>
          </form>
        )}
      </Card>
    </main>
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
            <Button asChild type="primary" color="primary" size="small" width="auto">
              <a href="/kasir">Buka kasir</a>
            </Button>
            <Button asChild type="outline" color="primary" size="small" width="auto">
              <Link to="/catalog/products">Produk ({products})</Link>
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
      <div className="flex gap-2">{children}</div>
    </div>
  )
}
