import { Inject, Injectable, Module, Optional } from '@nestjs/common';
import { PAYMENT_ADAPTERS, PaymentAdapter } from './adapter';
import { ONBOARDING_ADAPTERS, OnboardingAdapter } from './onboarding';
import { Clock, loadEnv } from '../config';
import { cashacAdapters } from './cashac.adapter';
import { LocalFakeGateway } from './fake/local-fake-gateway';

/** Method name → adapter, and PG name → adapter. Refuses to boot with two adapters for one method. */
@Injectable()
export class AdapterRegistry {
  private readonly byMethod = new Map<string, PaymentAdapter>();
  private readonly byProvider = new Map<string, PaymentAdapter>();

  private readonly onboardingByProvider = new Map<string, OnboardingAdapter>();

  constructor(
    @Inject(PAYMENT_ADAPTERS) adapters: PaymentAdapter[],
    @Optional()
    @Inject(ONBOARDING_ADAPTERS)
    onboarding: OnboardingAdapter[] = [],
  ) {
    for (const adapter of onboarding) {
      if (this.onboardingByProvider.has(adapter.provider))
        throw new Error(`Duplicate onboarding adapter: ${adapter.provider}`);
      this.onboardingByProvider.set(adapter.provider, adapter);
    }
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

  /** The onboarding contract of a PG, when it has one. */
  onboarding(provider: string): OnboardingAdapter | undefined {
    return this.onboardingByProvider.get(provider);
  }

  onboardingAdapters(): OnboardingAdapter[] {
    return [...this.onboardingByProvider.values()];
  }

  /** The methods a store can switch on at a PG: those its onboarding adapter declares and an adapter serves. */
  methodsOf(provider: string): string[] {
    return (this.onboardingByProvider.get(provider)?.methods ?? []).filter(
      (method) => this.byMethod.get(method)?.provider === provider,
    );
  }
}

@Module({
  providers: [
    // A new PG adapter is added to this list (after the legal gate, UMK-1977). Nothing else changes.
    Clock,
    // The local fake gateway: null unless PAYMENT_ADAPTERS lists `fake` (refused in production).
    {
      provide: LocalFakeGateway,
      inject: [Clock],
      useFactory: (clock: Clock) =>
        loadEnv().PAYMENT_ADAPTERS.includes('fake')
          ? new LocalFakeGateway(clock)
          : null,
    },
    {
      provide: PAYMENT_ADAPTERS,
      inject: [LocalFakeGateway],
      useFactory: (fake: LocalFakeGateway | null) => [
        ...cashacAdapters(),
        ...(fake?.adapters() ?? []),
      ],
    },
    {
      provide: ONBOARDING_ADAPTERS,
      inject: [LocalFakeGateway],
      useFactory: (fake: LocalFakeGateway | null) =>
        fake ? [fake.onboarding()] : [],
    },
    AdapterRegistry,
  ],
  exports: [AdapterRegistry, LocalFakeGateway],
})
export class AdaptersModule {}
