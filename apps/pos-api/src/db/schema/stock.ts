import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah } from './_base';
import { products } from './catalog';
import { tenants } from './tenants';

// U3 stock (ported from Lakasir `stocks`): batches are the only truth for on-hand quantity
// (Lakasir also kept `products.stock`, drifting from its batches). Writes go through StockService only.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

// UMK-2132: `production` is the finished product of a production run (src/production/).
export const STOCK_SOURCES = [
  'opening',
  'purchase',
  'adjustment',
  'production',
] as const;
export type StockSource = (typeof STOCK_SOURCES)[number];
export const STOCK_REASONS = [
  'opening',
  'sale',
  'sale_void',
  'purchase',
  'opname',
  // UMK-1970: units sent back to the supplier, out of the purchase's own batch.
  'purchase_return',
  // UMK-1970: a return undone, the units back into the batch they left.
  'purchase_return_reversal',
  // UMK-2132: a production run's finished batch in, and its ingredients out.
  'production',
  'production_use',
] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export const stockBatches = pos
  .table(
    'stock_batches',
    {
      id: id(),
      tenantId: tenantId(),
      // Same tenant as the batch: StockService checks the product before every write.
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      qtyInitial: integer('qty_initial').notNull(),
      qtyRemaining: integer('qty_remaining').notNull(),
      unitCost: rupiah('unit_cost').notNull(),
      receivedAt: timestamp('received_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      // UMK-2087: optional best-before date (a store calendar day); null for stock that does not expire.
      expiresAt: date('expires_at', { mode: 'string' }),
      source: text('source', { enum: STOCK_SOURCES }).notNull(),
      sourceId: uuid('source_id'),
      createdAt: createdAt(),
    },
    (t) => [
      index('stock_batches_fifo_idx').on(t.tenantId, t.productId, t.receivedAt),
      check(
        'stock_batches_qty_ck',
        sql`${t.qtyInitial} > 0 and ${t.qtyRemaining} >= 0 and ${t.qtyRemaining} <= ${t.qtyInitial}`,
      ),
      check('stock_batches_cost_ck', sql`${t.unitCost} >= 0`),
      check(
        'stock_batches_source_ck',
        sql`${t.source} in ('opening', 'purchase', 'adjustment', 'production')`,
      ),
    ],
  )
  .enableRLS();

export const stockMovements = pos
  .table(
    'stock_movements',
    {
      id: id(),
      tenantId: tenantId(),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      batchId: uuid('batch_id')
        .notNull()
        .references(() => stockBatches.id, { onDelete: 'restrict' }),
      delta: integer('delta').notNull(),
      reason: text('reason', { enum: STOCK_REASONS }).notNull(),
      refId: uuid('ref_id'),
      actorId: uuid('actor_id').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index('stock_movements_product_idx').on(t.tenantId, t.productId),
      index('stock_movements_ref_idx').on(t.refId),
      check('stock_movements_delta_ck', sql`${t.delta} <> 0`),
      check(
        'stock_movements_reason_ck',
        sql`${t.reason} in ('opening', 'sale', 'sale_void', 'purchase', 'opname', 'purchase_return', 'purchase_return_reversal', 'production', 'production_use')`,
      ),
    ],
  )
  .enableRLS();
