import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export const input =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20'
export const primary =
  'rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50'
export const secondary =
  'rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-brand-soft disabled:opacity-50'
export const danger = 'text-sm font-medium text-error hover:underline disabled:opacity-50'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-ink">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-ink-muted">{hint}</span>}
    </label>
  )
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">{children}</div>
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
      {children}
    </p>
  )
}

export function Loading() {
  return (
    <div role="status" className="py-12 text-center text-sm text-ink-muted">
      Memuat…
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="text-sm text-ink-muted">{children}</div>}
    </div>
  )
}

export function ErrorState({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="font-semibold text-ink">Gagal memuat data</p>
      <p className="text-sm text-ink-muted">{error instanceof Error ? error.message : 'Coba lagi sebentar lagi.'}</p>
      <button type="button" className={secondary} onClick={() => router.invalidate()}>
        Coba lagi
      </button>
    </div>
  )
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-sm font-medium text-brand hover:underline">
      ← {children}
    </Link>
  )
}
