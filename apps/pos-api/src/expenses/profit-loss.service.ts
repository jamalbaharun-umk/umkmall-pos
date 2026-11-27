import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ReportsService } from '../reports/reports.service';
import type { PeriodQuery } from './expenses.schemas';
import { ExpensesService, resolvePeriod } from './expenses.service';

/**
 * The simple profit and loss report (UMK-1984), in the design's words:
 *   revenue ("Hasil jualan") − cost ("Modal barang terjual") = grossProfit ("Untung kotor");
 *   grossProfit − shrinkage ("Susut stok") − expenses ("Pengeluaran") = netProfit ("Untung bersih").
 * `shrinkage` (UMK-2072, owner ruling 2026-11-26) is the batch cost of the units approved stock opnames took out
 * less the cost of units they found in surplus in the same period, never below 0 (`ReportsService.shrinkage`,
 * owner ruling on PR 72): a loss of the store, not of its sales, so it is not in grossProfit.
 * The figures come from the reports' own (`ReportsService.salesTotals`): kasbon sales included, voids
 * as reversals on the day of the void, cost as stored on the sale lines. `expenses` are the live expense
 * rows dated in the span, WITHOUT supplier payments (their goods are in `cost` when sold).
 *
 * Owner ruling 2026-11-25: tax is money held for remittance, never earned, so it is in no profit
 * anywhere. `revenue` HERE is Σ sale totals − tax (the other reports' `revenue` is Σ sale totals, tax
 * inside, and their `grossProfit` takes it out): `grossProfit` is the same number as the dashboard's and
 * the sales reports'. `tax` and cash `rounding` are their own lines, outside the sum.
 */
/** What each figure is called on a screen and in the CSV: revenue and both profits say tax is not in them. */
export const PROFIT_LOSS_LABELS = {
  revenue: 'Hasil jualan (tanpa pajak)',
  cost: 'Modal barang terjual',
  grossProfit: 'Untung kotor (tanpa pajak)',
  shrinkage: 'Susut stok (selisih stok opname)',
  expenses: 'Pengeluaran',
  netProfit: 'Untung bersih (tanpa pajak)',
  tax: 'Pajak (titipan, di luar hasil jualan)',
  rounding: 'Pembulatan tunai (di luar hasil jualan)',
  supplierPayments: 'Bayar pemasok (bukan pengeluaran)',
} as const;

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
      const [sales, spent, shrinkage] = await Promise.all([
        this.reports.salesTotals(tenantId, tz, { from, to }, until),
        this.expenses.totals(tenantId, from, to),
        this.reports.shrinkage(tenantId, tz, { from, to }, until),
      ]);
      // `sales.grossProfit` is revenue − tax − cost, the one definition (reports.service `metrics`).
      const { grossProfit } = sales;
      return {
        figures: {
          from,
          to,
          salesCount: sales.salesCount,
          voidCount: sales.voidCount,
          revenue: sales.revenue - sales.tax,
          tax: sales.tax,
          cost: sales.cost,
          grossProfit,
          shrinkage,
          expenses: spent.expenses,
          netProfit: grossProfit - shrinkage - spent.expenses,
          // Outside the sum: tax held for remittance, cash rounding, and money paid to suppliers.
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
      // Tax is in neither revenue nor gross or net profit; `labels` says so.
      taxIncluded: false,
      labels: PROFIT_LOSS_LABELS,
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
