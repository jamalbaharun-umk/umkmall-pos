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
