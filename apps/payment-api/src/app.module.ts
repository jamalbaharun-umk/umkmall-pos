import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ServiceGuard } from './auth/service.guard';
import { ErrorFilter } from './common/error.filter';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { PaymentsModule } from './payments/payments.controller';
import { PurgeModule } from './purge/purge.controller';

@Module({
  imports: [DbModule, PaymentsModule, PurgeModule],
  controllers: [HealthController],
  providers: [
    // Global: a new route is behind the service key and the tenant header unless it says @Public().
    { provide: APP_GUARD, useClass: ServiceGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
