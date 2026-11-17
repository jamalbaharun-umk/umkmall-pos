import { createFileRoute } from '@tanstack/react-router'
import { api } from '@/lib/api.server'

// Product images need the POS session, which only this server holds, so <img> tags load them through here.
export const Route = createFileRoute('/catalog/products/$id/gambar/$imageId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const path = `/catalog/products/${encodeURIComponent(params.id)}/images/${encodeURIComponent(params.imageId)}`
        const res = await api(path).catch(() => null)
        if (!res?.ok) return new Response(null, { status: res?.status === 404 ? 404 : 401 })
        return new Response(res.body, {
          headers: {
            'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, max-age=300',
          },
        })
      },
    },
  },
})
