import { Inject, Injectable, Module } from '@nestjs/common';
import { PAYMENT_ADAPTERS, PaymentAdapter } from './adapter';
import { cashacAdapters } from './cashac.adapter';

/** Method name → adapter, and PG name → adapter. Refuses to boot with two adapters for one method. */
@Injectable()
export class AdapterRegistry {
  private readonly byMethod = new Map<string, PaymentAdapter>();
  private readonly byProvider = new Map<string, PaymentAdapter>();

  constructor(@Inject(PAYMENT_ADAPTERS) adapters: PaymentAdapter[]) {
    for (const adapter of adapters) {
      if (this.byMethod.has(adapter.method))
        throw new Error(`Duplicate payment adapter: ${adapter.method}`);
      this.byMethod.set(adapter.method, adapter);
      // Several methods of one PG share its webhook: the first adapter of a provider reads it.
      if (adapter.provider && !this.byProvider.has(adapter.provider))
        this.byProvider.set(adapter.provider, adapter);
    }
  }

  get(method: string): PaymentAdapter | undefined {
    return this.byMethod.get(method);
  }

  forProvider(provider: string): PaymentAdapter | undefined {
    return this.byProvider.get(provider);
  }
}

@Module({
  providers: [
    // A new PG adapter is added to this list (after the legal gate, UMK-1977). Nothing else changes.
    { provide: PAYMENT_ADAPTERS, useFactory: cashacAdapters },
    AdapterRegistry,
  ],
  exports: [AdapterRegistry],
})
export class AdaptersModule {}
