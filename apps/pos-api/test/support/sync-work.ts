import type postgres from 'postgres';

/**
 * The rows of `tenants` that the payment job (`PaymentSync.tick`) would still work on. The job sweeps EVERY
 * store of the database, and every payment suite starts payment-api on a freshly made `payment` schema: a row
 * that one spec file leaves behind is, in the next file, a row whose payment no longer exists, and that
 * file's ticks count it as `failed`. Which file runs first depends on jest's timing cache, so it fails on one
 * machine and passes on another. Every suite that turns payment-api on ends with this being empty.
 */
export async function syncWorkLeft(sql: postgres.Sql, tenants: string[]) {
  if (!tenants.length) return [];
  const rows = await sql<{ kind: string; id: string }[]>`
    select 'sale awaiting payment' as kind, id from pos.sales
     where status = 'awaiting_payment' and tenant_id in ${sql(tenants)}
    union all
    select 'kasbon payment not recorded', id from pos.receivable_payments
     where seq is not null and payment_id is null and tenant_id in ${sql(tenants)}
    union all
    select 'kasbon correction not sent', id from pos.receivable_payments
     where payment_sync_pending and tenant_id in ${sql(tenants)}
    union all
    select 'void not sent', id from pos.sale_voids
     where payment_sync_pending and tenant_id in ${sql(tenants)}
    union all
    select 'refund pending', id from pos.sale_voids
     where refund_status = 'pending' and not payment_sync_pending and tenant_id in ${sql(tenants)}`;
  return rows.map((r) => `${r.kind}: ${r.id}`);
}
