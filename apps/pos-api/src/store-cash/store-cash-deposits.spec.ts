import type { Db } from '../db/db.module';
import type { PosSession } from '../tenancy/session';
import { StoreCashDepositsService } from './store-cash-deposits.service';

// Design fitur 21: "Asisten otomatis (agent) tidak bisa mencatat setoran." tenancy/session.ts has no
// agent session kind yet (UMK-1983), so the rule is proven on the service: a kind that is not a person
// at the till is refused before the service asks the database anything.

/** A database that fails the test when anything is asked of it. */
const untouchable = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`the database was reached (${String(property)})`);
    },
  },
) as Db;

const session = (kind: string) =>
  ({
    tenantId: '00000000-0000-4000-8000-000000000001',
    actorId: '00000000-0000-4000-8000-000000000002',
    kind,
    permissions: ['store_cash.manage', 'sales.create'],
  }) as unknown as PosSession;

const input = {
  collectorId: '00000000-0000-4000-8000-000000000003',
  amount: 1000,
};

describe('setoran penagih: who may record a deposit', () => {
  const service = new StoreCashDepositsService(untouchable);

  it.each(['agent', 'service', '', 'OWNER'])(
    'refuses session kind "%s", whatever its permissions, before the database',
    async (kind) => {
      await expect(
        service.create(session(kind), 'key-12345678', input),
      ).rejects.toMatchObject({
        status: 403,
        response: { statusCode: 403, code: 'AGENT_FORBIDDEN' },
      });
    },
  );

  it.each(['owner', 'cashier'])(
    'lets a %s through to the database',
    async (kind) => {
      await expect(
        service.create(session(kind), 'key-12345678', input),
      ).rejects.toThrow(/the database was reached/);
    },
  );
});
