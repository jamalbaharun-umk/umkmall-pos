import { describe, expect, it } from 'vitest'
import { NAV, activeNav, visibleNav } from './nav'

describe('nav config', () => {
  const all = (to: string) => NAV.flatMap((g) => g.items).some((i) => i.to === to)

  it('hides entries whose route does not exist yet', () => {
    const built = new Set(['/', '/catalog/products'])
    const groups = visibleNav(NAV, (to) => built.has(to), ['catalog.manage'])
    expect(groups.flatMap((g) => g.items.map((i) => i.to))).toEqual(['/', '/catalog/products'])
    expect(groups.map((g) => g.label)).toEqual([undefined, 'Inventori'])
  })

  it('hides entries the actor has no permission for', () => {
    const items = visibleNav(NAV, all, ['sales.create']).flatMap((g) => g.items.map((i) => i.to))
    expect(items).toContain('/kasir')
    expect(items).not.toContain('/staf')
    expect(items).not.toContain('/pembelian')
  })

  it('marks the most specific entry active', () => {
    expect(activeNav(NAV, '/staf/peran')).toBe('/staf/peran')
    expect(activeNav(NAV, '/staf/123')).toBe('/staf')
    expect(activeNav(NAV, '/kasir/riwayat')).toBe('/kasir/riwayat')
    expect(activeNav(NAV, '/catalog/products/abc/ubah')).toBe('/catalog/products')
    expect(activeNav(NAV, '/')).toBe('/')
  })
})

describe('Pengeluaran entry (UMK-1984)', () => {
  it('shows only with expenses.manage', () => {
    const shown = (perms: string[]) =>
      visibleNav(NAV, () => true, perms).flatMap((g) => g.items.map((i) => i.to)).includes('/pengeluaran')
    expect(shown(['reports.view', 'sales.create'])).toBe(false)
    expect(shown(['expenses.manage'])).toBe(true)
  })
})

describe('U7 entries (QA sweep U7)', () => {
  it('a cashier with only sales.create sees none of the U7 screens; the owner sees all four', () => {
    const u7 = ['/pelanggan', '/metode-pembayaran', '/piutang', '/voucher']
    const shown = (perms: string[]) =>
      visibleNav(NAV, () => true, perms).flatMap((g) => g.items.map((i) => i.to)).filter((to) => u7.includes(to))
    expect(shown(['sales.create'])).toEqual([])
    expect(shown(['sales.create', 'members.manage', 'catalog.manage', 'receivables.manage', 'vouchers.manage']).sort()).toEqual(
      [...u7].sort(),
    )
  })
})

describe('Cash drawer and deposit entries (UMK-1924 U3)', () => {
  const shown = (perms: string[]) => visibleNav(NAV, () => true, perms).flatMap((g) => g.items.map((i) => i.to))
  it('Kas laci needs sales.create; Setoran penagih needs reports.view', () => {
    expect(shown(['sales.create'])).toContain('/kasir/kas-laci')
    expect(shown(['sales.create'])).not.toContain('/kas-toko/setoran')
    expect(shown(['reports.view'])).toContain('/kas-toko/setoran')
    expect(shown(['reports.view'])).not.toContain('/kasir/kas-laci')
  })
  it('the deposit history does not light up the store cash entry', () => {
    expect(activeNav(NAV, '/kas-toko/setoran')).toBe('/kas-toko/setoran')
    expect(activeNav(NAV, '/kas-toko')).toBe('/kas-toko')
  })
})

describe('Keamanan entry (UMK-1962)', () => {
  const shown = (perms: string[]) =>
    visibleNav(NAV, () => true, perms).flatMap((g) => g.items.map((i) => i.to)).includes('/pengaturan/keamanan')
  it('shows only with sales.void', () => {
    expect(shown(['sales.create', 'catalog.manage'])).toBe(false)
    expect(shown(['sales.void'])).toBe(true)
  })
  it('is the active entry of its own page, not Pengaturan', () => {
    expect(activeNav(NAV, '/pengaturan/keamanan')).toBe('/pengaturan/keamanan')
    expect(activeNav(NAV, '/pengaturan')).toBe('/pengaturan')
  })
})

describe('Pembayaran Online entry (UMK-2020)', () => {
  const shown = (perms: string[]) =>
    visibleNav(NAV, () => true, perms).flatMap((g) => g.items.map((i) => i.to)).includes('/pengaturan/pembayaran-online')
  it('shows only with payments.manage, which only the owner holds by default', () => {
    expect(shown(['catalog.manage', 'staff.manage', 'sales.create'])).toBe(false)
    expect(shown(['payments.manage'])).toBe(true)
  })
  it('highlights itself, not Pengaturan', () => {
    expect(activeNav(NAV, '/pengaturan/pembayaran-online')).toBe('/pengaturan/pembayaran-online')
  })
})
