import { createFileRoute } from '@tanstack/react-router'
import { endOwnerSession, sameOriginRequest, setReturnTo } from '@/lib/session.server'
import { seeOther } from '@/lib/sign-in'

// "Masuk lagi" of Pengaturan, Keamanan (UMK-2054): the owner forgot their PIN, or its lock must be cleared. The POS
// session ends and the owner signs in again with a WhatsApp code on `/`; that sign-in opens a NEW owner session (fresh
// for a few minutes) and lands back on Keamanan. A cashier has no WhatsApp sign-in: only the owner's page posts here.
export const Route = createFileRoute('/masuk/ulang')({
  server: {
    handlers: {
      POST: async () => {
        // Only the POS's own page may end the owner's sessions and set the landing: another site's form gets 403.
        if (!sameOriginRequest()) return new Response(null, { status: 403 })
        await endOwnerSession()
        setReturnTo('keamanan')
        return seeOther('/')
      },
    },
  },
})
