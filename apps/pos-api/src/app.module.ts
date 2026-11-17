import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CatalogModule } from './catalog/catalog.module';
import { AuthController } from './auth/auth.controller';
import { DbModule } from './db/db.module';
import { StaffModule } from './staff/staff.module';
import { StockModule } from './stock/stock.module';
import { SuppliersModule } from './suppliers/suppliers.controller';
import { PurchasingModule } from './purchasing/purchasing.controller';
import { StockOpnameModule } from './stock-opname/stock-opname.controller';
import { SalesModule } from './sales/sales.module';
import { ReportsModule } from './reports/reports.controller';
import { ShiftsModule } from './shifts/shifts.module';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './tenancy/session.guard';
import { TenancyController } from './tenancy/tenancy.controller';

@Module({
  imports: [
    DbModule,
    CatalogModule,
    StaffModule,
    StockModule,
    SuppliersModule,
    PurchasingModule,
    StockOpnameModule,
    ShiftsModule,
    SalesModule,
    ReportsModule,
  ],
  controllers: [HealthController, TenancyController, AuthController],
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
