import { createFileRoute } from '@tanstack/react-router'
import { exchangeHandoff } from '@/lib/session.server'

// UMKMall's relay form-POSTs the handoff token here (body only, never a URL). Exchanged server to server.
export const Route = createFileRoute('/masuk/umkmall')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData().catch(() => null)
        const token = form?.get('token')
        const result = typeof token === 'string' && token.length > 0 ? await exchangeHandoff(token) : 422
        // `gagal` carries only the status, so the sign-in page can say why (expired link vs. UMKMall unreachable).
        return seeOther(typeof result === 'string' ? '/?masuk=1' : `/?gagal=${result}`)
      },
    },
  },
})

export const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } })
