import { createFileRoute } from '@tanstack/react-router'
import { api } from '@/lib/api.server'

// The store's static QRIS needs the POS session, which only this server holds, so <img> loads it through here (the
// settings preview and the cashier's wallet step). Any signed-in session of the store may read it.
export const Route = createFileRoute('/pengaturan/qris')({
  server: {
    handlers: {
      GET: async () => {
        const res = await api('/store/profile/qris').catch(() => null)
        if (!res?.ok)
          return new Response(null, {
            status: res?.status === 404 ? 404 : 401,
          })
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
