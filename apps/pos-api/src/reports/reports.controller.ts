import {
  Body,
  Controller,
  Get,
  Header,
  Module,
  Put,
  Query,
} from '@nestjs/common';
import { validate as parse } from '../common/validation';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { toCsv } from './csv';
import { DashboardQuery, DateRange, SettingsInput } from './reports.schemas';
import { ReportsService } from './reports.service';

const CSV = 'text/csv; charset=utf-8';

@Controller('reports')
@RequirePermission('reports.view')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('settings')
  settings(@CurrentSession() s: PosSession) {
    return this.reports.settings(s.tenantId);
  }

  @Put('settings')
  @RequirePermission('catalog.manage')
  updateSettings(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.reports.updateSettings(
      s.tenantId,
      parse(SettingsInput, body).timezone,
    );
  }

  @Get('dashboard')
  dashboard(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.reports.dashboard(s.tenantId, parse(DashboardQuery, q).period);
  }

  @Get('sales')
  sales(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.reports.sales(s.tenantId, parse(DateRange, q));
  }

  @Get('sales/csv')
  @Header('Content-Type', CSV)
  @Header('Content-Disposition', 'attachment; filename="laporan-penjualan.csv"')
  async salesCsv(@CurrentSession() s: PosSession, @Query() q: unknown) {
    const r = await this.reports.sales(s.tenantId, parse(DateRange, q));
    const t = r.totals;
    return toCsv(
      [
        'No. struk',
        'Waktu',
        'Kasir',
        'SKU',
        'Produk',
        'Qty',
        'Harga',
        'Jumlah',
        'Modal',
        'Laba kotor',
      ],
      [
        ...r.rows.map((x) => [
          x.number,
          x.time,
          x.cashier,
          x.sku,
          x.name,
          x.qty,
          x.unitPrice,
          x.lineTotal,
          x.cost,
          x.grossProfit,
        ]),
        [
          'Total',
          null,
          null,
          null,
          null,
          t.qty,
          null,
          t.grossSales,
          t.cost,
          null,
        ],
        ['Diskon', null, null, null, null, null, null, t.discount, null, null],
        ['Pajak', null, null, null, null, null, null, t.tax, null, null],
        [
          'Pendapatan',
          null,
          null,
          null,
          null,
          null,
          null,
          t.revenue,
          null,
          null,
        ],
        [
          'Laba kotor',
          null,
          null,
          null,
          null,
          null,
          null,
          t.grossProfit,
          null,
          null,
        ],
      ],
    );
  }

  @Get('products')
  products(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.reports.products(s.tenantId, parse(DateRange, q));
  }

  @Get('products/csv')
  @Header('Content-Type', CSV)
  @Header('Content-Disposition', 'attachment; filename="laporan-produk.csv"')
  async productsCsv(@CurrentSession() s: PosSession, @Query() q: unknown) {
    const r = await this.reports.products(s.tenantId, parse(DateRange, q));
    const t = r.totals;
    return toCsv(
      ['SKU', 'Produk', 'Qty', 'Penjualan', 'Modal', 'Laba kotor'],
      [
        ...r.rows.map((x) => [
          x.sku,
          x.name,
          x.qty,
          x.sales,
          x.cost,
          x.grossProfit,
        ]),
        ['Total', null, t.qty, t.grossSales, t.cost, null],
        ['Diskon', null, null, t.discount, null, null],
        ['Pajak', null, null, t.tax, null, null],
        ['Pendapatan', null, null, t.revenue, null, null],
        ['Laba kotor', null, null, t.grossProfit, null, null],
      ],
    );
  }

  @Get('shifts')
  shifts(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.reports.shifts(s.tenantId, parse(DateRange, q));
  }

  @Get('shifts/csv')
  @Header('Content-Type', CSV)
  @Header('Content-Disposition', 'attachment; filename="laporan-shift.csv"')
  async shiftsCsv(@CurrentSession() s: PosSession, @Query() q: unknown) {
    const r = await this.reports.shifts(s.tenantId, parse(DateRange, q));
    const t = r.totals;
    return toCsv(
      [
        'Kasir',
        'Buka',
        'Tutup',
        'Transaksi',
        'Pendapatan',
        'Modal',
        'Laba kotor',
        'Kas awal',
        'Kas seharusnya',
        'Kas dihitung',
        'Selisih',
      ],
      [
        ...r.rows.map((x) => [
          x.cashier,
          x.openedAt,
          x.closedAt,
          x.salesCount,
          x.revenue,
          x.cost,
          x.grossProfit,
          x.openingCash,
          x.expectedCash,
          x.countedCash,
          x.difference,
        ]),
        [
          'Total',
          null,
          null,
          t.salesCount,
          t.revenue,
          t.cost,
          t.grossProfit,
          null,
          null,
          null,
          null,
        ],
      ],
    );
  }

  @Get('purchasing')
  purchasing(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.reports.purchasing(s.tenantId, parse(DateRange, q));
  }

  @Get('purchasing/csv')
  @Header('Content-Type', CSV)
  @Header('Content-Disposition', 'attachment; filename="laporan-pembelian.csv"')
  async purchasingCsv(@CurrentSession() s: PosSession, @Query() q: unknown) {
    const r = await this.reports.purchasing(s.tenantId, parse(DateRange, q));
    const t = r.totals;
    return toCsv(
      ['Tanggal', 'Pemasok', 'SKU', 'Produk', 'Qty', 'Harga beli', 'Jumlah'],
      [
        ...r.rows.map((x) => [
          x.date,
          x.supplier,
          x.sku,
          x.name,
          x.qty,
          x.unitCost,
          x.lineTotal,
        ]),
        ['Total', null, null, null, t.qty, null, t.total],
      ],
    );
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
