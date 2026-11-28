import type { Db } from '../db/db.module';
import { isSoloOwner } from '../shifts/cash-ledger';
import type { Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';

/**
 * UMK-2123 (owner decision 2026-11-28): in solo-owner mode (`isSoloOwner`: no active, non-deleted staff member) the
 * owner's own reduction above 30% (a line discount, a manual price, the order discount) needs no second person's PIN,
 * because nobody else exists to approve it. The owner's own session only: never a cashier, and never the agent, which
 * sends no price or discount (UMK-2069) and so gets no discount path here. Read by the server on every call (inside
 * the sale's transaction when given one), never taken from the client.
 */
export async function soloOwnerSelfApproves(
  db: Db | Tx,
  s: PosSession,
): Promise<boolean> {
  return s.kind === 'owner' && (await isSoloOwner(db, s));
}

/** What the audit's `details.approval` says for a reduction the solo owner approved without a PIN. */
export const SOLO_OWNER_APPROVAL = 'solo_owner';
