import { createFileRoute } from '@tanstack/react-router'
import { startSession } from '@/lib/session.server'
import { seeOther } from './umkmall'

// Local work without UMKMall: signs in as POS_DEV_USER_ID (a public.users id). Refused in production.
export const Route = createFileRoute('/masuk/dev')({
  server: {
    handlers: {
      POST: async () => {
        const userId = process.env.POS_DEV_USER_ID
        if (process.env.NODE_ENV === 'production' || !userId) return new Response(null, { status: 404 })
        const ok = await startSession('/auth/dev/sign-in', { userId })
        return seeOther(typeof ok === 'string' ? '/?masuk=1' : `/?gagal=${ok}`)
      },
    },
  },
})
