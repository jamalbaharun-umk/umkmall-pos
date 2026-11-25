import { ForbiddenException } from '@nestjs/common';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import { CashEntriesService } from './cash-entries.service';
import type { ShiftsService } from './shifts.service';
import {
  assertMayMoveDrawerCash,
  assertPersonAtTill,
  recordShiftCashAt,
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
    await expect(
      recordShiftCashAt(untouchable, agent, undefined, entry('out'), 'Buka'),
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

  // Design fitur 20: an agent records neither cash out nor cash IN by hand, and corrects nothing.
  it('cash recorded by hand is for people at the till, in both directions', () => {
    for (const kind of ['owner', 'cashier'])
      expect(() => assertPersonAtTill(kind)).not.toThrow();
    for (const kind of ['agent', 'service', '', 'OWNER']) {
      let refusal: unknown;
      try {
        assertPersonAtTill(kind);
      } catch (e) {
        refusal = e;
      }
      expect(refusal).toBeInstanceOf(ForbiddenException);
      // The usual 403 body plus the stable code.
      expect((refusal as ForbiddenException).getResponse()).toEqual({
        message:
          'Uang laci hanya bisa dicatat dari POS oleh kasir atau pemilik',
        error: 'Forbidden',
        statusCode: 403,
        code: 'AGENT_FORBIDDEN',
      });
    }
    // The ledger's own refusal of a cash-out carries the same code.
    try {
      assertMayMoveDrawerCash('agent', 'out');
      throw new Error('not refused');
    } catch (e) {
      expect((e as ForbiddenException).getResponse()).toMatchObject({
        statusCode: 403,
        code: 'AGENT_FORBIDDEN',
      });
    }
  });

  it('the manual cash service refuses an agent cash-in and cash-out before it reaches the database', async () => {
    const service = new CashEntriesService(
      untouchable,
      untouchable as unknown as ShiftsService,
    );
    for (const direction of ['in', 'out'] as const)
      await expect(
        service.create(session('agent'), 'key-12345678', {
          direction,
          amount: 1000,
          reason: 'lainnya',
          note: 'uji',
        }),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'AGENT_FORBIDDEN' },
      });
    // A cashier is not refused by the rule: the next thing the service does is ask the database.
    await expect(
      service.create(session('cashier'), 'key-12345678', {
        direction: 'in',
        amount: 1000,
        reason: 'tambah_modal',
      }),
    ).rejects.toThrow(/the database was reached/);
  });
});
