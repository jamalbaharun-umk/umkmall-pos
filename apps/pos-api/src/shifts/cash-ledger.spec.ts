import { ForbiddenException } from '@nestjs/common';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import {
  assertMayMoveDrawerCash,
  type CashEntry,
  DRAWER_CASH_OUT_ACTOR_KINDS,
  recordShiftCash,
  recordShiftCashIfOpen,
  recordShiftCashInShift,
} from './cash-ledger';

// Owner ruling: an agent can NEVER take cash out of a drawer. tenancy/session.ts has no agent session
// kind yet (UMK-1983), so the rule is proven on the ledger itself: a kind off the allow-list is refused
// before the ledger asks the database anything.

/** A transaction that fails the test when anything is asked of it. */
const untouchable = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`the database was reached (${String(property)})`);
    },
  },
) as Tx;

const session = (kind: string) =>
  ({
    tenantId: '00000000-0000-4000-8000-000000000001',
    actorId: '00000000-0000-4000-8000-000000000002',
    kind,
    permissions: ['sales.create', 'expenses.manage', 'sales.void'],
  }) as unknown as PosSession;

const entry = (direction: 'in' | 'out'): CashEntry => ({
  direction,
  kind: direction === 'in' ? 'manual_in' : 'manual_out',
  amount: 1000,
});

describe('shift cash ledger: who may take cash out of a drawer', () => {
  it('allows people at the till only', () => {
    expect([...DRAWER_CASH_OUT_ACTOR_KINDS].sort()).toEqual([
      'cashier',
      'owner',
    ]);
    for (const kind of ['owner', 'cashier'])
      expect(() => assertMayMoveDrawerCash(kind, 'out')).not.toThrow();
  });

  it.each(['agent', 'service', '', 'OWNER'])(
    'refuses a cash-out for session kind "%s", whatever its permissions',
    (kind) => {
      expect(() => assertMayMoveDrawerCash(kind, 'out')).toThrow(
        ForbiddenException,
      );
      // Cash in is not the rule's subject.
      expect(() => assertMayMoveDrawerCash(kind, 'in')).not.toThrow();
    },
  );

  it('every writer refuses an agent cash-out before it reaches the database', async () => {
    const agent = session('agent');
    await expect(
      recordShiftCashIfOpen(untouchable, agent, entry('out')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      recordShiftCash(untouchable, agent, entry('out'), 'Buka shift dulu'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      recordShiftCashInShift(
        untouchable,
        agent,
        '00000000-0000-4000-8000-000000000003',
        entry('out'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The same kinds of entry (a drawer expense, a void return) are refused too.
    await expect(
      recordShiftCashIfOpen(untouchable, agent, {
        direction: 'out',
        kind: 'void_refund',
        amount: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a cashier cash-out and an agent cash-in through to the database', async () => {
    // Not refused by the rule: the next thing each does is ask the database (which this fake refuses).
    await expect(
      recordShiftCashIfOpen(untouchable, session('cashier'), entry('out')),
    ).rejects.toThrow(/the database was reached/);
    await expect(
      recordShiftCashIfOpen(untouchable, session('agent'), entry('in')),
    ).rejects.toThrow(/the database was reached/);
  });
});
