import { Link } from '@tanstack/react-router'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

const TABS = [
  { to: '/staf', label: 'Staf' },
  { to: '/staf/peran', label: 'Peran' },
  { to: '/staf/perangkat', label: 'Perangkat' },
] as const

export function StaffLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-svh max-w-3xl px-4 py-8">
      <Link to="/" className="text-sm text-brand hover:underline">
        ← Toko
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">{title}</h1>
      <nav className="mt-4 flex gap-2 border-b border-ink/10" aria-label="Pengaturan staf">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            activeOptions={{ exact: true }}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-ink-muted hover:text-ink"
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

export function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-xl bg-white p-5 shadow-sm">{children}</section>
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const look = {
    primary: 'bg-brand text-white hover:bg-brand-strong',
    ghost: 'bg-brand-soft text-brand hover:bg-brand/10',
    danger: 'bg-error/10 text-error hover:bg-error/20',
  }[variant]
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${look} ${className}`}
    />
  )
}

export const inputClass =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
    </label>
  )
}

export function ErrorText({ children }: { children?: ReactNode }) {
  return children ? (
    <p role="alert" className="text-sm text-error">
      {children}
    </p>
  ) : null
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="py-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{hint}</p>
    </div>
  )
}

export const Pending = () => <p className="px-4 py-8 text-center text-ink-muted">Memuat…</p>

export function LoadError({ error }: { error: unknown }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-ink">Halaman belum bisa dibuka</h1>
      <p className="mt-1 text-ink-muted">{(error instanceof Error && error.message) || 'Coba muat ulang sebentar lagi.'}</p>
    </main>
  )
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}
