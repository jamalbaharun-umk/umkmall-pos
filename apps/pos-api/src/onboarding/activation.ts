import postgres from 'postgres';
import { FINAL_SALE_STATUSES } from '../db/schema/sales';

/** A store's first days are this long: the window of "sales days in the first week" and the cost snapshot. */
export const ACTIVATION_DAYS = 7;
const DEFAULT_TIMEZONE = 'Asia/Jakarta';

/**
 * One store's activation, without personal data (UMK-2131): no tenant, user, store name or product name, only
 * durations, counts and a percent. A figure whose window has not ended yet is null (a store 3 days old has no
 * "first week" yet).
 */
export type StoreActivation = {
  /** Whole days since the store was created. */
  ageDays: number;
  /** Whole minutes from the store's creation to its first completed sale; null before one. */
  minutesToFirstSale: number | null;
  /** Store days (its own timezone) with at least one completed sale in its first 7 days; null before day 7. */
  salesDaysFirstWeek: number | null;
  /** Of the products live on day 7, the whole percent that had a cost (`cost_set_at`) by then; null before day 7 or with none. */
  costSharePercentDay7: number | null;
};

export type ActivationReport = {
  stores: StoreActivation[];
  /** Medians over the stores that have the figure (null when none has). */
  medianMinutesToFirstSale: number | null;
  medianSalesDaysFirstWeek: number | null;
  medianCostSharePercentDay7: number | null;
  /** Stores whose first sale came within 5 minutes of their creation (the onboarding goal, UMK-2128). */
  firstSaleWithin5Minutes: number;
};

const median = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.floor((v[mid - 1] + v[mid]) / 2);
};

/**
 * Every store's activation, read across tenants by the `pos_app` role. Only for the product team's own
 * measurement: no route answers it (run it with `npm run metrics:activation -w pos-api`). Sales are the receipts
 * (`FINAL_SALE_STATUSES`: a voided sale was still a sale made) dated by `paid_at`, as in every report.
 */
export async function activationReport(
  sql: postgres.Sql,
): Promise<ActivationReport> {
  const FINAL = [...FINAL_SALE_STATUSES] as string[];
  const rows = await sql<
    {
      age_days: number;
      minutes_to_first_sale: number | null;
      sales_days: number | null;
      cost_share: number | null;
    }[]
  >`
    with t as (
      select t.id, t.created_at,
             t.created_at + make_interval(days => ${ACTIVATION_DAYS}) as day7,
             coalesce(rs.timezone, ${DEFAULT_TIMEZONE}) as tz
        from pos.tenants t
        left join pos.report_settings rs on rs.tenant_id = t.id
    )
    select floor(extract(epoch from now() - t.created_at) / 86400)::int as age_days,
           (select floor(extract(epoch from min(s.paid_at) - t.created_at) / 60)::int
              from pos.sales s
             where s.tenant_id = t.id and s.status = any(${FINAL}) and s.paid_at is not null)
             as minutes_to_first_sale,
           case when now() >= t.day7 then
             (select count(distinct (s.paid_at at time zone t.tz)::date)::int
                from pos.sales s
               where s.tenant_id = t.id and s.status = any(${FINAL})
                 and s.paid_at >= t.created_at and s.paid_at < t.day7)
           end as sales_days,
           case when now() >= t.day7 then
             (select floor(100.0 * count(*) filter (where p.cost_set_at <= t.day7) / nullif(count(*), 0))::int
                from pos.products p
               where p.tenant_id = t.id and p.created_at <= t.day7
                 and (p.deleted_at is null or p.deleted_at > t.day7))
           end as cost_share
      from t
     order by t.created_at`;
  const stores: StoreActivation[] = rows.map((r) => ({
    ageDays: r.age_days,
    minutesToFirstSale: r.minutes_to_first_sale,
    salesDaysFirstWeek: r.sales_days,
    costSharePercentDay7: r.cost_share,
  }));
  return {
    stores,
    medianMinutesToFirstSale: median(stores.map((s) => s.minutesToFirstSale)),
    medianSalesDaysFirstWeek: median(stores.map((s) => s.salesDaysFirstWeek)),
    medianCostSharePercentDay7: median(
      stores.map((s) => s.costSharePercentDay7),
    ),
    firstSaleWithin5Minutes: stores.filter(
      (s) => s.minutesToFirstSale !== null && s.minutesToFirstSale < 5,
    ).length,
  };
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const sql = postgres(url, { max: 1 });
  activationReport(sql)
    .then(
      (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
      (error: unknown) => {
        process.stderr.write(
          `activation report failed: ${(error as Error).name}\n`,
        );
        process.exitCode = 1;
      },
    )
    .finally(() => void sql.end({ timeout: 5 }));
}
