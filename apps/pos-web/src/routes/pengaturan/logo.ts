import { createFileRoute } from '@tanstack/react-router'
import { api } from '@/lib/api.server'

// The store logo needs the POS session, which only this server holds, so <img> loads it through here.
export const Route = createFileRoute('/pengaturan/logo')({
  server: {
    handlers: {
      GET: async () => {
        const res = await api('/store/profile/logo').catch(() => null)
        if (!res?.ok) return new Response(null, { status: res?.status === 404 ? 404 : 401 })
        return new Response(res.body, {
          headers: {
            'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-store',
          },
        })
      },
    },
  },
})
