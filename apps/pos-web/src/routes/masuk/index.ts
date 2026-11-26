import { createFileRoute } from '@tanstack/react-router'
import { setSignedOut, takeLandingPath, umkmallLoginUrl, umkmallSession } from '@/lib/session.server'
import { seeOther } from '@/lib/sign-in'

// The sign-in page's "Masuk dengan akun UMKMall": the UMKMall login cookie → owner session; not signed in to UMKMall
// (401) → UMKMall's login, which comes back to the POS home.
export const Route = createFileRoute('/masuk/')({
  server: {
    handlers: {
      POST: async () => {
        setSignedOut(false)
        const result = await umkmallSession(true)
        if (typeof result === 'string') return seeOther(takeLandingPath())
        return seeOther(result === 401 ? umkmallLoginUrl() : `/?gagal=${result}`)
      },
    },
  },
})
