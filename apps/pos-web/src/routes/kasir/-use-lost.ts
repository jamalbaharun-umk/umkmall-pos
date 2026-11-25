import { isRedirect, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * For a call that failed without an answer: the sign-in redirect a server function throws when the session ended is
 * followed (a screen that swallowed it with `.catch(() => null)` would say "sambungan terputus" forever); any other
 * failure is "no answer" (null), as before.
 */
export function useLost() {
  const router = useRouter()
  return useCallback(
    (e: unknown): null => {
      if (isRedirect(e)) void router.navigate(e.options as never)
      return null
    },
    [router],
  )
}
