import { createFileRoute, isRedirect } from '@tanstack/react-router'
import { api } from '@/lib/api.server'
import { PERIOD_CSV_PATHS, periodCsvQuery } from './-csv'
import { REPORTS } from './-reports'

// Streams pos-api's CSV through the session (the browser never holds the pos-api token).
export const Route = createFileRoute('/laporan/csv/$jenis')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const periodPath = Object.hasOwn(PERIOD_CSV_PATHS, params.jenis) ? PERIOD_CSV_PATHS[params.jenis] : undefined
        const report = Object.hasOwn(REPORTS, params.jenis) ? REPORTS[params.jenis] : undefined
        if (!report && !periodPath) return new Response(null, { status: 404 })
        const q = new URL(request.url).searchParams
        // Untung rugi and Pengeluaran show a period; the other reports a date range.
        const target = periodPath
          ? `${periodPath}?${periodCsvQuery(q.get('period'))}`
          : `/reports/${report!.kind}/csv?${new URLSearchParams({ from: q.get('from') ?? '', to: q.get('to') ?? '' })}`
        const res = await api(target).catch((e: unknown) => {
          if (isRedirect(e)) throw e
          return null
        })
        if (!res) return Response.json({ message: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }, { status: 502 })
        // Failures answer JSON `{ message }` in Indonesian (pos-api's 422 message, or a generic one): never a status code or stack.
        if (!res.ok) {
          const body = res.status === 422 ? ((await res.json().catch(() => null)) as { message?: string; errors?: Record<string, string> } | null) : null
          if (res.status === 403) return Response.json({ message: 'Anda tidak punya izin melihat laporan.' }, { status: 403 })
          const message = body?.message || 'Laporan belum bisa diunduh, coba lagi.'
          return Response.json({ message, errors: body?.errors }, { status: res.status === 422 ? 422 : 502 })
        }
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
