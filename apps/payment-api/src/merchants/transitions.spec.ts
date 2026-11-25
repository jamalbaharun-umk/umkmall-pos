import { MERCHANT_STATUSES, MerchantStatus } from '../db/schema';
import { canMove, statusFor } from './transitions';

const moves = (by: 'owner' | 'gateway') =>
  MERCHANT_STATUSES.flatMap((from) =>
    MERCHANT_STATUSES.filter((to) => canMove(from, to, by)).map(
      (to) => `${from} → ${to}`,
    ),
  );

describe('merchant account transitions', () => {
  it('lets the owner submit a draft, submit again after a fix, and switch between verified and active only', () => {
    expect(moves('owner')).toEqual([
      'not_submitted → submitted',
      'needs_fix → submitted',
      'verified → active',
      'active → verified',
    ]);
  });

  it('follows the gateway from every status but not_submitted, and never back to it', () => {
    const gateway = moves('gateway');
    expect(gateway.filter((m) => m.startsWith('not_submitted'))).toEqual([]);
    expect(gateway.filter((m) => m.endsWith('→ not_submitted'))).toEqual([]);
    const others = MERCHANT_STATUSES.filter(
      (s): s is MerchantStatus => s !== 'not_submitted',
    );
    // Every other pair, both ways: the gateway's word is the account's status.
    expect(gateway).toHaveLength(others.length * (others.length - 1));
  });

  it('never calls a move to the same status a move', () => {
    for (const s of MERCHANT_STATUSES) {
      expect(canMove(s, s, 'owner')).toBe(false);
      expect(canMove(s, s, 'gateway')).toBe(false);
    }
  });

  it('maps the gateway’s word: pending is submitted, verified is active only while a method is on', () => {
    expect(statusFor('pending', 0)).toBe('submitted');
    expect(statusFor('pending', 2)).toBe('submitted');
    expect(statusFor('needs_fix', 1)).toBe('needs_fix');
    expect(statusFor('rejected', 1)).toBe('rejected');
    expect(statusFor('suspended', 1)).toBe('suspended');
    expect(statusFor('verified', 0)).toBe('verified');
    expect(statusFor('verified', 1)).toBe('active');
  });
});
