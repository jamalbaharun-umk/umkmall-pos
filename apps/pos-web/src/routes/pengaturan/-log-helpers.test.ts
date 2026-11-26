import { describe, expect, it } from 'vitest'
import {
  actionLabel,
  actorLabel,
  detailLines,
  detailText,
  isFiltered,
  parseSearch,
  queryOf,
  signedRupiah,
  staffOptions,
  targetLabel,
  whenLabel,
  type LogRow,
} from './-log-helpers'

const row = (over: Partial<LogRow> = {}): LogRow => ({
  id: 'r1',
  occurredAt: '2026-11-26T03:12:00.000Z',
  event: 'void',
  group: 'money',
  actor: { id: 'a', kind: 'cashier', name: 'Rina' },
  target: { type: 'sale', id: 's', label: '#139' },
  details: { total: 130536, reasonCode: 'wrong_item_or_qty' },
  ...over,
})
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('Log aktivitas (UMK-1969)', () => {
  it('reads the filters from the address, ignoring what it does not know', () => {
    expect(parseSearch({})).toEqual({})
    expect(parseSearch({ group: 'money', period: '30', staff: ID })).toEqual({ group: 'money', period: '30', staff: ID })
    expect(parseSearch({ group: 'all', period: '7' })).toEqual({}) // defaults are not kept
    expect(parseSearch({ group: 'x', period: '5', staff: 'bob' })).toEqual({})
    expect(parseSearch({ staff: 'owner' })).toEqual({ staff: 'owner' })
    expect(parseSearch({ group: ['money'], staff: 3 })).toEqual({})
  })

  it('asks for 20 rows of the last 7 days unless told otherwise', () => {
    expect(queryOf({}, 1)).toBe('page=1&perPage=20&days=7')
    expect(queryOf({ group: 'access', staff: 'owner', period: '30' }, 3)).toBe('page=3&perPage=20&group=access&actor=owner&days=30')
    expect(queryOf({ period: 'all' }, 2)).toBe('page=2&perPage=20')
    expect(isFiltered({})).toBe(false)
    expect(isFiltered({ period: 'all' })).toBe(true)
    expect(isFiltered({ staff: 'owner' })).toBe(true)
  })

  it('names who did what to what', () => {
    expect(actorLabel(row().actor)).toBe('Rina')
    expect(actorLabel({ id: 'o', kind: 'owner', name: null })).toBe('Pemilik')
    expect(actorLabel({ id: 'g', kind: 'agent', name: null })).toBe('Agen UMKMall')
    expect(actorLabel({ id: 'x', kind: 'cashier', name: null })).toBe('Staf yang sudah dihapus')
    expect(actionLabel('shift_close')).toBe('Tutup shift')
    expect(actionLabel('whatever')).toBe('Aksi lain')
    expect(targetLabel(row())).toBe('Struk #139')
    expect(targetLabel(row({ target: { type: 'device', id: 'd', label: 'Tablet lama' } }))).toBe('Tablet lama')
    expect(targetLabel(row({ target: null }))).toBe('')
  })

  it('says the figures of the designed rows', () => {
    expect(detailText(row())).toBe('Rp130.536 · Salah input barang atau jumlah')
    expect(detailText(row({ event: 'price_override', details: { listPrice: 5000, unitPrice: 4500, qty: 2 } }))).toBe('Rp5.000 jadi Rp4.500 · jumlah 2')
    expect(detailText(row({ event: 'shift_close', details: { difference: -5000 } }))).toBe('Selisih −Rp5.000')
    expect(detailText(row({ event: 'shift_close', details: { difference: 0 } }))).toBe('Selisih Rp0')
    expect(detailText(row({ event: 'drawer_cash_out', details: { amount: 10000, reason: 'setor_bank' } }))).toBe('Rp10.000 · Setor ke bank')
    expect(detailText(row({ event: 'staff_update', details: { changed: ['name', 'credential'] } }))).toBe('Diubah: nama, PIN')
    expect(
      detailText(row({ event: 'role_update', details: { added: ['sales.void'], removed: ['reports.view'] } }), (k) => (k === 'sales.void' ? 'Void' : 'Laporan')),
    ).toBe('Tambah izin Void · Cabut izin Laporan')
    expect(detailText(row({ event: 'sign_in', details: { deviceId: ID } }))).toBe('')
    expect(signedRupiah(2000)).toBe('+Rp2.000')
  })

  it('shows only the facts a row holds in its expanded view', () => {
    const lines = detailLines(row(), 'Asia/Jakarta')
    expect(lines.map((l) => l[0])).toEqual(['Waktu', 'Siapa', 'Aksi', 'Target', 'Jumlah', 'Alasan'])
    expect(lines.find((l) => l[0] === 'Jumlah')?.[1]).toBe('Rp130.536')
    expect(detailLines(row({ event: 'sign_in', target: null, details: { deviceId: ID } }), 'Asia/Jakarta').map((l) => l[0])).toEqual(['Waktu', 'Siapa', 'Aksi'])
  })

  it('writes the time in the store timezone', () => {
    expect(whenLabel('2026-11-26T03:12:00.000Z', 'Asia/Jakarta')).toMatch(/^26 Nov,? 10[.:]12$/)
    expect(whenLabel('2026-11-25T17:30:00.000Z', 'Asia/Jayapura')).toMatch(/^26 Nov,? 02[.:]30$/)
    expect(whenLabel('2026-11-26T03:12:00.000Z', 'Not/AZone')).toMatch(/10[.:]12$/)
    expect(whenLabel('nope', 'Asia/Jakarta')).toBe('-')
  })

  it('offers everyone, the owner and the staff by name', () => {
    expect(staffOptions([{ id: ID, name: 'Rina' }])).toEqual([
      { value: 'all', label: 'Semua' },
      { value: 'owner', label: 'Pemilik' },
      { value: ID, label: 'Rina' },
    ])
  })
})
