import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, pos } from './_base';
import { ACTOR_KINDS } from './sales';
import { tenants } from './tenants';

// UMK-1969 the staff audit log (design 32). Append-only: rows are written by `recordAudit`
// (src/audit/record.ts) inside the transaction of the action they describe, and never updated (a trigger in
// migration 0046 refuses UPDATE, DELETE and TRUNCATE; the only DELETE let through is the erasure purge's). Never holds a PIN, token, phone number
// or customer name: `details` goes through `scrubDetails`.

export const auditLog = pos
  .table(
    'audit_log',
    {
      id: id(),
      // Arrival order, the tie-break of rows written in one instant.
      seq: bigint('seq', { mode: 'number' })
        .generatedAlwaysAsIdentity()
        .notNull(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      occurredAt: timestamp('occurred_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      // The event code (src/audit/events.ts); a new code is added there (no CHECK on the column).
      event: text('event').notNull(),
      // UMKMall user id (owner) or pos.staff id (cashier), as in a session.
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      targetType: text('target_type'),
      targetId: uuid('target_id'),
      // What the row is about, as the screen names it: a receipt number, a product, a device or a staff name.
      targetLabel: text('target_label'),
      details: jsonb('details')
        .$type<Record<string, unknown>>()
        .notNull()
        .default(sql`'{}'::jsonb`),
    },
    (t) => [
      index('audit_log_tenant_time_idx').on(
        t.tenantId,
        t.occurredAt.desc(),
        t.seq.desc(),
      ),
      index('audit_log_tenant_actor_idx').on(t.tenantId, t.actorId),
    ],
  )
  .enableRLS();
