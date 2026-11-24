import { PAYMENT_STATUSES, PaymentStatus } from '../db/schema';
import { canMove, CLOSED_UNPAID, RANK } from './transitions';

const pairs = PAYMENT_STATUSES.flatMap((from) =>
  PAYMENT_STATUSES.map((to) => [from, to] as const),
);
const allowed = pairs.filter(([from, to]) => canMove(from, to));

describe('payment status transitions', () => {
  it('allows exactly the moves of the design doc’s status table', () => {
    expect(allowed.map(([from, to]) => `${from}>${to}`).sort()).toEqual(
      [
        'created>pending',
        'created>paid',
        'created>failed',
        'created>expired',
        'created>cancelled',
        'pending>paid',
        'pending>failed',
        'pending>expired',
        'pending>cancelled',
        'paid>voided',
        'paid>refund_pending',
        'refund_pending>refunded',
        'refund_pending>refund_failed',
        'refund_failed>refund_pending',
        'refund_failed>refunded',
      ].sort(),
    );
  });

  it('Rank: created 0 < pending 1 < failed/expired/cancelled 2 < paid 3 < refund_pending 4 < refunded/refund_failed/voided 5', () => {
    expect(RANK).toEqual({
      created: 0,
      pending: 1,
      failed: 2,
      expired: 2,
      cancelled: 2,
      paid: 3,
      refund_pending: 4,
      refunded: 5,
      refund_failed: 5,
      voided: 5,
    });
  });

  it('Rule5: the only move that lowers the rank is refund_failed → refund_pending (the refund is tried again)', () => {
    expect(
      allowed
        .filter(([from, to]) => RANK[to] < RANK[from])
        .map(([from, to]) => `${from}>${to}`),
    ).toEqual(['refund_failed>refund_pending']);
  });

  it('Rule5: from failed, expired or cancelled there is no way to paid, or anywhere', () => {
    for (const from of CLOSED_UNPAID)
      expect(PAYMENT_STATUSES.filter((to) => canMove(from, to))).toEqual([]);
  });

  it('Rank: random sequences of news (reordered, duplicated, dropped) never lower the rank except by the one allowed retry, and never leave a final status', () => {
    let seed = 20261124;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const final: PaymentStatus[] = ['voided', 'refunded'];
    for (let run = 0; run < 500; run++) {
      let status: PaymentStatus = 'created';
      for (let step = 0; step < 30; step++) {
        const news =
          PAYMENT_STATUSES[Math.floor(random() * PAYMENT_STATUSES.length)];
        const before: PaymentStatus = status;
        if (canMove(before, news)) status = news;
        if (RANK[status] < RANK[before])
          expect(`${before}>${status}`).toBe('refund_failed>refund_pending');
        if (final.includes(before)) expect(status).toBe(before);
        if (CLOSED_UNPAID.includes(before)) expect(status).toBe(before);
      }
    }
  });
});
