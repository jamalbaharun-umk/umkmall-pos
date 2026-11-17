import { Link } from '@tanstack/react-router'

const TAB = 'rounded-lg px-3 py-2 text-ink-muted hover:bg-brand-soft'
const ACTIVE = { className: 'bg-brand-soft! text-brand! font-medium' }

export function CashierHeader({ title }: { title: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <div>
        <Link to="/" className="text-sm text-brand hover:underline">← Toko</Link>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      </div>
      <nav className="flex gap-2" aria-label="Kasir">
        <Link to="/kasir" activeOptions={{ exact: true }} className={TAB} activeProps={ACTIVE}>Jual</Link>
        <Link to="/kasir/riwayat" className={TAB} activeProps={ACTIVE}>Riwayat</Link>
        <Link to="/kasir/tutup" className={TAB} activeProps={ACTIVE}>Tutup shift</Link>
      </nav>
    </header>
  )
}

export function KasirMain({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-svh max-w-6xl px-4 py-6">
      <CashierHeader title={title} />
      <div className="mt-6">{children}</div>
    </main>
  )
}
