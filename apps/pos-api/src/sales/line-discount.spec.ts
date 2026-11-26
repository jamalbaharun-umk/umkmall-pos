import {
  leavesSomething,
  lineDiscountOf,
  needsApproval,
  withinApproval,
} from './line-discount';
import { saleAmounts } from './sales.service';

describe('line discount arithmetic (UMK-1990)', () => {
  it('an amount is taken as given; a percent is rounded half up on the line total, in whole rupiah', () => {
    expect(lineDiscountOf(20_000, { discountAmount: 2_000 })).toBe(2_000);
    expect(lineDiscountOf(20_000, { discountPercent: 10 })).toBe(2_000);
    // 3 × Rp3.333 = Rp9.999: 15% = 1.499,85 → 1.500; 5% = 499,95 → 500; 1% = 99,99 → 100
    expect(lineDiscountOf(9_999, { discountPercent: 15 })).toBe(1_500);
    expect(lineDiscountOf(9_999, { discountPercent: 5 })).toBe(500);
    // exactly half rounds up, below half rounds down: 50 × 1% = 0,5 → 1; 49 × 1% = 0,49 → 0
    expect(lineDiscountOf(50, { discountPercent: 1 })).toBe(1);
    expect(lineDiscountOf(49, { discountPercent: 1 })).toBe(0);
    expect(lineDiscountOf(20_000, {})).toBe(0);
    // far above any till, still exact
    expect(lineDiscountOf(999_999_999_999, { discountPercent: 33 })).toBe(
      330_000_000_000,
    );
  });

  it('never 100%: Rp1 must stay on the line', () => {
    expect(leavesSomething(19_999, 20_000)).toBe(true);
    expect(leavesSomething(20_000, 20_000)).toBe(false);
    expect(leavesSomething(20_001, 20_000)).toBe(false);
    // 99% of Rp1 rounds to Rp1: refused
    expect(leavesSomething(lineDiscountOf(1, { discountPercent: 99 }), 1)).toBe(
      false,
    );
  });

  it('more than 30% of the line needs a PIN approval; exactly 30% does not', () => {
    expect(needsApproval(6_000, 20_000)).toBe(false);
    expect(needsApproval(6_001, 20_000)).toBe(true);
    expect(
      needsApproval(lineDiscountOf(20_000, { discountPercent: 31 }), 20_000),
    ).toBe(true);
    expect(withinApproval(8_000, 20_000, 4_000)).toBe(true);
    expect(withinApproval(8_001, 20_000, 4_000)).toBe(false);
  });

  it('tax comes after every discount, rounding after tax (the design example)', () => {
    // Subtotal 50.000, line discount 2.000, voucher 3.000, PPN 11%: 45.000 + 4.950, cash rounds 49.950 up to 50.000
    expect(
      saleAmounts({
        subtotal: 50_000,
        discount: 2_000,
        voucherDiscount: 3_000,
        taxBps: 1100,
        isCash: true,
      }),
    ).toEqual({ tax: 4_950, total: 49_950, rounding: 50, amountDue: 50_000 });
    expect(
      saleAmounts({
        subtotal: 50_000,
        discount: 2_000,
        voucherDiscount: 3_000,
        taxBps: 1100,
        isCash: false,
      }),
    ).toEqual({ tax: 4_950, total: 49_950, rounding: 0, amountDue: 49_950 });
  });
});
