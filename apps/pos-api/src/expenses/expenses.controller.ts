import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { ReportsModule } from '../reports/reports.controller';
import { toCsv } from '../reports/csv';
import { IdempotencyKey } from '../sales/sales.schemas';
import { ShiftsModule } from '../shifts/shifts.module';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  ExpenseInput,
  ExpenseListQuery,
  ExpenseUpdate,
  PeriodQuery,
  VoidInput,
} from './expenses.schemas';
import { ExpensesService } from './expenses.service';
import { ProfitLossService } from './profit-loss.service';

const CSV = 'text/csv; charset=utf-8';
const SOURCE_LABELS = { drawer: 'Laci kasir', outside: 'Di luar laci' };

// `expenses.manage` opens the log; whose rows it shows is `ownScope` in the service: the actor's own,
// or everyone's with `reports.view` (owner ruling 2026-11-25).
@Controller('expenses')
@RequirePermission('expenses.manage')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  create(
    @CurrentSession() s: PosSession,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { idempotencyKey } = validate(
      z.object({ idempotencyKey: IdempotencyKey }),
      { idempotencyKey: key },
    );
    return this.expenses.create(
      s,
      idempotencyKey,
      validate(ExpenseInput, body),
    );
  }

  @Get()
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.expenses.list(s, validate(ExpenseListQuery, query));
  }

  @Get('categories')
  categories() {
    return { data: this.expenses.categories() };
  }

  @Get('csv')
  @Header('Content-Type', CSV)
  @Header('Content-Disposition', 'attachment; filename="pengeluaran.csv"')
  async csv(@CurrentSession() s: PosSession, @Query() query: unknown) {
    const r = await this.expenses.export(s, validate(PeriodQuery, query));
    return toCsv(
      [
        'Tanggal',
        'Kategori',
        'Sumber uang',
        'Catatan',
        'Dicatat oleh',
        'Jumlah',
      ],
      [
        ...r.rows.map((x) => [
          x.date,
          x.categoryLabel,
          SOURCE_LABELS[x.source],
          x.note,
          x.actorName,
          x.amount,
        ]),
        ['Total pengeluaran', null, null, null, null, r.summary.expenses],
        [
          'Total bayar pemasok (bukan pengeluaran)',
          null,
          null,
          null,
          null,
          r.summary.supplierPayments,
        ],
      ],
    );
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.expenses.get(s, parseId(id));
  }

  @Patch(':id')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.expenses.update(s, parseId(id), validate(ExpenseUpdate, body));
  }

  @Post(':id/void')
  @HttpCode(200)
  void(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.expenses.voidExpense(
      s,
      parseId(id),
      validate(VoidInput, body ?? {}).reason,
    );
  }
}

// Profit is a margin figure like the dashboard's: `reports.view`, never `expenses.manage` alone (someone
// who only records expenses does not see what the store earns).
@Controller('reports/profit-loss')
@RequirePermission('reports.view')
export class ProfitLossController {
  constructor(private readonly profitLoss: ProfitLossService) {}

  @AgentRoute()
  @Get()
  report(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.profitLoss.report(s.tenantId, validate(PeriodQuery, query));
  }

  @Get('csv')
  @Header('Content-Type', CSV)
  @Header('Content-Disposition', 'attachment; filename="untung-rugi.csv"')
  async csv(@CurrentSession() s: PosSession, @Query() query: unknown) {
    const r = await this.profitLoss.report(
      s.tenantId,
      validate(PeriodQuery, query),
    );
    const c = r.current;
    const p = r.previous;
    const l = r.labels;
    return toCsv(
      ['Keterangan', `${c.from} s.d. ${c.to}`, `${p.from} s.d. ${p.to}`],
      [
        [l.revenue, c.revenue, p.revenue],
        [l.cost, c.cost, p.cost],
        [l.grossProfit, c.grossProfit, p.grossProfit],
        [l.expenses, c.expenses, p.expenses],
        [l.netProfit, c.netProfit, p.netProfit],
        [l.tax, c.tax, p.tax],
        [l.rounding, c.rounding, p.rounding],
        [l.supplierPayments, c.supplierPayments, p.supplierPayments],
        ...r.topExpenses.map((e) => [`Pengeluaran: ${e.label}`, e.total, null]),
      ],
    );
  }
}

@Module({
  imports: [ShiftsModule, ReportsModule],
  controllers: [ExpensesController, ProfitLossController],
  providers: [ExpensesService, ProfitLossService],
})
export class ExpensesModule {}
