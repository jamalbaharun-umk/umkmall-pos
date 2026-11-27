import {
  Controller,
  Get,
  Module,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { validate as parse } from '../../common/validation';
import { ExpensesModule } from '../../expenses/expenses.controller';
import { PeriodQuery } from '../../expenses/expenses.schemas';
import { RequirePermission } from '../../staff/require-permission';
import { CurrentSession } from '../../tenancy/decorators';
import type { PosSession } from '../../tenancy/session';
import { ReportsModule } from '../reports.controller';
import { DateRange, ReceivablesQuery } from '../reports.schemas';
import {
  ReportPdfService,
  type PdfFile,
  type TrendParts,
} from './report-pdf.service';
import { SalesExpensesService } from './trend.service';
import { ReportVisualsService } from './visuals.service';
import { TrendQuery } from './scales';
import type { ReportKind } from './report-defs';

const PDF = 'application/pdf';

const send = (res: Response, f: PdfFile) => {
  res.set({
    'Content-Type': PDF,
    'Content-Disposition': `attachment; filename="${f.filename}"`,
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(f.bytes);
};

/** `include=summary,chart,table` (the dialog's ticks); absent means all three. */
const Include = z.object({
  include: z.preprocess(
    (v) =>
      v === undefined
        ? 'summary,chart,table'
        : typeof v === 'string'
          ? v
          : '\u0000',
    z
      .string()
      .refine(
        (v) =>
          v
            .split(',')
            .every((p) => ['summary', 'chart', 'table'].includes(p)) &&
          v.length > 0,
        'Isi PDF tidak dikenal',
      )
      .refine((v) => v !== '', 'Pilih paling sedikit satu isi PDF'),
  ),
});
const parts = (include: string): TrendParts => {
  const set = new Set(include.split(','));
  return {
    summary: set.has('summary'),
    chart: set.has('chart'),
    table: set.has('table'),
  };
};

/**
 * The report visuals (design feature 38), "Penjualan dan pengeluaran" (feature 37) and the report PDFs. Same
 * permission as the reports themselves (`reports.view`), tenant from the session only. Not agent routes.
 */
@Controller('reports')
@RequirePermission('reports.view')
export class ReportExportController {
  constructor(
    private readonly trend: SalesExpensesService,
    private readonly visuals: ReportVisualsService,
    private readonly pdf: ReportPdfService,
  ) {}

  @Get('sales-expenses')
  salesExpenses(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return this.trend.report(s.tenantId, parse(TrendQuery, q));
  }

  @Get('sales-expenses/pdf')
  async salesExpensesPdf(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const query = parse(TrendQuery, q);
    const { include } = parse(Include, q);
    return send(res, await this.pdf.trendPdf(s, query, parts(include)));
  }

  @Get('visuals/sales')
  async salesVisuals(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return {
      visuals: await this.visuals.sales(s.tenantId, parse(DateRange, q)),
    };
  }

  @Get('visuals/products')
  async productsVisuals(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return {
      visuals: await this.visuals.products(s.tenantId, parse(DateRange, q)),
    };
  }

  @Get('visuals/shifts')
  async shiftsVisuals(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return {
      visuals: await this.visuals.shifts(s.tenantId, parse(DateRange, q)),
    };
  }

  @Get('visuals/purchasing')
  async purchasingVisuals(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
  ) {
    return {
      visuals: await this.visuals.purchasing(s.tenantId, parse(DateRange, q)),
    };
  }

  @Get('visuals/profit-loss')
  async profitVisuals(@CurrentSession() s: PosSession, @Query() q: unknown) {
    return {
      visuals: await this.visuals.profit(s.tenantId, parse(PeriodQuery, q)),
    };
  }

  @Get('visuals/receivables')
  async receivablesVisuals(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
  ) {
    return {
      visuals: await this.visuals.receivablesVisuals(
        s.tenantId,
        parse(ReceivablesQuery, q).filter,
      ),
    };
  }

  private dated(kind: ReportKind) {
    return async (s: PosSession, q: unknown, res: Response) =>
      send(res, await this.pdf.dated(kind, s, parse(DateRange, q)));
  }

  @Get('pdf/sales')
  salesPdf(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.dated('sales')(s, q, res);
  }

  @Get('pdf/products')
  productsPdf(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.dated('products')(s, q, res);
  }

  @Get('pdf/shifts')
  shiftsPdf(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.dated('shifts')(s, q, res);
  }

  @Get('pdf/purchasing')
  purchasingPdf(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.dated('purchasing')(s, q, res);
  }

  @Get('pdf/profit-loss')
  async profitPdf(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.pdf.profit(s, parse(PeriodQuery, q)));
  }

  @Get('pdf/receivables')
  async receivablesPdf(
    @CurrentSession() s: PosSession,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(
      res,
      await this.pdf.kasbon(s, parse(ReceivablesQuery, q).filter),
    );
  }
}

@Module({
  imports: [ReportsModule, ExpensesModule],
  controllers: [ReportExportController],
  providers: [SalesExpensesService, ReportVisualsService, ReportPdfService],
})
export class ReportExportModule {}
