import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { FakeGatewayModule } from './adapters/fake/fake-gateway.controller';
import { ServiceGuard } from './auth/service.guard';
import { adapterListed } from './config';
import { ErrorFilter } from './common/error.filter';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { PaymentsModule } from './payments/payments.controller';
import { PurgeModule } from './purge/purge.controller';

@Module({
  imports: [
    DbModule,
    PaymentsModule,
    PurgeModule,
    // Local only: the fake gateway's control routes exist only when PAYMENT_ADAPTERS lists `fake`.
    ...(adapterListed('fake') ? [FakeGatewayModule] : []),
  ],
  controllers: [HealthController],
  providers: [
    // Global: a new route is behind the service key and the tenant header unless it says @Public().
    { provide: APP_GUARD, useClass: ServiceGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
