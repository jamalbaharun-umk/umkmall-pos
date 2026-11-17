import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CatalogModule } from './catalog/catalog.module';
import { AuthController } from './auth/auth.controller';
import { DbModule } from './db/db.module';
import { StaffModule } from './staff/staff.module';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './tenancy/session.guard';
import { TenancyController } from './tenancy/tenancy.controller';

@Module({
  imports: [DbModule, CatalogModule, StaffModule],
  controllers: [HealthController, TenancyController, AuthController],
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
