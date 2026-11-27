import { createFileRoute, isRedirect } from '@tanstack/react-router'
import { api } from '@/lib/api.server'
import { PDF_PATHS, pdfFilename, pdfQuery } from './-pdf'

// Streams pos-api's report PDF through the session (the browser never holds the pos-api token). The PDF is made by
// pos-api (never in the browser) and not stored here. Failures answer JSON `{ message, code }` in Indonesian.
export const Route = createFileRoute('/laporan/pdf/$jenis')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const path = Object.hasOwn(PDF_PATHS, params.jenis) ? PDF_PATHS[params.jenis] : undefined
        if (!path) return new Response(null, { status: 404 })
        const query = pdfQuery(new URL(request.url).searchParams)
        const res = await api(`${path}${query ? `?${query}` : ''}`).catch((e: unknown) => {
          if (isRedirect(e)) throw e
          return null
        })
        if (!res) return Response.json({ message: 'Tidak bisa terhubung. Periksa koneksi lalu coba lagi.' }, { status: 502 })
        if (!res.ok) {
          if (res.status === 403) return Response.json({ message: 'Anda tidak punya izin melihat laporan.' }, { status: 403 })
          const known = [422, 503].includes(res.status)
          const body = known ? ((await res.json().catch(() => null)) as { message?: string; code?: string } | null) : null
          return Response.json(
            { message: body?.message || 'PDF belum bisa dibuat, coba lagi.', code: body?.code },
            { status: known ? res.status : 502 },
          )
        }
        return new Response(res.body, {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': `attachment; filename="${pdfFilename(res.headers.get('content-disposition'), `laporan-${params.jenis}.pdf`)}"`,
            'cache-control': 'no-store',
          },
        })
      },
    },
  },
})
