import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export { Button, Card, Empty, ErrorText, Field, LoadError, Pending, formatDate, inputClass } from '../staf/-ui'
export { rupiah } from '../catalog/-api'

const TABS = [
  { to: '/pembelian', label: 'Pembelian' },
  { to: '/pemasok', label: 'Pemasok' },
  { to: '/stok-opname', label: 'Stok opname' },
] as const

export function StockLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-svh max-w-3xl px-4 py-8">
      <Link to="/" className="text-sm text-brand hover:underline">
        ← Toko
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">{title}</h1>
      <nav className="mt-4 flex gap-2 overflow-x-auto border-b border-ink/10" aria-label="Stok masuk">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="-mb-px border-b-2 border-transparent px-3 py-2 whitespace-nowrap text-ink-muted hover:text-ink"
            activeProps={{ className: 'border-brand! text-ink! font-medium' }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6 space-y-6">{children}</div>
    </main>
  )
}

const STATUS = {
  draft: ['Draf', 'bg-warning/15 text-ink'],
  approved: ['Disetujui', 'bg-success/15 text-success'],
  cancelled: ['Dibatalkan', 'bg-ink/10 text-ink-muted'],
} as const

export function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  const [label, look] = STATUS[status]
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${look}`}>{label}</span>
}
