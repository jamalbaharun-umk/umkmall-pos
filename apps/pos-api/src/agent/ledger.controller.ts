import { Controller, Get, Query } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { validate } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  EXPENSE_CATEGORY_LABELS,
  FINAL_SALE_STATUSES,
  MANUAL_CASH_REASON_LABELS,
} from '../db/schema';
import { DateRange } from '../reports/reports.schemas';
import { DEFAULT_TIMEZONE } from '../reports/reports.service';
import { RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';

/** At most this many entries per answer; a longer period answers `truncated` and the caller asks shorter periods. */
export const LEDGER_ROW_CAP = 2000;

type Row = Record<string, unknown>;

/**
 * The POS's money movements as ledger entries, for UMKMall's Catatan Keuangan (cash basis): what came in and went out,
 * on which local day, by which method, with a stable `id` per entry so a pull can be repeated without duplicates.
 * Data only: UMKMall maps the POS categories to its own. A kasbon sale brings in only its payments (down payment and
 * instalments, `kasbon_payment`); a void gives back what was paid (`refund`); expenses and supplier payments are the
 * live (not voided) ones; drawer cash put in or taken out by hand is `cash_in` / `cash_out` with its reason.
 */
@Controller('agent/ledger')
export class LedgerController {
  constructor(@InjectDb() private readonly db: Db) {}

  @AgentRoute()
  @Get()
  @RequirePermission('reports.view')
  async ledger(@CurrentSession() s: PosSession, @Query() query: unknown) {
    const range = validate(DateRange, query);
    const [tzRow] = (await this.db.execute(
      sql`select timezone from pos.report_settings where tenant_id = ${s.tenantId}`,
    )) as Row[];
    const tz = (tzRow?.timezone as string | undefined) ?? DEFAULT_TIMEZONE;
    const start = sql`((${range.from}::date)::timestamp at time zone ${tz})`;
    const end = sql`(((${range.to}::date) + 1)::timestamp at time zone ${tz})`;
    const day = (col: unknown) =>
      sql`to_char(${col} at time zone ${tz}, 'YYYY-MM-DD')`;
    const statuses = sql.join(
      FINAL_SALE_STATUSES.map((st) => sql`${st}`),
      sql`, `,
    );
    const rows = (await this.db.execute(sql`
      select * from (
        select 'sale:' || s.id as id, s.paid_at as at, ${day(sql`s.paid_at`)} as date, 'in' as direction,
               'sale' as kind, 'penjualan' as category, 'Penjualan' as label, s.paid - s.change as amount,
               pm.name as method, s.number as receipt_number, null::text as note
          from pos.sales s
          join pos.payment_methods pm on pm.tenant_id = s.tenant_id and pm.id = s.payment_method_id
         where s.tenant_id = ${s.tenantId} and s.status in (${statuses}) and not pm.is_credit
           and s.paid_at >= ${start} and s.paid_at < ${end} and s.paid - s.change > 0
        union all
        select 'kasbon_payment:' || rp.id, rp.created_at, ${day(sql`rp.created_at`)}, 'in',
               'kasbon_payment', 'pembayaran_kasbon', 'Pembayaran kasbon', rp.amount, pm.name, null, null
          from pos.receivable_payments rp
          join pos.payment_methods pm on pm.tenant_id = rp.tenant_id and pm.id = rp.payment_method_id
         where rp.tenant_id = ${s.tenantId} and rp.created_at >= ${start} and rp.created_at < ${end}
        union all
        select 'refund:' || r.id, r.created_at, ${day(sql`r.created_at`)}, 'out',
               'refund', 'pengembalian', 'Uang dikembalikan (pembatalan)', r.amount, pm.name, s.number, null
          from pos.sale_void_returns r
          join pos.sale_voids v on v.tenant_id = r.tenant_id and v.id = r.void_id
          join pos.sales s on s.tenant_id = v.tenant_id and s.id = v.sale_id
          join pos.payment_methods pm on pm.tenant_id = r.tenant_id and pm.id = r.payment_method_id
         where r.tenant_id = ${s.tenantId} and r.created_at >= ${start} and r.created_at < ${end}
        union all
        select 'expense:' || e.id, e.created_at, e.expense_date::text, 'out',
               e.kind, e.category, e.category, e.amount, null, null, e.note
          from pos.expenses e
         where e.tenant_id = ${s.tenantId} and e.voided_at is null
           and e.expense_date >= ${range.from}::date and e.expense_date <= ${range.to}::date
        union all
        select 'cash:' || m.id, m.created_at, ${day(sql`m.created_at`)}, m.direction,
               case when m.direction = 'in' then 'cash_in' else 'cash_out' end, m.reason, m.reason, m.amount,
               'Tunai', null, m.note
          from pos.manual_cash_entries m
         where m.tenant_id = ${s.tenantId} and m.created_at >= ${start} and m.created_at < ${end}
      ) x
      order by date, at, id
      limit ${LEDGER_ROW_CAP + 1}`)) as Row[];
    const n = (v: unknown) => Number(v ?? 0);
    const entries = rows.slice(0, LEDGER_ROW_CAP).map((r) => ({
      id: r.id as string,
      date: r.date as string,
      direction: r.direction as 'in' | 'out',
      kind: r.kind as string,
      category: r.category as string,
      label:
        (r.kind === 'cash_in' || r.kind === 'cash_out'
          ? MANUAL_CASH_REASON_LABELS[
              r.category as keyof typeof MANUAL_CASH_REASON_LABELS
            ]
          : r.kind === 'expense' || r.kind === 'supplier_payment'
            ? EXPENSE_CATEGORY_LABELS[
                r.category as keyof typeof EXPENSE_CATEGORY_LABELS
              ]
            : undefined) ?? (r.label as string),
      amount: n(r.amount),
      method: (r.method as string | null) ?? null,
      receiptNumber: r.receipt_number === null ? null : n(r.receipt_number),
      note: (r.note as string | null) ?? null,
    }));
    const sum = (d: 'in' | 'out') =>
      entries
        .filter((e) => e.direction === d)
        .reduce((a, e) => a + e.amount, 0);
    return {
      ...range,
      timezone: tz,
      truncated: rows.length > LEDGER_ROW_CAP,
      totals: { in: sum('in'), out: sum('out'), net: sum('in') - sum('out') },
      entries,
    };
  }
}
