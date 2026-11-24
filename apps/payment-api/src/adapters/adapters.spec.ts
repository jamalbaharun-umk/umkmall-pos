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
};
const context = { reason: 'r', actorRef: 'a', approvedBy: 's' };

describe('shipped adapters', () => {
  const shipped = cashacAdapters();

  it('are the four CASHAC methods and nothing else (no PG before the legal gate)', () => {
    expect(shipped.map((a) => a.method)).toEqual([
      'cash',
      'edc_debit',
      'static_qris',
      'kasbon',
    ]);
    expect(new Set(shipped.map((a) => a.kind))).toEqual(new Set(['cashac']));
  });

  it.each(shipped.map((a) => [a.method, a] as const))(
    '%s declares void only, is paid at once, and rejects refund and webhooks',
    async (_, adapter) => {
      expect(adapter.supportsVoid).toBe(true);
      expect(adapter.supportsRefund).toBe(false);
      await expect(adapter.charge(ref)).resolves.toEqual({ status: 'paid' });
      await expect(adapter.getStatus(ref)).resolves.toEqual({ status: 'paid' });
      await expect(adapter.void(ref, context)).resolves.toBeUndefined();
      await expect(adapter.refund(ref, context)).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
      await expect(
        adapter.handleWebhook({ headers: {}, rawBody: Buffer.alloc(0) }),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
    },
  );
});

describe('AdapterRegistry', () => {
  it('finds an adapter by method and knows no other', () => {
    const registry = new AdapterRegistry(cashacAdapters());
    expect(registry.get('kasbon')?.method).toBe('kasbon');
    expect(registry.get('fake_online')).toBeUndefined();
    expect(registry.get('toString')).toBeUndefined();
  });

  it('refuses two adapters for one method', () => {
    const twice: PaymentAdapter[] = [...cashacAdapters(), ...cashacAdapters()];
    expect(() => new AdapterRegistry(twice)).toThrow(/Duplicate/);
  });
});
