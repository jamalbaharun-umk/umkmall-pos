import { sql } from 'drizzle-orm';
import {
  check,
  index,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos } from './_base';
import { tenants } from './tenants';

/**
 * Why a handover ended: the owner came back with the PIN, it ran out (12 hours, found at the next start or at the
 * owner's end), or the owner ended it from a fresh WhatsApp sign-in (the helper's device could not be reached).
 */
export const HELPER_END_REASONS = ['owner', 'expired', 'signin'] as const;

// UMK-2124 "Serahkan ke pembantu" (design 42): the owner parked their session behind the owner PIN and handed the
// till to a helper on the same device. One live row per owner. A helper token names its row (`hsid`) and is
// refused once the row ended or expired. `parked_sid_hash` is the sha256 of the owner's UMKMall native session id
// on that device (never the id itself): pos-api refuses to refresh it until the owner ends the handover with the
// PIN, so the parked session cannot be woken without it, and stays refused after the handover expired.
export const helperSessions = pos
  .table(
    'helper_sessions',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      // The owner (UMKMall user id) who handed the till over; the helper sells as this actor, in their shift.
      ownerId: uuid('owner_id').notNull(),
      // Shown on the till ("Mode pembantu · Dina"); optional, never written to the audit log.
      name: text('name'),
      parkedSidHash: text('parked_sid_hash'),
      createdAt: createdAt(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      endedAt: timestamp('ended_at', { withTimezone: true }),
      endedReason: text('ended_reason', { enum: HELPER_END_REASONS }),
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      // One handover not yet ended per owner (an expired one is ended at the next start).
      uniqueIndex('helper_sessions_one_live_uq')
        .on(t.tenantId, t.ownerId)
        .where(sql`${t.endedAt} is null`),
      index('helper_sessions_parked_sid_idx').on(t.parkedSidHash),
      check(
        'helper_sessions_end_ck',
        sql`(${t.endedAt} is null) = (${t.endedReason} is null) and (${t.endedReason} is null or ${t.endedReason} in ('owner', 'expired', 'signin'))`,
      ),
      check(
        'helper_sessions_name_ck',
        sql`${t.name} is null or char_length(${t.name}) between 1 and 40`,
      ),
    ],
  )
  .enableRLS();
