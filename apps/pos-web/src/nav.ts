import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Archive,
  Banknote,
  Globe,
  CalendarDays,
  Clock,
  CreditCard,
  Database,
  FileText,
  HandCoins,
  Layers,
  LayoutDashboard,
  ListChecks,
  ListOrdered,
  MonitorSmartphone,
  PackagePlus,
  PiggyBank,
  Receipt,
  Settings,
  ShieldCheck,
  TicketPercent,
  Users,
  UsersRound,
  Wallet,
  Zap,
} from 'lucide-react'

/**
 * THE navigation of the signed-in app, in Lakasir's order (TenantPanelProvider). One line per screen: a session
 * that adds a screen adds or fixes its line here. An entry shows only when its route exists in the route tree and
 * the actor holds its `permission`, so a line for a screen that is not built yet stays hidden until it is.
 */
export type NavItem = { to: string; label: string; icon: LucideIcon; permission?: string }
export type NavGroup = { label?: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/kasir', label: 'Kasir', icon: Zap, permission: 'sales.create' },
      { to: '/kasir/riwayat', label: 'Riwayat penjualan', icon: Banknote },
      // UMK-1963: the shift cash ledger and the store's cash outside every drawer.
      { to: '/kasir/shift', label: 'Riwayat shift', icon: Clock, permission: 'sales.create' },
      { to: '/kasir/kas-laci', label: 'Kas laci', icon: Wallet, permission: 'sales.create' },
      { to: '/kas-toko', label: 'Kas toko', icon: PiggyBank, permission: 'reports.view' },
      { to: '/kas-toko/setoran', label: 'Setoran penagih', icon: HandCoins, permission: 'reports.view' },
      { to: '/pemasok', label: 'Pemasok', icon: ListOrdered, permission: 'purchasing.manage' },
      { to: '/pelanggan', label: 'Pelanggan', icon: UsersRound, permission: 'members.manage' },
      { to: '/metode-pembayaran', label: 'Metode pembayaran', icon: CreditCard, permission: 'catalog.manage' },
      { to: '/piutang', label: 'Piutang', icon: CalendarDays, permission: 'receivables.manage' },
      { to: '/pengeluaran', label: 'Pengeluaran', icon: Receipt, permission: 'expenses.manage' },
    ],
  },
  {
    label: 'Inventori',
    items: [
      { to: '/pembelian', label: 'Pembelian', icon: PackagePlus, permission: 'purchasing.manage' },
      { to: '/stok-opname', label: 'Stok opname', icon: Database, permission: 'purchasing.manage' },
      { to: '/catalog/products', label: 'Produk', icon: Archive },
      { to: '/catalog/categories', label: 'Kategori', icon: Layers },
    ],
  },
  {
    label: 'Pengguna',
    items: [
      { to: '/staf', label: 'Staf', icon: Users, permission: 'staff.manage' },
      { to: '/staf/peran', label: 'Peran', icon: ListChecks, permission: 'staff.manage' },
      { to: '/staf/perangkat', label: 'Perangkat', icon: MonitorSmartphone, permission: 'staff.manage' },
    ],
  },
  {
    items: [
      { to: '/laporan', label: 'Laporan', icon: FileText, permission: 'reports.view' },
      // UMK-1964: who still owes, how much, who is overdue.
      { to: '/laporan/kasbon', label: 'Laporan kasbon', icon: HandCoins, permission: 'reports.view' },
    ],
  },
  { items: [{ to: '/voucher', label: 'Voucher', icon: TicketPercent, permission: 'vouchers.manage' }] },
  {
    items: [
      { to: '/pengaturan', label: 'Pengaturan', icon: Settings, permission: 'catalog.manage' },
      // UMK-1962: each admin's own void PIN; owners hold every permission, so they always see it.
      // UMK-2020: the store's account at a payment gateway; owner only (Admin lacks payments.manage).
      { to: '/pengaturan/pembayaran-online', label: 'Pembayaran Online', icon: Globe, permission: 'payments.manage' },
      // UMK-2041: gateway money that paid no sale, and refused refunds; owner only.
      { to: '/perlu-ditinjau', label: 'Perlu ditinjau', icon: AlertTriangle, permission: 'payments.manage' },
      { to: '/pengaturan/keamanan', label: 'Keamanan', icon: ShieldCheck, permission: 'sales.void' },
    ],
  },
]

/** Route ids that render full-screen, without the shell (Lakasir's POS page uses the bare layout too). */
export const BARE_ROUTES = ['/kasir/', '/kasir/masuk', '/kasir/struk/$id']

/** The groups the actor sees: entries with an existing route and a held permission; empty groups dropped. */
export function visibleNav(nav: NavGroup[], routeExists: (to: string) => boolean, permissions: readonly string[]) {
  return nav
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => routeExists(i.to) && (!i.permission || permissions.includes(i.permission))),
    }))
    .filter((g) => g.items.length > 0)
}

/** The entry for the current page: the longest `to` that is the path or a parent of it (`/staf/peran` beats `/staf`). */
export function activeNav(nav: NavGroup[], pathname: string): string | undefined {
  return nav
    .flatMap((g) => g.items.map((i) => i.to))
    .filter((to) => pathname === to || (to !== '/' && pathname.startsWith(`${to}/`)))
    .sort((a, b) => b.length - a.length)[0]
}
