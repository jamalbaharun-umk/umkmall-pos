import { createFileRoute } from '@tanstack/react-router'
import { clearSessionToken, setSignedOut } from '@/lib/session.server'
import { seeOther } from '@/lib/sign-in'

// Sign out of the POS only: drops the session cookie and lands on the sign-in page, which then does not sign back in
// from the UMKMall cookie until the owner presses "Masuk". The device binding cookie stays (U4).
export const Route = createFileRoute('/keluar')({
  server: {
    handlers: {
      POST: () => {
        clearSessionToken()
        setSignedOut(true)
        return seeOther('/?keluar=1')
      },
    },
  },
})
