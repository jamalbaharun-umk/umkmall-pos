import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah, updatedAt } from './_base';
import { products } from './catalog';
import { tenants } from './tenants';

// U6 stock in (ported from Lakasir suppliers/purchasings/stock_opnames). Stock itself lives in the
// stock module (U3); these tables only record documents and call it on approval.
// Actor columns hold the session's actorId (UMKMall user id for owners, staff id for cashiers): no FK.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

export const suppliers = pos
  .table(
    'suppliers',
    {
      id: id(),
      tenantId: tenantId(),
      name: text('name').notNull(),
      phone: text('phone'),
      address: text('address'),
      deletedAt: timestamp('deleted_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [index('suppliers_tenant_idx').on(t.tenantId)],
  )
  .enableRLS();

export const PURCHASE_STATUSES = ['draft', 'approved', 'cancelled'] as const;

export const purchaseOrders = pos
  .table(
    'purchase_orders',
    {
      id: id(),
      tenantId: tenantId(),
      supplierId: uuid('supplier_id')
        .notNull()
        .references(() => suppliers.id, { onDelete: 'restrict' }),
      status: text('status', { enum: PURCHASE_STATUSES })
        .notNull()
        .default('draft'),
      paymentMethod: text('payment_method'),
      note: text('note'),
      // Σ qty × unit cost of the lines, computed by the server.
      total: rupiah('total').notNull().default(0),
      createdBy: uuid('created_by').notNull(),
      approvedBy: uuid('approved_by'),
      approvedAt: timestamp('approved_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index('purchase_orders_tenant_idx').on(t.tenantId, t.createdAt),
      check(
        'purchase_orders_status_ck',
        sql`${t.status} in ('draft', 'approved', 'cancelled')`,
      ),
      check('purchase_orders_total_ck', sql`${t.total} >= 0`),
    ],
  )
  .enableRLS();

export const purchaseOrderLines = pos
  .table(
    'purchase_order_lines',
    {
      id: id(),
      tenantId: tenantId(),
      orderId: uuid('order_id')
        .notNull()
        .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      qty: integer('qty').notNull(),
      unitCost: rupiah('unit_cost').notNull(),
    },
    (t) => [
      index('purchase_order_lines_order_idx').on(t.orderId),
      check(
        'purchase_order_lines_ck',
        sql`${t.qty} > 0 and ${t.unitCost} >= 0`,
      ),
    ],
  )
  .enableRLS();

export const OPNAME_STATUSES = ['draft', 'approved'] as const;

export const stockOpnames = pos
  .table(
    'stock_opnames',
    {
      id: id(),
      tenantId: tenantId(),
      status: text('status', { enum: OPNAME_STATUSES })
        .notNull()
        .default('draft'),
      note: text('note'),
      createdBy: uuid('created_by').notNull(),
      approvedBy: uuid('approved_by'),
      approvedAt: timestamp('approved_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      index('stock_opnames_tenant_idx').on(t.tenantId, t.createdAt),
      check(
        'stock_opnames_status_ck',
        sql`${t.status} in ('draft', 'approved')`,
      ),
    ],
  )
  .enableRLS();

export const stockOpnameLines = pos
  .table(
    'stock_opname_lines',
    {
      id: id(),
      tenantId: tenantId(),
      opnameId: uuid('opname_id')
        .notNull()
        .references(() => stockOpnames.id, { onDelete: 'cascade' }),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      countedQty: integer('counted_qty').notNull(),
      // onHand when the line was saved; the adjustment is counted − system.
      systemQty: integer('system_qty').notNull(),
      reason: text('reason'),
    },
    (t) => [
      uniqueIndex('stock_opname_lines_product_uq').on(t.opnameId, t.productId),
      check('stock_opname_lines_ck', sql`${t.countedQty} >= 0`),
    ],
  )
  .enableRLS();
