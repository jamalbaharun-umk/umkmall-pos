import { describe, expect, it } from 'vitest'
import {
  depositableCollectors,
  depositErrors,
  depositToast,
  heldLabel,
  outstandingAfterText,
  storeLine,
  totalHeld,
  type CollectorCash,
} from './-deposit-helpers'

const dedi: CollectorCash = {
  collectorId: 'c1',
  collectorKind: 'cashier',
  collectorName: 'Dedi',
  collected: 500_000,
  handedOver: 150_000,
  outstanding: 350_000,
}
const sari: CollectorCash = { ...dedi, collectorId: 'c2', collectorName: 'Sari', handedOver: 500_000, outstanding: 0 }
const owner: CollectorCash = { ...dedi, collectorId: 'o1', collectorKind: 'owner', collectorName: 'Pemilik', handedOver: 0, outstanding: 80_000 }

describe('depositableCollectors', () => {
  it('lists staff who still hold cash, not the receiver, not owners, not settled collectors', () => {
    expect(depositableCollectors([dedi, sari, owner], undefined).map((c) => c.collectorName)).toEqual(['Dedi'])
    expect(depositableCollectors([dedi, sari, owner], 'c1')).toEqual([])
  })
})

describe('depositErrors', () => {
  it('accepts exactly the outstanding', () => {
    expect(depositErrors({ collectorId: 'c1', amount: 350_000 }, [dedi])).toEqual({})
  })
  it('refuses above the outstanding, naming it', () => {
    expect(depositErrors({ collectorId: 'c1', amount: 350_001 }, [dedi]).amount).toBe(
      'Jumlah melebihi uang yang belum disetor (Rp350.000)',
    )
  })
  it('needs a collector and an amount above 0', () => {
    expect(depositErrors({ collectorId: '', amount: 0 }, [dedi])).toEqual({
      collectorId: 'Pilih siapa yang menyerahkan uang',
      amount: 'Harus lebih dari Rp0',
    })
  })
})

describe('storeLine', () => {
  it('a deposit is a transfer without a sign; in and out keep theirs', () => {
    expect(storeLine({ direction: 'transfer', kind: 'collector_deposit', amount: 350_000 })).toMatchObject({
      label: 'Dipindahkan',
      amount: 'Rp350.000',
      kind: 'Setoran penagih ke kas toko',
    })
    expect(storeLine({ direction: 'in', kind: 'receivable_payment', amount: 2_500 }).amount).toBe('+Rp2.500')
    expect(storeLine({ direction: 'out', kind: 'x', amount: 2_500 })).toMatchObject({ amount: '-Rp2.500', label: 'Kas keluar' })
  })
})

describe('wording', () => {
  it('says what is still held after the deposit', () => {
    expect(outstandingAfterText(100_000, dedi)).toBe('Setelah ini Dedi masih memegang Rp250.000.')
    expect(outstandingAfterText(350_000, dedi)).toBe('Semua uang Dedi sudah disetor.')
    expect(outstandingAfterText(400_000, dedi)).toBeUndefined()
    expect(outstandingAfterText(0, dedi)).toBeUndefined()
  })
  it('shows cash as held by the collector until the deposit is received', () => {
    expect(heldLabel(dedi)).toBe('Dipegang penagih Rp350.000')
    expect(heldLabel(sari)).toBe('Sudah disetor semua')
    expect(heldLabel(owner)).toBe('Dipegang pemilik Rp80.000')
  })
  it('words the toast with the server figure and totals staff only', () => {
    expect(depositToast({ amount: 350_000, collectorName: 'Dedi', outstandingAfter: 0 })).toBe(
      'Setoran Rp350.000 dari Dedi diterima. Masih dipegang Rp0',
    )
    expect(totalHeld([dedi, sari, owner])).toBe(350_000)
  })
})
