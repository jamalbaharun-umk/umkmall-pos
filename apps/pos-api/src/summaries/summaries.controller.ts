import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Module,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { ReportsModule } from '../reports/reports.controller';
import { hasPermission, RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { SummariesService } from './summaries.service';

/** At most Rp1 miliar a day: past that it is a typo. */
const TARGET_MAX = 1_000_000_000;
const TargetInput = z
  .object({
    target: z
      .number({ invalid_type_error: 'Target harus berupa angka' })
      .int('Target harus bilangan bulat')
      .min(1, 'Target minimal Rp1')
      .max(TARGET_MAX, 'Target terlalu besar')
      .nullable(),
  })
  .strict();

/**
 * The summaries above each menu (design feature 39). Each route asks for the permission that opens its menu; what
 * reveals cost, profit or takings (margin, stock value, revenue per category, method, cashier or customer, the
 * store's daily total) also needs `reports.view` and is `null` without it (counts stay). The tenant is always the
 * session's.
 */
@Controller('summaries')
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  private money = (s: PosSession) => hasPermission(s, 'reports.view');

  @Get('sales-history')
  @RequirePermission('reports.view')
  salesHistory(@CurrentSession() s: PosSession) {
    return this.summaries.salesHistory(s.tenantId);
  }

  @Get('members')
  @RequirePermission('members.manage')
  members(@CurrentSession() s: PosSession) {
    return this.summaries.members(
      s.tenantId,
      this.money(s),
      this.money(s) || hasPermission(s, 'receivables.manage'),
    );
  }

  @Get('products')
  @RequirePermission('catalog.manage')
  products(@CurrentSession() s: PosSession) {
    return this.summaries.products(s.tenantId, this.money(s));
  }

  @Get('categories')
  @RequirePermission('catalog.manage')
  categories(@CurrentSession() s: PosSession) {
    return this.summaries.categories(s.tenantId, this.money(s));
  }

  @Get('payment-methods')
  @RequirePermission('catalog.manage')
  paymentMethods(@CurrentSession() s: PosSession) {
    return this.summaries.paymentMethods(s.tenantId, this.money(s));
  }

  @Get('stock-opname')
  @RequirePermission('purchasing.manage')
  stockOpname(@CurrentSession() s: PosSession) {
    return this.summaries.stockOpname(s.tenantId, this.money(s));
  }

  @Get('suppliers')
  @RequirePermission('purchasing.manage')
  suppliers(@CurrentSession() s: PosSession) {
    return this.summaries.suppliers(s.tenantId);
  }

  @Get('vouchers')
  @RequirePermission('vouchers.manage')
  vouchers(@CurrentSession() s: PosSession) {
    return this.summaries.vouchers(s.tenantId);
  }

  @Get('staff')
  @RequirePermission('staff.manage')
  staff(@CurrentSession() s: PosSession) {
    return this.summaries.staff(s.tenantId, this.money(s));
  }

  @Get('setup')
  @RequirePermission('catalog.manage')
  setup(@CurrentSession() s: PosSession) {
    return this.summaries.setup(s.tenantId);
  }

  /**
   * The cashier's finished receipt shows it, so `sales.create` reads it as well as `reports.view`; without
   * `reports.view` it answers the percent only (no rupiah figure).
   */
  @Get('daily-target')
  dailyTarget(@CurrentSession() s: PosSession) {
    if (!hasPermission(s, 'sales.create') && !this.money(s))
      throw new ForbiddenException();
    return this.summaries.dailyTarget(s.tenantId, this.money(s));
  }

  /** Owner ruling: the target is set by the owner. An admin with `catalog.manage` is refused before the body is read. */
  @Put('daily-target')
  @RequirePermission('catalog.manage')
  setDailyTarget(@CurrentSession() s: PosSession, @Body() body: unknown) {
    if (s.kind !== 'owner') throw new ForbiddenException();
    return this.summaries.setDailyTarget(
      s.tenantId,
      validate(TargetInput, body).target,
    );
  }
}

@Module({
  imports: [ReportsModule],
  controllers: [SummariesController],
  providers: [SummariesService],
})
export class SummariesModule {}
