import {
  Body,
  Controller,
  Get,
  Header,
  Module,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { validate as parse } from '../common/validation';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { toCsv } from './csv';
import { ReceivablesReportService } from './receivables-report.service';
import {
  DashboardQuery,
  DateRange,
  ReceivablesCsvQuery,
  ReceivablesQuery,
  SettingsInput,
} from './reports.schemas';
import { ShiftsModule } from '../shifts/shifts.module';
import { ReportsService } from './reports.service';

const CSV = 'text/csv; charset=utf-8';

@Controller('reports')
@RequirePermission('reports.view')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly receivables: ReceivablesReportService,
  ) {}

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

  @AgentRoute()
  @Get('dashboard')
  dashboard(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.reports.dashboard(s.tenantId, parse(DashboardQuery, q).period);
  }

  @AgentRoute()
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
        // UMK-1990: the line discount; 'Laba kotor' of a line is after it.
        'Diskon',
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
          x.discount,
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
          null,
          t.cost,
          null,
        ],
        [
          'Diskon',
          null,
          null,
          null,
          null,
          null,
          null,
          t.discount,
          null,
          null,
          null,
        ],
        [
          'Voucher',
          null,
          null,
          null,
          null,
          null,
          null,
          t.voucher,
          null,
          null,
          null,
        ],
        ['Pajak', null, null, null, null, null, null, t.tax, null, null, null],
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
          null,
        ],
        // UMK-1993: cash rounding, its own line outside revenue and gross profit.
        [
          'Pembulatan',
          null,
          null,
          null,
          null,
          null,
          null,
          t.rounding,
          null,
          null,
          null,
        ],
        // UMK-1964: revenue split into Lunas and Kasbon; kasbon instalments are money in, not revenue.
        ...(
          [
            ['Pendapatan lunas', t.settledSales],
            ['Pendapatan kasbon', t.creditSales],
            ['Piutang dibayar (uang masuk)', t.receivablePaid],
          ] as const
        ).map(([label, v]) => [
          label,
          null,
          null,
          null,
          null,
          null,
          null,
          v,
          null,
          null,
        ]),
      ],
    );
  }

  /** UMK-1964 "Laporan kasbon": summary and the customers who still owe, the most overdue first. */
  @Get('receivables')
  receivablesReport(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.receivables.list(s.tenantId, parse(ReceivablesQuery, q).filter);
  }

  /** The dashboard card "Piutang belum dibayar". */
  @Get('receivables/summary')
  receivablesSummary(@CurrentSession() s: PosSession) {
    return this.receivables.summary(s.tenantId);
  }

  @Get('receivables/csv')
  @Header('Content-Type', CSV)
  @Header('Content-Disposition', 'attachment; filename="laporan-kasbon.csv"')
  async receivablesCsv(@CurrentSession() s: PosSession, @Query() q: unknown) {
    const { filter, memberId } = parse(ReceivablesCsvQuery, q);
    return toCsv(
      [
        'Pelanggan',
        'Kasbon',
        'Dibayar',
        'Sisa',
        'Jatuh tempo',
        'Terlambat (hari)',
      ],
      await this.receivables.csvRows(s.tenantId, filter, memberId),
    );
  }

  @Get('receivables/customers/:memberId')
  receivablesCustomer(
    @CurrentSession() s: PosSession,
    @Param('memberId') memberId: string,
  ) {
    return this.receivables.customer(s.tenantId, parseId(memberId));
  }

  @AgentRoute()
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
        ['Total', null, t.qty, t.netSales, t.cost, null],
        ['Diskon pesanan', null, null, t.orderDiscount, null, null],
        ['Voucher', null, null, t.voucher, null, null],
        ['Pajak', null, null, t.tax, null, null],
        ['Pendapatan', null, null, t.revenue, null, null],
        ['Laba kotor', null, null, t.grossProfit, null, null],
        ['Pembulatan', null, null, t.rounding, null, null],
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
        'Pembulatan',
        'Kas awal',
        'Pembayaran piutang',
        'Kas masuk',
        'Kas keluar',
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
          x.rounding,
          x.openingCash,
          x.receivablePayments,
          x.cashIn,
          x.cashOut,
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
          t.rounding,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      ],
    );
  }

  @AgentRoute()
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

@Module({
  controllers: [ReportsController],
  imports: [ShiftsModule],
  providers: [ReportsService, ReceivablesReportService],
  exports: [ReportsService],
})
export class ReportsModule {}
