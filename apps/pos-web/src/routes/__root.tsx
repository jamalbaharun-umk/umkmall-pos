import { HeadContent, Navigate, Outlet, Scripts, createRootRoute, useMatches } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Toaster } from '@umkmall/ui/primitives'
import type { ReactNode } from 'react'
import { FeedbackHost } from '@/components/feedback-host'
import { Empty, Page } from '@/components/page'
import { GuideProvider } from '@/components/guide'
import { Shell, type Me } from '@/components/shell'
import { API_DOWN, UMKMALL_DOWN, api } from '@/lib/api.server'
import { getSessionToken, lastMe, rememberMe } from '@/lib/session.server'
import { BARE_ROUTES, HELPER_ROUTES } from '@/nav'
import appCss from '@/styles/app.css?url'

// Who is signed in, for the shell. Never redirects (the root also renders the sign-in page). When UMKMall or pos-api
// cannot be reached, the shell keeps rendering from the last known answer, flagged `offline` for a banner.
const getMe = createServerFn().handler(async (): Promise<Me | null> => {
  if (!getSessionToken()) return null
  try {
    const res = await api('/tenant/me')
    if (!res.ok) return null
    const me = (await res.json()) as Me
    rememberMe(me)
    return me
  } catch (e) {
    const offline = e instanceof Error && (e.message === UMKMALL_DOWN || e.message === API_DOWN) ? e.message : null
    const last = offline ? lastMe<Me>() : null
    return last ? { ...last, offline } : null
  }
})

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'UMKMall Kasir' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap',
      },
    ],
  }),
  loader: () => getMe(),
  staleTime: 5 * 60_000, // router.invalidate() (after sign-in or any save) refreshes it sooner
  component: Root,
  notFoundComponent: () => (
    <Page title="Halaman tidak ditemukan">
      <Empty title="Halaman ini tidak ada">Periksa alamatnya, atau kembali lewat menu di samping.</Empty>
    </Page>
  ),
})

function Root() {
  const me = Route.useLoaderData()
  const routeId = useMatches({ select: (m) => m.at(-1)?.routeId ?? '' })
  const bare = BARE_ROUTES.includes(routeId)
  // UMK-2124: a helper session has the sales-only till and its receipts, nothing else (pos-api answers 403 anyway).
  const helper = me?.actor.kind === 'helper'
  return (
    <RootDocument>
      {/* UMK-2134: guides for every signed-in screen, the bare till included; a helper's one guide is on the device. */}
      <GuideProvider enabled={Boolean(me)} helper={helper}>
        {helper && !HELPER_ROUTES.includes(routeId) ? (
          <Navigate to="/kasir" replace />
        ) : me && !bare ? (
          <Shell me={me}>
            <Outlet />
          </Shell>
        ) : (
          <Outlet />
        )}
      </GuideProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster position="top-center" />
        <FeedbackHost />
        <Scripts />
      </body>
    </html>
  )
}
