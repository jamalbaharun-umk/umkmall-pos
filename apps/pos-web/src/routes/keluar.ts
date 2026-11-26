import { createFileRoute } from '@tanstack/react-router'
import { endOwnerSession } from '@/lib/session.server'
import { seeOther } from '@/lib/sign-in'

// Sign out of the POS: ends the POS's own UMKMall session (the owner's web and app sessions stay), drops the session
// cookies and lands on the sign-in page. The device binding cookie stays (U4).
export const Route = createFileRoute('/keluar')({
  server: {
    handlers: {
      POST: async () => {
        await endOwnerSession()
        return seeOther('/?keluar=1')
      },
    },
  },
})
