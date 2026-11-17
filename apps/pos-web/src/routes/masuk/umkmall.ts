import { createFileRoute } from '@tanstack/react-router'
import { exchangeHandoff } from '@/lib/session.server'

// UMKMall's relay form-POSTs the handoff token here (body only, never a URL). Exchanged server to server.
export const Route = createFileRoute('/masuk/umkmall')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData().catch(() => null)
        const token = form?.get('token')
        const ok = typeof token === 'string' && token.length > 0 && (await exchangeHandoff(token))
        return seeOther(ok ? '/' : '/?gagal=1')
      },
    },
  },
})

export const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } })
