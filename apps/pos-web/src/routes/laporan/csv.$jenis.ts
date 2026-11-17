import { createFileRoute, isRedirect } from '@tanstack/react-router'
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
        const res = await api(`/reports/${report.kind}/csv?${range}`).catch((e: unknown) => {
          if (isRedirect(e)) throw e
          return null
        })
        if (!res) return Response.json({ message: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }, { status: 502 })
        // Failures answer JSON `{ message }` in Indonesian (pos-api's 422 message, or a generic one): never a status code or stack.
        if (!res.ok) {
          const body = res.status === 422 ? ((await res.json().catch(() => null)) as { message?: string; errors?: Record<string, string> } | null) : null
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
