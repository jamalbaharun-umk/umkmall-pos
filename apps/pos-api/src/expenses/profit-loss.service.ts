import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ReportsService } from '../reports/reports.service';
import type { PeriodQuery } from './expenses.schemas';
import { ExpensesService, resolvePeriod } from './expenses.service';

/**
 * The simple profit and loss report (UMK-1984), in the design's words:
 *   revenue ("Hasil jualan") − cost ("Modal barang terjual") = grossProfit ("Untung kotor");
 *   grossProfit − expenses ("Pengeluaran") = netProfit ("Untung bersih").
 * revenue and cost are the reports' own figures (`ReportsService.salesTotals`): Σ sale totals, tax
 * included, kasbon sales included, voids as reversals on the day of the void, cost as stored on the
 * sale lines; cash rounding is its own line, in neither revenue nor profit. `expenses` are the live
 * expense rows dated in the span, WITHOUT supplier payments (their goods are in `cost` when sold).
 *
 * Unlike the other reports' `grossProfit` (revenue − tax − cost), tax stays inside revenue here, as the
 * owner-approved screen shows the sum; `tax` is returned so a screen can name it.
 */
@Injectable()
export class ProfitLossService {
  constructor(
    private readonly reports: ReportsService,
    private readonly expenses: ExpensesService,
  ) {}

  async report(tenantId: string, q: PeriodQuery) {
    const [tz, today] = await Promise.all([
      this.reports.timezone(tenantId),
      this.expenses.today(tenantId),
    ]);
    const range = resolvePeriod(q, today);
    // `period` mode compares like the dashboard: sales up to the same moment one period earlier.
    const cutoff = range.step
      ? sql`(((now() at time zone ${tz}) - (${range.step})::interval) at time zone ${tz})`
      : undefined;
    const side = async (from: string, to: string, until?: typeof cutoff) => {
      const [sales, spent] = await Promise.all([
        this.reports.salesTotals(tenantId, tz, { from, to }, until),
        this.expenses.totals(tenantId, from, to),
      ]);
      const grossProfit = sales.revenue - sales.cost;
      return {
        figures: {
          from,
          to,
          salesCount: sales.salesCount,
          voidCount: sales.voidCount,
          revenue: sales.revenue,
          tax: sales.tax,
          cost: sales.cost,
          grossProfit,
          expenses: spent.expenses,
          netProfit: grossProfit - spent.expenses,
          // Outside the sum: cash rounding kept by the drawer, and money paid to suppliers.
          rounding: sales.rounding,
          supplierPayments: spent.supplierPayments,
        },
        spent,
      };
    };
    const [current, previous] = await Promise.all([
      side(range.from, range.to),
      side(range.previous.from, range.previous.to, cutoff),
    ]);
    return {
      period: range.period,
      timezone: tz,
      from: range.from,
      to: range.to,
      current: current.figures,
      previous: previous.figures,
      netProfitChange: current.figures.netProfit - previous.figures.netProfit,
      // "Pengeluaran terbesar": the period's expense categories, largest first, supplier payments out.
      topExpenses: current.spent.byCategory
        .filter((c) => c.kind === 'expense')
        .map(({ category, label, total, count }) => ({
          category,
          label,
          total,
          count,
        })),
    };
  }
}
