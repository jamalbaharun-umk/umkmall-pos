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

// UMK-1985: other units a product is sold in (dus = 24 pcs) at a fixed price per unit. The base unit is
// products.unit / products.selling_price; stock is always kept in base units. A sale line snapshots the
// unit's name, multiplier and price, so editing or removing a row here never changes a past sale.
export const productUnits = pos
  .table(
    'product_units',
    {
      id: id(),
      tenantId: tenantId(),
      // Same tenant as the product: the catalog service checks the product before every write.
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'cascade' }),
      name: text('name').notNull(),
      // Base units in one of this unit.
      unitQty: integer('unit_qty').notNull(),
      price: rupiah('price').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('product_units_product_name_uq').on(
        t.productId,
        sql`lower(${t.name})`,
      ),
      index('product_units_tenant_idx').on(t.tenantId),
      check('product_units_ck', sql`${t.unitQty} >= 2 and ${t.price} > 0`),
    ],
  )
  .enableRLS();

// UMK-1985: wholesale tiers, per base unit: from `min_qty` base units of the product in one cart (all its
// lines, a dus counted as its base units) a base-unit line costs `price`.
export const productPriceTiers = pos
  .table(
    'product_price_tiers',
    {
      id: id(),
      tenantId: tenantId(),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'cascade' }),
      minQty: integer('min_qty').notNull(),
      price: rupiah('price').notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex('product_price_tiers_product_min_uq').on(
        t.productId,
        t.minQty,
      ),
      index('product_price_tiers_tenant_idx').on(t.tenantId),
      check('product_price_tiers_ck', sql`${t.minQty} >= 2 and ${t.price} > 0`),
    ],
  )
  .enableRLS();
