import { HeadContent, Outlet, Scripts, createRootRoute, useMatches } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Toaster } from '@umkmall/ui/primitives'
import type { ReactNode } from 'react'
import { Empty, Page } from '@/components/page'
import { Shell, type Me } from '@/components/shell'
import { api } from '@/lib/api.server'
import { getSessionToken } from '@/lib/session.server'
import { BARE_ROUTES } from '@/nav'
import appCss from '@/styles/app.css?url'

// Who is signed in, for the shell. Never redirects (the root also renders the sign-in page): any failure = no shell.
const getMe = createServerFn().handler(async (): Promise<Me | null> => {
  if (!getSessionToken()) return null
  try {
    const res = await api('/tenant/me')
    return res.ok ? ((await res.json()) as Me) : null
  } catch {
    return null
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
  const bare = useMatches({ select: (m) => BARE_ROUTES.includes(m.at(-1)?.routeId ?? '') })
  return <RootDocument>{me && !bare ? <Shell me={me}><Outlet /></Shell> : <Outlet />}</RootDocument>
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster position="top-right" />
        <Scripts />
      </body>
    </html>
  )
}
