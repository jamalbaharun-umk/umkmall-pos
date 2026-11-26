import { describe, expect, it } from 'vitest'
import {
  dayMonth,
  normalizePhone,
  receiptMessage,
  reminderMessage,
  remindedAgainNote,
  shortDate,
  whatsappLink,
  type ReceiptSource,
} from './whatsapp'

const digits = (s: string) => {
  const p = normalizePhone(s)
  return p.ok ? p.digits : null
}

describe('normalizePhone', () => {
  it.each([
    ['0812 3456 7890', '6281234567890'],
    ['081234567890', '6281234567890'],
    ['+62 812-3456-7890', '6281234567890'],
    ['62812 3456 7890', '6281234567890'],
    ['0062 812 3456 7890', '6281234567890'],
    ['812 3456 7890', '6281234567890'],
    ['(0812) 3456.7890', '6281234567890'],
    ['  0857 1234 567  ', '628571234567'],
    ['+65 9123 4567', '6591234567'],
  ])('%s → %s', (raw, want) => {
    expect(digits(raw)).toBe(want)
  })

  it('gives the spaced display form', () => {
    expect(normalizePhone('0812 3456 7890')).toEqual({ ok: true, digits: '6281234567890', display: '+62 812 3456 7890' })
    expect(normalizePhone('0857123456')).toMatchObject({ display: '+62 857 1234 56' })
  })

  it.each([
    [''],
    ['   '],
    ['0812'], // incomplete (the design's example)
    ['0812 345'],
    ['0812 3456 7890 12345'], // too long
    ['0212 345 678'], // landline
    ['abc'],
    ['0812-3456-78x0'],
    ['08123456+7890'],
    ['65 9123 4567'], // another country without + or 00
    ['+0'],
    ['+62'],
  ])('refuses %j', (raw) => {
    expect(normalizePhone(raw)).toEqual({ ok: false })
  })
})

describe('whatsappLink', () => {
  it('puts the number in the path and the message encoded', () => {
    const url = whatsappLink('6281234567890', 'Halo & selamat\nRp1.000 ✓')
    expect(url.startsWith('https://wa.me/6281234567890?text=')).toBe(true)
    expect(url).not.toMatch(/\s/)
    expect(decodeURIComponent(url.split('text=')[1])).toBe('Halo & selamat\nRp1.000 ✓')
  })
})

describe('dates', () => {
  it('shortDate reads the store day, not the UTC day', () => {
    // 2026-11-25 20:30 UTC is 03:30 WIB on the 26th.
    expect(shortDate('2026-11-25T20:30:00Z', 'Asia/Jakarta')).toBe('26 Nov 2026')
    expect(shortDate('2026-11-25T20:30:00Z', 'UTC')).toBe('25 Nov 2026')
    expect(shortDate('2026-12-01T01:00:00Z')).toBe('1 Des 2026')
  })
  it('dayMonth drops the current year only', () => {
    expect(dayMonth('2026-11-14', 2026)).toBe('14 Nov')
    expect(dayMonth('2025-11-14', 2026)).toBe('14 Nov 2025')
    expect(dayMonth('2026-12-01', 2026)).toBe('1 Des')
  })
})

const sale: ReceiptSource = {
  number: 144,
  paymentMethod: 'Tunai',
  lines: [
    { name: 'Indomie Goreng', qty: 5, unitPrice: 3500 },
    { name: 'Teh Botol', qty: 4, unitPrice: 4500 },
  ],
  subtotal: 35500,
  discount: 0,
  voucherDiscount: 0,
  tax: 0,
  taxBps: 0,
  total: 35500,
  rounding: 0,
  receivableRest: null,
}

describe('receiptMessage', () => {
  it('reads like the design for a plain sale', () => {
    expect(receiptMessage(sale, 'Warung Bu Sari', '2026-11-26T03:00:00Z')).toBe(
      [
        'Terima kasih sudah belanja di Warung Bu Sari.',
        'Struk #144 · 26 Nov 2026',
        'Indomie Goreng 5 × Rp3.500',
        'Teh Botol 4 × Rp4.500',
        'Total Rp35.500 (tunai)',
        'Sampai jumpa lagi!',
      ].join('\n'),
    )
  })

  it('adds a line only for what the receipt has: discounts, voucher, tax, rounding, kasbon', () => {
    const m = receiptMessage(
      {
        ...sale,
        lines: [
          { name: 'Gula', qty: 2, unit: 'kg', unitQty: 10, unitPrice: 14000, discount: 1000 },
          { name: 'Kopi', qty: 1, unit: 'pcs', unitQty: 1, unitPrice: 2000 },
        ],
        discount: 3000, // 1.000 on the line, 2.000 on the order
        lineDiscount: 1000,
        voucherDiscount: 500,
        tax: 2300,
        taxBps: 1100,
        total: 25800,
        rounding: -300,
        receivableRest: 10000,
        paymentMethod: 'Kasbon',
      },
      'Toko',
      '2026-11-26T03:00:00Z',
    )
    expect(m).toContain('Gula 2 kg × Rp14.000\n  Diskon Rp1.000')
    expect(m).toContain('Kopi 1 × Rp2.000')
    expect(m).toContain('\nDiskon Rp2.000\n')
    expect(m).toContain('\nVoucher Rp500\n')
    expect(m).toContain('\nPajak 11% Rp2.300\n')
    expect(m).toContain('Total Rp25.800 (kasbon)')
    expect(m).toContain('Pembulatan −Rp300')
    expect(m).toContain('Sisa kasbon Rp10.000')
    expect(receiptMessage(sale, 'T', '2026-11-26T03:00:00Z')).not.toMatch(/Diskon|Voucher|Pajak|Pembulatan|kasbon/)
  })
})

describe('reminderMessage', () => {
  it('is the polite message for a balance past due', () => {
    expect(
      reminderMessage({ memberName: 'Bu Rina', rest: 1250000, dueDate: '2026-11-14', overdueDays: 12 }, 'Warung Bu Sari', 2026),
    ).toBe(
      'Halo Bu Rina, kami dari Warung Bu Sari. Mengingatkan kasbon Rp1.250.000 yang jatuh tempo 14 Nov. Terima kasih, mohon konfirmasi bila sudah dibayar.',
    )
  })
  it('is softer when it is not due yet', () => {
    const m = reminderMessage({ memberName: 'Toko Berkah', rest: 650000, dueDate: '2026-12-01', overdueDays: 0 }, 'Warung Bu Sari', 2026)
    expect(m).toBe('Halo Toko Berkah, kami dari Warung Bu Sari. Mengingatkan jatuh tempo kasbon Rp650.000 pada 1 Des. Terima kasih.')
    expect(m).not.toContain('mohon konfirmasi')
  })
})

describe('remindedAgainNote', () => {
  it('asks only when reminded under three days ago', () => {
    expect(remindedAgainNote('Bu Rina', 2)).toBe('Bu Rina terakhir diingatkan 2 hari lalu. Tetap kirim?')
    expect(remindedAgainNote('Bu Rina', 0)).toBe('Bu Rina terakhir diingatkan hari ini. Tetap kirim?')
    expect(remindedAgainNote('Bu Rina', 3)).toBeNull()
    expect(remindedAgainNote('Bu Rina', null)).toBeNull()
  })
})
