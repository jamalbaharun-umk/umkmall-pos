import { sql } from 'drizzle-orm';

/**
 * What a screen calls a shift (design fitur 20 and 21: "Shift Rina", "shift #13"), derived on read; no
 * column holds either. Both are for a query whose FROM or JOIN has `pos.shifts` unaliased, and are
 * written as plain SQL so they read the same row whether or not drizzle qualifies its own columns.
 * Not for a RETURNING clause: a new row does not count itself there.
 */

/** The store's n-th shift by opening time, from 1. Shifts are never deleted, so the number is stable. */
export const shiftNumber = sql<number>`(
  select count(*)::int from pos.shifts n
   where n.tenant_id = shifts.tenant_id
     and (n.opened_at, n.id) <= (shifts.opened_at, shifts.id))`.mapWith(Number);

/** Whose drawer it is: "Pemilik" for an owner, the staff name for a cashier. No other staff data. */
export const shiftActorName = sql<string>`case when shifts.actor_kind = 'owner' then 'Pemilik'
  else coalesce((select st.name from pos.staff st
                  where st.tenant_id = shifts.tenant_id and st.id = shifts.actor_id), 'Staf') end`;
