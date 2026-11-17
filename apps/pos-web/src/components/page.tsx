import { Button, Skeleton } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { ChevronRight, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

export type Crumb = { label: string; to?: string; params?: Record<string, string> }

/**
 * One screen inside the shell, laid out like a Lakasir (Filament) page: breadcrumbs, a bold title with the page
 * actions on its right, then the content.
 */
export function Page({
  title,
  crumbs = [],
  actions,
  children,
}: {
  title: ReactNode
  crumbs?: Crumb[]
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-2">
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-default-secondary">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-4" aria-hidden />}
                {c.to ? (
                  <Link to={c.to} params={c.params} className="hover:text-default-primary">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-default-primary md:text-3xl">{title}</h1>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  )
}

/** The white rounded panel Lakasir puts tables and forms on. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <Card variant="outlined" padding="none" className={`overflow-hidden bg-default-primary ${className}`}>
      {children}
    </Card>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-default-secondary text-default-secondary">
        <Inbox className="size-6" aria-hidden />
      </span>
      <p className="font-semibold text-default-primary">{title}</p>
      {children && <div className="max-w-md text-sm text-default-secondary">{children}</div>}
      {action}
    </div>
  )
}

/** Loading state shared by every screen: a page-shaped skeleton. */
export function PageLoading() {
  return (
    <div role="status" aria-label="Memuat" className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export const NO_PERMISSION = 'Kamu tidak punya izin untuk ini'

export function PageError({ error }: ErrorComponentProps) {
  const router = useRouter()
  // A 403 does not get better by retrying: say so, without the retry button.
  if (error instanceof Error && error.message.startsWith(NO_PERMISSION))
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
        <Panel>
          <Empty title={NO_PERMISSION}>Minta pemilik toko menambahkan izin yang dibutuhkan ke peranmu.</Empty>
        </Panel>
      </div>
    )
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <p className="text-lg font-semibold text-default-primary">Halaman belum bisa dibuka</p>
      <p className="text-sm text-default-secondary">
        {error instanceof Error && error.message ? error.message : 'Coba lagi sebentar lagi.'}
      </p>
      <Button type="outline" color="primary" size="small" width="auto" onClick={() => router.invalidate()}>
        Coba lagi
      </Button>
    </div>
  )
}

export const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })

/** A label with the required mark, for controls that take a label but no `required` prop (Select). */
export function RequiredLabel({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span aria-hidden className="text-default-error">
        *
      </span>
    </>
  )
}

/** What a screen shows an actor who lacks its permission (the API would answer 403 anyway). */
export function NoAccess({ permission }: { permission: string }) {
  return (
    <Panel>
      <Empty title="Kamu tidak punya izin untuk ini">
        Minta pemilik toko menambahkan izin “{permission}” ke peranmu.
      </Empty>
    </Panel>
  )
}
