import { sql } from 'drizzle-orm';
import { check, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, pos, updatedAt } from './_base';
import { tenants } from './tenants';

// UMK-2134: which step-by-step guides (coach marks) each person has finished or skipped, so a new device does not
// replay them. One row per (store, person, guide). The person is the session's actor: the owner's user id or a
// staff id. Nothing here is money or access; rows go with the store's purge.
export const guideProgress = pos
  .table(
    'guide_progress',
    {
      id: id(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'restrict' }),
      actorKind: text('actor_kind', { enum: ['owner', 'cashier'] }).notNull(),
      actorId: uuid('actor_id').notNull(),
      guideKey: text('guide_key').notNull(),
      status: text('status', { enum: ['done', 'skipped'] }).notNull(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('guide_progress_actor_guide_uq').on(
        t.tenantId,
        t.actorKind,
        t.actorId,
        t.guideKey,
      ),
      check(
        'guide_progress_status_ck',
        sql`${t.status} in ('done', 'skipped')`,
      ),
      check(
        'guide_progress_key_ck',
        sql`${t.guideKey} ~ '^[a-z0-9_.-]{1,60}$'`,
      ),
    ],
  )
  .enableRLS();
