import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { reportSettings } from '../db/schema';

/**
 * Today's calendar date in the store's timezone (`pos.report_settings.timezone`, default Asia/Jakarta), as a
 * Postgres `date`. The one rule for "the store's day": receivable due dates and voucher validity use it, so a
 * sale at 00:22 WIB belongs to that WIB day, never to the UTC day before.
 */
export const storeToday = (tenantId: string): SQL<string> =>
  sql<string>`(now() at time zone coalesce((select ${reportSettings.timezone} from ${reportSettings} where ${reportSettings.tenantId} = ${tenantId}), 'Asia/Jakarta'))::date`;

/** The store's calendar date of a timestamp (same timezone rule as `storeToday`), as a Postgres `date`. */
export const storeDayOf = (tenantId: string, at: SQL | AnyColumn): SQL<string> =>
  sql<string>`(${at} at time zone coalesce((select ${reportSettings.timezone} from ${reportSettings} where ${reportSettings.tenantId} = ${tenantId}), 'Asia/Jakarta'))::date`;
