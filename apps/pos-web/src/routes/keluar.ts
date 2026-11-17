import { createFileRoute } from '@tanstack/react-router'
import { clearSessionToken } from '@/lib/session.server'
import { seeOther } from './masuk/umkmall'

// Sign out: drops the session cookie and lands on the sign-in page. The device binding cookie stays (U4).
export const Route = createFileRoute('/keluar')({
  server: {
    handlers: {
      POST: () => {
        clearSessionToken()
        return seeOther('/?keluar=1')
      },
    },
  },
})
