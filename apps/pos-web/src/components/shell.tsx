import { AppShell } from '@umkmall/ui/layouts'
import { Header, Menu, Sidebar, SidebarMenuItem } from '@umkmall/ui/primitives'
import { Link, getRouteApi, useRouter, useRouterState } from '@tanstack/react-router'
import { LogOut, Menu as MenuIcon, Store } from 'lucide-react'
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { NAV, activeNav, visibleNav } from '@/nav'

export type Me = {
  tenant: { id: string; name?: string | null }
  actor: { id: string; kind: 'owner' | 'cashier'; name: string | null; permissions: string[] }
}

const root = getRouteApi('__root__')

/** Whether the signed-in actor holds a permission (owners hold all). Hides actions the API would refuse with 403. */
export function useCan(permission: string): boolean {
  const me = root.useLoaderData() as Me | null
  return me?.actor.permissions.includes(permission) ?? false
}

// SidebarMenuItem renders `linkComponent` with `href`; TanStack's Link wants `to`.
const RouterLink = forwardRef<HTMLAnchorElement, { href: string }>(({ href, ...props }, ref) => (
  <Link ref={ref} to={href} {...props} />
))

/** The signed-in frame: Lakasir's left navigation (store name on top, grouped entries) and a top bar with the actor. */
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const signOut = useRef<HTMLFormElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // The page scrolls inside the shell, not the window, so the router's scroll reset never reaches it. Reset once the
  // new page has rendered (resolved), not when the path changes: the old page is still on screen while it loads.
  const resolved = useRouterState({ select: (s) => s.resolvedLocation?.pathname })
  useEffect(() => {
    scroller.current?.scrollTo(0, 0)
  }, [resolved])

  const exists = (to: string) => Boolean((router.routesByPath as unknown as Record<string, unknown>)[to])
  const groups = visibleNav(NAV, exists, me.actor.permissions)
  const active = activeNav(groups, pathname)
  const store = me.tenant.name || 'Toko kamu'
  const actor = me.actor.kind === 'owner' ? 'Pemilik' : (me.actor.name ?? 'Kasir')

  const storeName = (
    <span className="flex min-w-0 items-center gap-2 px-2 text-lg font-semibold text-default-primary">
      <Store className="size-5 shrink-0 text-default-brand" aria-hidden />
      <span className="truncate">{store}</span>
    </span>
  )

  const nav = (drawer: boolean, label: string) => (
    <Sidebar
      label={label}
      collapsed={!drawer && collapsed}
      onCollapsedChange={drawer ? undefined : setCollapsed}
      collapseLabel="Ciutkan navigasi"
      {...(drawer ? { open, onOpenChange: setOpen } : {})}
      header={drawer ? storeName : undefined}
    >
      <div className="flex flex-col gap-5">
        {groups.map((g, i) => (
          <div key={g.label ?? i} className="flex flex-col gap-1">
            {g.label && (drawer || !collapsed) && (
              <span className="px-3 pb-1 text-sm font-medium text-default-secondary">{g.label}</span>
            )}
            {g.items.map((item) => (
              <SidebarMenuItem
                key={item.to}
                label={item.label}
                icon={<item.icon className="size-5" aria-hidden />}
                href={item.to}
                linkComponent={RouterLink}
                active={item.to === active}
                collapsed={!drawer && collapsed}
                onClick={() => setOpen(false)}
              />
            ))}
          </div>
        ))}
      </div>
    </Sidebar>
  )

  return (
    <AppShell
      routeKey={pathname}
      header={({ scrolled }) => (
        <Header
          type="dashboard"
          className="bg-default-primary [&>div]:max-w-none"
          scrolled={scrolled}
          leading={
            <span className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                aria-label="Buka navigasi"
                className="rounded-lg p-2 text-default-primary hover:bg-hover-neutral md:hidden"
                onClick={() => setOpen(true)}
              >
                <MenuIcon className="size-5" aria-hidden />
              </button>
              {storeName}
            </span>
          }
          actions={
            <>
              {/* A hard POST, so the httpOnly session cookie is cleared server-side and no client state survives. */}
              <form ref={signOut} method="post" action="/keluar" hidden />
              <Menu
                label="Akun"
                align="end"
                trigger={
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-hover-neutral"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-weak-brand font-semibold text-default-brand">
                      {actor.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="hidden text-sm font-medium text-default-primary sm:inline">{actor}</span>
                  </button>
                }
                items={[
                  { id: 'who', label: `${actor} · ${store}`, disabled: true },
                  {
                    id: 'keluar',
                    label: 'Keluar',
                    icon: <LogOut className="size-4" aria-hidden />,
                    danger: true,
                    onSelect: () => signOut.current?.requestSubmit(),
                  },
                ]}
              />
            </>
          }
        />
      )}
      sidebar={nav(false, 'Navigasi')}
      // Sidebar draws a rail and a drawer; this copy is only for its drawer, so it is hidden from md up.
      mobileSidebar={<div className="md:hidden">{nav(true, 'Navigasi seluler')}</div>}
    >
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-default-secondary">{children}</div>
    </AppShell>
  )
}
