import { PaymentAdapter, UnsupportedOperationError } from './adapter';
import { AdapterRegistry } from './adapters.module';
import { cashacAdapters } from './cashac.adapter';

const ref = {
  id: 'p',
  tenantId: 't',
  orderRef: 'o',
  method: 'cash',
  amount: 1,
  providerRef: null,
  expiresAt: null,
};
const context = {
  reasonCode: 'other',
  note: 'n',
  actorRef: 'a',
  approvedBy: 's',
};

describe('shipped adapters', () => {
  const shipped = cashacAdapters();

  it('are the three CASHAC methods and nothing else: no PG before the legal gate, and kasbon is not a payment method', () => {
    expect(shipped.map((a) => a.method)).toEqual([
      'cash',
      'edc_debit',
      'static_qris',
    ]);
    expect(new Set(shipped.map((a) => a.kind))).toEqual(new Set(['cashac']));
    expect(shipped.every((a) => a.provider === undefined)).toBe(true);
  });

  it.each(shipped.map((a) => [a.method, a] as const))(
    '%s declares void only, is paid at once, and rejects refund and webhooks',
    async (_, adapter) => {
      expect(adapter).toMatchObject({
        supportsVoid: true,
        supportsRefund: false,
        canCancel: false,
      });
      await expect(adapter.charge(ref)).resolves.toEqual({ status: 'paid' });
      await expect(adapter.getStatus(ref)).resolves.toEqual({ status: 'paid' });
      await expect(adapter.void(ref, context)).resolves.toBeUndefined();
      await expect(
        adapter.refund(ref, { key: 'k', receiptId: null, amount: 1 }, context),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
      await expect(
        adapter.handleWebhook({ headers: {}, rawBody: Buffer.alloc(0) }),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
    },
  );
});

describe('AdapterRegistry', () => {
  it('finds an adapter by method and knows no other', () => {
    const registry = new AdapterRegistry(cashacAdapters());
    expect(registry.get('static_qris')?.method).toBe('static_qris');
    expect(registry.get('kasbon')).toBeUndefined();
    expect(registry.get('fake_qris')).toBeUndefined();
    expect(registry.get('toString')).toBeUndefined();
    expect(registry.forProvider('fake')).toBeUndefined();
  });

  it('refuses two adapters for one method', () => {
    const twice: PaymentAdapter[] = [...cashacAdapters(), ...cashacAdapters()];
    expect(() => new AdapterRegistry(twice)).toThrow(/Duplicate/);
  });
});
