import { saleAmounts } from './sales.service';

describe('saleAmounts: the one arithmetic of a sale and its quote', () => {
  it('taxes after both discounts and rounds only cash, outside the total', () => {
    expect(
      saleAmounts({
        subtotal: 30246,
        discount: 0,
        voucherDiscount: 0,
        taxBps: 1100,
        isCash: true,
      }),
    ).toEqual({ tax: 3327, total: 33573, rounding: 27, amountDue: 33600 });
    // debit / QRIS / kasbon owe the exact total
    expect(
      saleAmounts({
        subtotal: 30246,
        discount: 0,
        voucherDiscount: 0,
        taxBps: 1100,
        isCash: false,
      }),
    ).toEqual({ tax: 3327, total: 33573, rounding: 0, amountDue: 33573 });
    // a voucher and a manual discount both come off before tax
    expect(
      saleAmounts({
        subtotal: 50000,
        discount: 5000,
        voucherDiscount: 10000,
        taxBps: 1000,
        isCash: true,
      }),
    ).toEqual({ tax: 3500, total: 38500, rounding: 0, amountDue: 38500 });
  });
});
