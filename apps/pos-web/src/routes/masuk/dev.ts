import { createFileRoute } from '@tanstack/react-router'
import { startSession } from '@/lib/session.server'
import { devSignInUser, seeOther } from '@/lib/sign-in'

// Local work without UMKMall: signs in as POS_DEV_USER_ID (a public.users id). Only with NODE_ENV development or test.
export const Route = createFileRoute('/masuk/dev')({
  server: {
    handlers: {
      POST: async () => {
        const userId = devSignInUser()
        if (!userId) return new Response(null, { status: 404 })
        const ok = await startSession('/auth/dev/sign-in', { userId })
        return seeOther(typeof ok === 'string' ? '/?masuk=1' : `/?gagal=${ok}`)
      },
    },
  },
})
