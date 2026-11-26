import { sql } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import type { Tx } from '../stock/stock.service';

/**
 * What a screen calls a shift (design fitur 20 and 21: "Shift Rina", "shift #13"), derived on read; no
 * column holds either.
 */

/**
 * The number of each shift in `ids`: the store's n-th shift by opening time, from 1. Shifts are never
 * deleted, so a number is stable. One query for the whole page (a window over the store's shifts, on
 * the `(tenant_id, opened_at)` index), never one count per row. Ids of another store are absent.
 */
export async function shiftNumbers(
  db: Db | Tx,
  tenantId: string,
  ids: (string | null)[],
): Promise<Map<string, number>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db.execute<{ id: string; n: number }>(sql`
    select t.id, t.n from (
      select sh.id, (row_number() over (order by sh.opened_at, sh.id))::int as n
        from pos.shifts sh where sh.tenant_id = ${tenantId}) t
     where t.id in (${sql.join(
       wanted.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})`);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

/**
 * Whose drawer it is: "Pemilik" for an owner, the staff name for a cashier. No other staff data. For a
 * query whose FROM or JOIN has `pos.shifts` unaliased; plain SQL, so it reads the same row whether or
 * not drizzle qualifies its own columns.
 */
export const shiftActorName = sql<string>`case when shifts.actor_kind in ('owner', 'agent') then 'Pemilik'
  else coalesce((select st.name from pos.staff st
                  where st.tenant_id = shifts.tenant_id and st.id = shifts.actor_id), 'Staf') end`;
