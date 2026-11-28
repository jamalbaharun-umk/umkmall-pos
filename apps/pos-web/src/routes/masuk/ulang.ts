import { createFileRoute } from '@tanstack/react-router'
import { endOwnerSession, sameOriginRequest, setReturnTo } from '@/lib/session.server'
import { returnKeyOf, seeOther } from '@/lib/sign-in'

// "Masuk lagi" of Pengaturan, Keamanan (UMK-2054), and of the till's handover (UMK-2124): the owner forgot their PIN, or its lock must be cleared. The POS
// session ends and the owner signs in again with a WhatsApp code on `/`; that sign-in opens a NEW owner session (fresh
// for a few minutes) and lands back on Keamanan. A cashier has no WhatsApp sign-in: only the owner's page posts here.
export const Route = createFileRoute('/masuk/ulang')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Only the POS's own page may end the owner's sessions and set the landing: another site's form gets 403.
        if (!sameOriginRequest()) return new Response(null, { status: 403 })
        // UMK-2124: the till's "Akhiri lewat WhatsApp" lands back on the till (`kembali=pembantu`).
        const form = await request.formData().catch(() => null)
        await endOwnerSession()
        setReturnTo(returnKeyOf(form?.get('kembali')))
        return seeOther('/')
      },
    },
  },
})
