import { creditOf, debtOf, refundsDue } from './debt';

describe('purchase debt (UMK-1970)', () => {
  it('splits what returns put above the total, oldest first, by the payments now', () => {
    // Paid in full (150.000), then 30.000 and 15.000 back: both wholly due back.
    expect(refundsDue(150_000, 150_000, [30_000, 15_000])).toEqual([
      30_000, 15_000,
    ]);
    // The payment voided: nothing above the total any more.
    expect(refundsDue(150_000, 0, [30_000, 15_000])).toEqual([0, 0]);
    // Paid 130.000: the first return crosses the total by 10.000, the second is wholly above it.
    expect(refundsDue(150_000, 130_000, [30_000, 15_000])).toEqual([
      10_000, 15_000,
    ]);
  });

  it('a debt never goes below 0; late only while something is owed', () => {
    expect(
      debtOf({
        status: 'approved',
        total: 100,
        paid: 100,
        returned: 30,
        dueInDays: -3,
      }),
    ).toMatchObject({
      remaining: 0,
      credit: 30,
      paymentStatus: 'lunas',
      overdueDays: null,
    });
    expect(
      debtOf({
        status: 'approved',
        total: 100,
        paid: 10,
        returned: 0,
        dueInDays: -3,
      }),
    ).toMatchObject({
      remaining: 90,
      paymentStatus: 'sebagian',
      overdueDays: 3,
    });
  });

  it('money handed back lowers what is still due back, never the debt', () => {
    // Paid 100 of 100, 30 returned: 30 due back; 20 of it handed back leaves 10.
    expect(
      debtOf({
        status: 'approved',
        total: 100,
        paid: 100,
        returned: 30,
        refunded: 20,
        dueInDays: null,
      }),
    ).toMatchObject({
      remaining: 0,
      credit: 30,
      refunded: 20,
      refundDue: 10,
      paymentStatus: 'lunas',
    });
    // Without refunds the figures are as before.
    expect(
      debtOf({
        status: 'approved',
        total: 100,
        paid: 40,
        returned: 0,
        dueInDays: null,
      }),
    ).toMatchObject({ remaining: 60, credit: 0, refunded: 0, refundDue: 0 });
    // A draft owes nothing and is owed nothing.
    expect(
      debtOf({
        status: 'draft',
        total: 100,
        paid: 0,
        returned: 0,
        dueInDays: null,
      }),
    ).toMatchObject({ remaining: null, refundDue: 0 });
  });

  it('the credit a void or an undo would leave', () => {
    expect(creditOf(100, 100, 30)).toBe(30);
    expect(creditOf(100, 100, 0)).toBe(0);
    expect(creditOf(100, 50, 30)).toBe(0);
  });
});
