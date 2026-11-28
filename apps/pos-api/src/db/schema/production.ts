import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah } from './_base';
import { products } from './catalog';
import { recipes } from './recipes';
import { ACTOR_KINDS } from './sales';
import { stockBatches } from './stock';
import { tenants } from './tenants';

// UMK-2132 recipes R2: production runs. A run is written once, in the transaction that drew its ingredients and
// received its finished batch (src/production/production.service.ts, the only writer); never updated or deleted
// but by the purge. Same-tenant references are checked by that service before every write.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

export const productionRuns = pos
  .table(
    'production_runs',
    {
      id: id(),
      tenantId: tenantId(),
      // The recipe as it was used; null once the recipe is deleted (the run keeps its own figures).
      recipeId: uuid('recipe_id').references(() => recipes.id, {
        onDelete: 'set null',
      }),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      batches: integer('batches').notNull(),
      // Recipe yield × batches, and what really came out (the finished batch's quantity).
      plannedYield: integer('planned_yield').notNull(),
      actualYield: integer('actual_yield').notNull(),
      yieldUnit: text('yield_unit').notNull(),
      // What the drawn ingredient units cost (each at its own batch's unit cost), and that ÷ actual yield, rounded up.
      ingredientCost: rupiah('ingredient_cost').notNull(),
      costPerPortion: rupiah('cost_per_portion').notNull(),
      // The finished product's new stock batch (source `production`, source_id = this run).
      batchId: uuid('batch_id')
        .notNull()
        .references(() => stockBatches.id, { onDelete: 'restrict' }),
      note: text('note'),
      actorId: uuid('actor_id').notNull(),
      actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
      idempotencyKey: text('idempotency_key').notNull(),
      requestHash: text('request_hash').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('production_runs_tenant_key_uq').on(
        t.tenantId,
        t.idempotencyKey,
      ),
      index('production_runs_tenant_created_idx').on(t.tenantId, t.createdAt),
      check(
        'production_runs_ck',
        sql`${t.batches} > 0 and ${t.plannedYield} > 0 and ${t.actualYield} > 0
          and ${t.ingredientCost} >= 0 and ${t.costPerPortion} >= 0`,
      ),
    ],
  )
  .enableRLS();

/** One row per ingredient a run drew: the whole base units taken and what they cost. */
export const productionRunLines = pos
  .table(
    'production_run_lines',
    {
      id: id(),
      tenantId: tenantId(),
      runId: uuid('run_id')
        .notNull()
        .references(() => productionRuns.id, { onDelete: 'restrict' }),
      ingredientId: uuid('ingredient_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      quantity: integer('quantity').notNull(),
      cost: rupiah('cost').notNull(),
    },
    (t) => [
      index('production_run_lines_run_idx').on(t.tenantId, t.runId),
      check(
        'production_run_lines_ck',
        sql`${t.quantity} > 0 and ${t.cost} >= 0`,
      ),
    ],
  )
  .enableRLS();
