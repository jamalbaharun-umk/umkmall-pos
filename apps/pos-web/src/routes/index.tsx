import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { api } from '@/lib/api.server'
import { getSessionToken } from '@/lib/session.server'

type Store = { tenant: { id: string; createdAt: string } }

const getHome = createServerFn().handler(async () => {
  const devSignIn = process.env.NODE_ENV !== 'production' && Boolean(process.env.POS_DEV_USER_ID)
  if (!getSessionToken()) return { store: null, devSignIn }
  const res = await api('/tenant/me')
  if (!res.ok) throw new Error('Gagal memuat toko')
  return { store: (await res.json()) as Store, devSignIn }
})

export const Route = createFileRoute('/')({
  validateSearch: (search): { gagal?: boolean } => (search.gagal ? { gagal: true } : {}),
  loader: () => getHome(),
  component: Home,
  pendingComponent: () => <Centered><p className="text-ink-muted">Memuat…</p></Centered>,
  errorComponent: () => (
    <Centered>
      <h1 className="text-xl font-semibold text-ink">Toko belum bisa dibuka</h1>
      <p className="text-ink-muted">Coba muat ulang halaman ini sebentar lagi.</p>
    </Centered>
  ),
})

function Home() {
  const { store, devSignIn } = Route.useLoaderData()
  const { gagal } = Route.useSearch()
  return store ? <Dashboard /> : <SignIn failed={Boolean(gagal)} devSignIn={devSignIn} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      {children}
    </main>
  )
}

function SignIn({ failed, devSignIn }: { failed: boolean; devSignIn: boolean }) {
  return (
    <Centered>
      <h1 className="text-2xl font-semibold text-ink">Masuk lewat UMKMall</h1>
      <p className="text-ink-muted">Buka akun UMKMall kamu, lalu pilih Kasir untuk membuka toko di sini.</p>
      {failed && (
        <p role="alert" className="text-error">
          Gagal masuk. Tautan dari UMKMall hanya berlaku sekali dan beberapa menit, coba lagi dari UMKMall.
        </p>
      )}
      <a href="/kasir/masuk" className="text-brand hover:underline">Masuk sebagai kasir</a>
      {devSignIn && (
        <form method="post" action="/masuk/dev">
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong">
            Masuk (pengembangan)
          </button>
        </form>
      )}
    </Centered>
  )
}

function Dashboard() {
  return (
    <main className="mx-auto min-h-svh max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-ink">Toko kamu</h1>
      <a href="/staf" className="mt-2 inline-block text-brand hover:underline">Staf, peran dan perangkat</a>
      <section className="mt-6 rounded-xl bg-white p-8 text-center">
        <h2 className="text-lg font-medium text-ink">Belum ada produk</h2>
        <p className="mt-1 text-ink-muted">Tambahkan produk pertama untuk mulai berjualan.</p>
        <Link to="/catalog/products" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong">Buka katalog</Link>
      </section>
    </main>
  )
}
