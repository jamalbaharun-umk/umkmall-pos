import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah, updatedAt } from './_base';
import { tenants } from './tenants';

// U2 catalog (ported from Lakasir categories/products/barcodes/product_images).
// Stock is NOT here: the stock module (U3/U6) keeps quantities keyed by products.id.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

export const categories = pos
  .table(
    'categories',
    {
      id: id(),
      tenantId: tenantId(),
      name: text('name').notNull(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    // Unique ignoring case ("Minuman" = "minuman").
    (t) => [
      uniqueIndex('categories_tenant_name_uq').on(
        t.tenantId,
        sql`lower(${t.name})`,
      ),
    ],
  )
  .enableRLS();

export const PRODUCT_TYPES = ['product', 'service', 'non_stock'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const products = pos
  .table(
    'products',
    {
      id: id(),
      tenantId: tenantId(),
      // Same tenant as the product: checked by the catalog service before every write.
      categoryId: uuid('category_id')
        .notNull()
        .references(() => categories.id, { onDelete: 'restrict' }),
      name: text('name').notNull(),
      sku: text('sku').notNull(),
      unit: text('unit').notNull().default('PCS'),
      costPrice: rupiah('cost_price').notNull().default(0),
      sellingPrice: rupiah('selling_price').notNull(),
      // Only 'product' tracks stock (U3/U6); 'service' and 'non_stock' never do.
      type: text('type', { enum: PRODUCT_TYPES }).notNull().default('product'),
      isActive: boolean('is_active').notNull().default(true),
      // On-hand at or below this counts as "menipis" on the cashier grid and in the catalog (UMK-1966).
      lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
      deletedAt: timestamp('deleted_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      // Live products only, so a deleted product's SKU can be reused.
      uniqueIndex('products_tenant_sku_uq')
        .on(t.tenantId, t.sku)
        .where(sql`${t.deletedAt} is null`),
      index('products_tenant_category_idx').on(t.tenantId, t.categoryId),
      check(
        'products_prices_ck',
        sql`${t.costPrice} >= 0 and ${t.sellingPrice} >= 0`,
      ),
      check(
        'products_type_ck',
        sql`${t.type} in ('product', 'service', 'non_stock')`,
      ),
      check('products_sku_ck', sql`${t.sku} !~ '\\s'`),
      check('products_low_stock_ck', sql`${t.lowStockThreshold} >= 0`),
    ],
  )
  .enableRLS();

export const productBarcodes = pos
  .table(
    'product_barcodes',
    {
      id: id(),
      tenantId: tenantId(),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'cascade' }),
      code: text('code').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('product_barcodes_tenant_code_uq').on(t.tenantId, t.code),
      index('product_barcodes_product_idx').on(t.productId),
    ],
  )
  .enableRLS();

export const productImages = pos
  .table(
    'product_images',
    {
      id: id(),
      tenantId: tenantId(),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'cascade' }),
      // tenants/<tenantId>/products/<productId>/<uuid>.<ext> — the U8 purge deletes the tenants/<id>/ prefix.
      storageKey: text('storage_key').notNull().unique(),
      contentType: text('content_type').notNull(),
      sizeBytes: integer('size_bytes').notNull(),
      createdAt: createdAt(),
    },
    (t) => [index('product_images_product_idx').on(t.productId)],
  )
  .enableRLS();
