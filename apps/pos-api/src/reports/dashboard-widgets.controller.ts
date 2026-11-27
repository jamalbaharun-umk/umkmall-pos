import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { validate as parse } from '../common/validation';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import { DashboardQuery, PERIODS } from './reports.schemas';

const asText = (v: unknown) =>
  v === undefined ? undefined : typeof v === 'string' ? v : '\u0000';

const PERIOD_MESSAGE =
  'Periode harus hari ini, minggu ini, bulan ini atau tahun ini';
/** A query with `period` (default `week`) and `limit` (default 5, 1 to 10). */
const TopQuery = z.object({
  period: z.preprocess(
    (v) => asText(v) ?? 'week',
    z.enum(PERIODS, { errorMap: () => ({ message: PERIOD_MESSAGE }) }),
  ),
  limit: z.preprocess(
    (v) => (asText(v) === undefined ? 5 : Number(asText(v))),
    z
      .number({ invalid_type_error: 'Jumlah baris harus berupa angka' })
      .int('Jumlah baris harus bilangan bulat')
      .min(1, 'Jumlah baris paling sedikit 1')
      .max(10, 'Jumlah baris paling banyak 10'),
  ),
});
const LimitQuery = TopQuery.pick({ limit: true });
/** `limit` as above and `days` (default 30, 1 to 365): how far ahead a date still counts as expiring soon. */
const ExpiringQuery = LimitQuery.extend({
  days: z.preprocess(
    (v) => (asText(v) === undefined ? 30 : Number(asText(v))),
    z
      .number({ invalid_type_error: 'Jumlah hari harus berupa angka' })
      .int('Jumlah hari harus bilangan bulat')
      .min(1, 'Jumlah hari paling sedikit 1')
      .max(365, 'Jumlah hari paling banyak 365'),
  ),
});

/**
 * The dashboard's widgets (design feature 35), every one behind `reports.view`: they carry margin and cost-derived
 * figures, and a store without that permission sees no cards.
 */
@Controller('reports/widgets')
@RequirePermission('reports.view')
export class DashboardWidgetsController {
  constructor(private readonly widgets: DashboardWidgetsService) {}

  @Get('overview')
  overview(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.widgets.overview(s.tenantId, parse(DashboardQuery, q).period);
  }

  @Get('hourly')
  hourly(@CurrentSession() s: PosSession) {
    return this.widgets.hourly(s.tenantId);
  }

  @Get('payment-mix')
  paymentMix(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.widgets.paymentMix(s.tenantId, parse(DashboardQuery, q).period);
  }

  @Get('top-products')
  topProducts(@CurrentSession() s: PosSession, @Query() q: unknown) {
    const { period, limit } = parse(TopQuery, q);
    return this.widgets.topProducts(s.tenantId, period, limit);
  }

  @Get('low-stock')
  lowStock(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.widgets.lowStock(s.tenantId, parse(LimitQuery, q).limit);
  }

  @Get('expiring')
  expiring(@CurrentSession() s: PosSession, @Query() q: unknown) {
    const { days, limit } = parse(ExpiringQuery, q);
    return this.widgets.expiring(s.tenantId, days, limit);
  }
}
