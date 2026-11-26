import { createFileRoute } from '@tanstack/react-router'
import { clearSessionToken, setReturnTo, setSignedOut, umkmallLoginUrl } from '@/lib/session.server'
import { seeOther } from '@/lib/sign-in'

// "Masuk lagi" of Pengaturan, Keamanan (UMK-2054): the owner forgot their PIN, or its lock must be cleared. The POS
// session is dropped and the owner goes to UMKMall's login; the sign-in that follows opens a NEW owner session
// (fresh for a few minutes) and lands back on Keamanan. A cashier has no UMKMall login: only the owner's page posts here.
export const Route = createFileRoute('/masuk/ulang')({
  server: {
    handlers: {
      POST: () => {
        clearSessionToken()
        setSignedOut(false)
        setReturnTo('keamanan')
        return seeOther(umkmallLoginUrl())
      },
    },
  },
})
