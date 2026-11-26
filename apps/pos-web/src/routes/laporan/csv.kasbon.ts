import { createFileRoute, isRedirect } from '@tanstack/react-router'
import { api } from '@/lib/api.server'
import { parseFilter } from './-kasbon'

// UMK-1964: streams pos-api's kasbon CSV through the session (the browser never holds the pos-api token).
export const Route = createFileRoute('/laporan/csv/kasbon')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams
        const params = new URLSearchParams({ filter: parseFilter(q.get('filter')) })
        const memberId = q.get('memberId')
        if (memberId) params.set('memberId', memberId)
        const res = await api(`/reports/receivables/csv?${params}`).catch((e: unknown) => {
          if (isRedirect(e)) throw e
          return null
        })
        if (!res) return Response.json({ message: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }, { status: 502 })
        // Failures answer JSON `{ message, code }` in Indonesian: never a status page or stack.
        if (!res.ok) {
          if (res.status === 403) return Response.json({ message: 'Anda tidak punya izin melihat laporan.' }, { status: 403 })
          const body =
            res.status === 422 ? ((await res.json().catch(() => null)) as { message?: string; code?: string } | null) : null
          return Response.json(
            { message: body?.message || 'Laporan belum bisa diunduh, coba lagi.', code: body?.code },
            { status: res.status === 422 ? 422 : 502 },
          )
        }
        return new Response(res.body, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="laporan-kasbon.csv"',
          },
        })
      },
    },
  },
})
