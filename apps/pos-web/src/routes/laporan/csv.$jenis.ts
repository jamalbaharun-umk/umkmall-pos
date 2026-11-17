import { createFileRoute } from '@tanstack/react-router'
import { api } from '@/lib/api.server'
import { REPORTS } from './-reports'

// Streams pos-api's CSV through the session (the browser never holds the pos-api token).
export const Route = createFileRoute('/laporan/csv/$jenis')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const report = Object.hasOwn(REPORTS, params.jenis) ? REPORTS[params.jenis] : undefined
        if (!report) return new Response(null, { status: 404 })
        const q = new URL(request.url).searchParams
        const range = new URLSearchParams({ from: q.get('from') ?? '', to: q.get('to') ?? '' })
        const res = await api(`/reports/${report.kind}/csv?${range}`)
        if (!res.ok) return new Response('Gagal mengunduh laporan.', { status: res.status })
        return new Response(res.body, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="laporan-${params.jenis}.csv"`,
          },
        })
      },
    },
  },
})
