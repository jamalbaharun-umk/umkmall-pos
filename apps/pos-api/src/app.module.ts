import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './tenancy/session.guard';
import { TenancyController } from './tenancy/tenancy.controller';

@Module({
  imports: [DbModule],
  controllers: [HealthController, TenancyController],
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
