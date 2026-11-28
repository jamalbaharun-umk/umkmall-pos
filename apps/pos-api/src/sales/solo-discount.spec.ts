import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import { soloOwnerSelfApproves } from './solo-discount';

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
    permissions: ['sales.create', 'sales.price_override'],
  }) as unknown as PosSession;

describe('UMK-2123: who may approve their own discount above 30% without a PIN', () => {
  it.each(['cashier', 'agent', 'service', '', 'OWNER'])(
    'never a "%s" session, before the database is asked (a store that looks solo included)',
    async (kind) => {
      await expect(
        soloOwnerSelfApproves(untouchable, session(kind)),
      ).resolves.toBe(false);
    },
  );

  it('the owner asks the store’s staff (solo is read from the database, never assumed)', async () => {
    await expect(
      soloOwnerSelfApproves(untouchable, session('owner')),
    ).rejects.toThrow(/the database was reached/);
  });
});
