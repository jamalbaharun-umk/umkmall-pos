import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'
import { Alert, Button } from '@umkmall/ui/primitives'
import { Page, PageLoading } from '@/components/page'
import { SCROLL_ROW, scrollActiveIntoView } from '@/lib/scroll-row'
import { REPORTS } from './-reports'

/** Lakasir's report pages share a tab row listing every report (HasReportPageSidebar renders it on top). */
export function ReportLayout({ title, children }: { title: string; children: ReactNode }) {
  const row = useRef<HTMLElement>(null)
  // The row starts at its left edge: bring the current report's tab into view (a phone shows 2 or 3 tabs).
  useEffect(() => scrollActiveIntoView(row.current), [title])
  return (
    <Page title={title} crumbs={[{ label: 'Laporan', to: '/laporan' }, { label: title }]}>
      <nav ref={row} aria-label="Laporan" className={`flex gap-1 rounded-xl bg-default-primary p-1 print:hidden ${SCROLL_ROW}`}>
        <Link to="/laporan" activeOptions={{ exact: true }} className="whitespace-nowrap rounded-lg px-3 py-2 hover:bg-weak-brand" activeProps={{ className: 'bg-weak-brand font-medium text-default-brand' }} inactiveProps={{ className: 'text-default-primary' }}>
          Semua laporan
        </Link>
        {Object.entries(REPORTS).map(([jenis, r]) => (
          <Link key={jenis} to="/laporan/$jenis" params={{ jenis }} className="whitespace-nowrap rounded-lg px-3 py-2 hover:bg-weak-brand" activeProps={{ className: 'bg-weak-brand font-medium text-default-brand' }} inactiveProps={{ className: 'text-default-primary' }}>
            {r.title}
          </Link>
        ))}
        <Link to="/laporan/untung-rugi" search={{ period: 'today' }} className="whitespace-nowrap rounded-lg px-3 py-2 hover:bg-weak-brand" activeProps={{ className: 'bg-weak-brand font-medium text-default-brand' }} inactiveProps={{ className: 'text-default-primary' }}>
          Untung rugi
        </Link>
        <Link to="/laporan/kasbon" className="whitespace-nowrap rounded-lg px-3 py-2 hover:bg-weak-brand" activeProps={{ className: 'bg-weak-brand font-medium text-default-brand' }} inactiveProps={{ className: 'text-default-primary' }}>
          Laporan kasbon
        </Link>
      </nav>
      {children}
    </Page>
  )
}

export const ReportPending = PageLoading

export function ReportError({ message }: { message?: string }) {
  const router = useRouter()
  return (
    <ReportLayout title="Laporan">
      <Alert
        variant="danger"
        action={
          <Button type="outline" color="primary" size="small" width="auto" onClick={() => void router.invalidate()}>
            Coba lagi
          </Button>
        }
      >
        <strong>Laporan belum bisa dimuat.</strong> {message ?? 'Coba muat ulang halaman ini sebentar lagi.'}
      </Alert>
    </ReportLayout>
  )
}
