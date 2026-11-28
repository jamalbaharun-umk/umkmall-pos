import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { StockService } from '../stock/stock.service';
import { fieldError } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  categories,
  productBarcodes,
  productImages,
  productPriceTiers,
  products,
  productUnits,
  stockBatches,
  isStocked,
} from '../db/schema';
import {
  pricingIssues,
  pricingWarnings,
  type PriceTier,
  type ProductPricing,
  type ProductUnit,
} from './pricing';
import { loadPricing, type StoredPricing } from './pricing-store';
import type {
  ProductCreate,
  QuickProductCreate,
  ProductQuery,
  ProductUpdate,
} from './catalog.schemas';
import { detectImage, OBJECT_STORAGE, type ObjectStorage } from './storage';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// Postgres unique violations → 409 on the field, with a stable, internals-free message.
const CONFLICTS: Record<string, [field: string, message: string]> = {
  categories_tenant_name_uq: ['name', 'Nama kategori sudah dipakai'],
  products_tenant_sku_uq: ['sku', 'SKU sudah dipakai produk lain'],
  product_barcodes_tenant_code_uq: [
    'barcodes',
    'Barcode sudah dipakai produk lain',
  ],
};

function pgError(e: unknown): { code?: string; constraint_name?: string } {
  // drizzle wraps the driver error in `cause`.
  const err = e as { code?: string; cause?: unknown };
  return err.code ? err : (err.cause ?? {});
}

function conflictOf(e: unknown): [string, string] | null {
  const pg = pgError(e);
  return pg.code === '23505'
    ? (CONFLICTS[pg.constraint_name ?? ''] ?? null)
    : null;
}

function rethrow(e: unknown): never {
  const hit = conflictOf(e);
  if (hit) throw fieldError(hit[0], hit[1], 409);
  throw e;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

const productColumns = {
  id: products.id,
  categoryId: products.categoryId,
  categoryName: categories.name,
  name: products.name,
  sku: products.sku,
  unit: products.unit,
  costPrice: products.costPrice,
  sellingPrice: products.sellingPrice,
  type: products.type,
  isActive: products.isActive,
  lowStockThreshold: products.lowStockThreshold,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
};

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** UMK-2130: where a product made from the till goes until the owner files it. */
export const QUICK_CATEGORY = 'Lainnya';

@Injectable()
export class CatalogService {
  constructor(
    @InjectDb() private readonly db: Db,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly stock: StockService,
  ) {}

  // ---------- categories ----------

  listCategories(tenantId: string) {
    return this.db
      .select({
        id: categories.id,
        name: categories.name,
        createdAt: categories.createdAt,
      })
      .from(categories)
      .where(eq(categories.tenantId, tenantId))
      .orderBy(asc(categories.name));
  }

  async createCategory(tenantId: string, name: string) {
    try {
      const [row] = await this.db
        .insert(categories)
        .values({ tenantId, name })
        .returning({
          id: categories.id,
          name: categories.name,
          createdAt: categories.createdAt,
        });
      return row;
    } catch (e) {
      rethrow(e);
    }
  }

  async updateCategory(tenantId: string, id: string, name: string) {
    try {
      const [row] = await this.db
        .update(categories)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)))
        .returning({
          id: categories.id,
          name: categories.name,
          createdAt: categories.createdAt,
        });
      if (!row) throw new NotFoundException();
      return row;
    } catch (e) {
      rethrow(e);
    }
  }

  async deleteCategory(tenantId: string, id: string) {
    const [inUse] = await this.db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, id)));
    // Soft-deleted products still reference the category (sales history), so they count too.
    if (inUse.n > 0)
      throw new ConflictException('Kategori masih dipakai produk');
    // A product created between the count and the delete trips the foreign key: same answer.
    const [row] = await this.db
      .delete(categories)
      .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)))
      .returning({ id: categories.id })
      .catch((e: unknown) => {
        if (pgError(e).code === '23503')
          throw new ConflictException('Kategori masih dipakai produk');
        throw e;
      });
    if (!row) throw new NotFoundException();
  }

  // ---------- products ----------

  private live(tenantId: string) {
    return and(eq(products.tenantId, tenantId), isNull(products.deletedAt));
  }

  async listProducts(tenantId: string, q: ProductQuery) {
    const filters = [this.live(tenantId)];
    if (q.categoryId) filters.push(eq(products.categoryId, q.categoryId));
    if (q.sku) filters.push(eq(products.sku, q.sku));
    if (q.type) filters.push(eq(products.type, q.type));
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      filters.push(
        or(
          ilike(products.name, like),
          ilike(products.sku, like),
          sql`exists (select 1 from ${productBarcodes} b where b.product_id = ${products.id} and b.code ilike ${like})`,
        ),
      );
    }
    // Counts for the "Menipis (n)" / "Habis (n)" filters follow the search and category, not the stock filter.
    const countsWhere = and(...filters);
    if (q.stock) filters.push(this.stockStateIs(tenantId, q.stock));
    if (q.cost === 'missing') filters.push(eq(products.costPrice, 0));
    const where = and(...filters);
    const [rows, [{ total }], [stockCounts]] = await Promise.all([
      this.db
        .select(productColumns)
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .where(where)
        .orderBy(desc(products.createdAt), desc(products.id))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db.select({ total: count() }).from(products).where(where),
      this.db
        .select({
          low: sql<number>`count(*) filter (where ${this.stockStateIs(tenantId, 'low')})::int`,
          out: sql<number>`count(*) filter (where ${this.stockStateIs(tenantId, 'out')})::int`,
          costMissing: sql<number>`count(*) filter (where ${products.costPrice} = 0)::int`,
        })
        .from(products)
        .where(countsWhere),
    ]);
    const [codes, pricing, onHand] = await Promise.all([
      this.barcodesOf(rows.map((r) => r.id)),
      loadPricing(
        this.db,
        tenantId,
        rows.map((r) => r.id),
      ),
      this.stock.onHand(
        tenantId,
        rows.filter((r) => isStocked(r.type)).map((r) => r.id),
      ),
    ]);
    return {
      data: rows.map((r) => ({
        ...this.present(r, codes.get(r.id) ?? [], pricing.get(r.id)),
        // Only stocked types (product, ingredient) track stock; service and non_stock rows answer null.
        stock: isStocked(r.type) ? (onHand[r.id] ?? 0) : null,
      })),
      page: q.page,
      perPage: q.perPage,
      total,
      stockCounts: { low: stockCounts.low, out: stockCounts.out },
      // UMK-2130: "Modal belum diisi (n)", following the search and category like the stock counts.
      costMissingCount: stockCounts.costMissing,
    };
  }

  /** On-hand from the batches (the only truth, see StockService.onHand) against the product's threshold. */
  private stockStateIs(tenantId: string, state: 'low' | 'out') {
    const onHand = sql`coalesce((select sum(b.qty_remaining) from ${stockBatches} b where b.product_id = ${products.id} and b.tenant_id = ${tenantId}), 0)`;
    return state === 'out'
      ? sql`(${products.type} in ('product', 'ingredient') and ${onHand} = 0)`
      : sql`(${products.type} in ('product', 'ingredient') and ${onHand} > 0 and ${onHand} <= ${products.lowStockThreshold})`;
  }

  async getProduct(tenantId: string, id: string) {
    const [row] = await this.db
      .select(productColumns)
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(and(this.live(tenantId), eq(products.id, id)));
    if (!row) throw new NotFoundException();
    const [codes, pricing, images] = await Promise.all([
      this.barcodesOf([id]),
      loadPricing(this.db, tenantId, [id]),
      this.db
        .select({
          id: productImages.id,
          contentType: productImages.contentType,
          sizeBytes: productImages.sizeBytes,
        })
        .from(productImages)
        .where(
          and(
            eq(productImages.tenantId, tenantId),
            eq(productImages.productId, id),
          ),
        )
        .orderBy(asc(productImages.createdAt)),
    ]);
    return {
      ...this.present(row, codes.get(id) ?? [], pricing.get(id)),
      images,
    };
  }

  async createProduct(tenantId: string, input: ProductCreate) {
    const category = await this.requireCategory(tenantId, input.categoryId);
    const pricing: ProductPricing = {
      unit: input.unit ?? 'PCS',
      sellingPrice: input.sellingPrice,
      units: input.units ?? [],
      tiers: input.priceTiers ?? [],
    };
    this.assertPricing(pricing);
    const generate = !input.sku;
    // A generated SKU can race another create; retry with the next number.
    for (let attempt = 0; ; attempt++) {
      try {
        const id = await this.db.transaction(async (tx) => {
          const sku = generate
            ? await this.nextSku(
                tx,
                tenantId,
                category.name,
                input.name,
                attempt,
              )
            : input.sku!;
          const [row] = await tx
            .insert(products)
            .values({
              tenantId,
              categoryId: input.categoryId,
              name: input.name,
              sku,
              unit: pricing.unit,
              costPrice: input.costPrice,
              sellingPrice: input.sellingPrice,
              type: input.type,
              isActive: input.isActive,
              lowStockThreshold: input.lowStockThreshold,
            })
            .returning({ id: products.id });
          await this.replaceBarcodes(
            tx,
            tenantId,
            row.id,
            input.barcodes ?? [],
          );
          await this.replaceUnits(tx, tenantId, row.id, pricing.units);
          await this.replaceTiers(tx, tenantId, row.id, pricing.tiers);
          return row.id;
        });
        return {
          ...(await this.getProduct(tenantId, id)),
          warnings: pricingWarnings(pricing),
        };
      } catch (e) {
        if (
          generate &&
          attempt < 3 &&
          conflictOf(e) === CONFLICTS.products_tenant_sku_uq
        )
          continue;
        rethrow(e);
      }
    }
  }

  /**
   * UMK-2130 "Produk cepat": a `non_stock` product in the store's "Lainnya" category (made the first time, found
   * ignoring case after that), SKU generated, cost 0 when not given (flagged "Modal belum diisi").
   */
  async createQuickProduct(tenantId: string, input: QuickProductCreate) {
    const categoryId = await this.otherCategory(tenantId);
    return this.createProduct(tenantId, {
      categoryId,
      name: input.name,
      sellingPrice: input.sellingPrice,
      costPrice: input.costPrice,
      type: 'non_stock',
      barcodes: input.barcode ? [input.barcode] : undefined,
    });
  }

  /** The id of the store's "Lainnya" category, made if it has none (a race answers the other insert's row). */
  private async otherCategory(tenantId: string): Promise<string> {
    const find = async () =>
      (
        await this.db
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.tenantId, tenantId),
              sql`lower(${categories.name}) = lower(${QUICK_CATEGORY})`,
            ),
          )
      )[0]?.id;
    const found = await find();
    if (found) return found;
    const [row] = await this.db
      .insert(categories)
      .values({ tenantId, name: QUICK_CATEGORY })
      .onConflictDoNothing()
      .returning({ id: categories.id });
    return row?.id ?? (await find());
  }

  async updateProduct(tenantId: string, id: string, input: ProductUpdate) {
    const [current] = await this.db
      .select({
        costPrice: products.costPrice,
        sellingPrice: products.sellingPrice,
      })
      .from(products)
      .where(and(this.live(tenantId), eq(products.id, id)));
    if (!current) throw new NotFoundException();
    if (input.categoryId)
      await this.requireCategory(tenantId, input.categoryId);
    const cost = input.costPrice ?? current.costPrice;
    const selling = input.sellingPrice ?? current.sellingPrice;
    if (cost > selling) {
      throw fieldError(
        'costPrice',
        'Harga modal tidak boleh melebihi harga jual',
      );
    }
    const { barcodes, units, priceTiers, ...fields } = input;
    let pricing: ProductPricing;
    try {
      pricing = await this.db.transaction(async (tx) => {
        // The row lock makes "read the stored units and tiers, check, write" one step per product.
        const [locked] = await tx
          .select({ unit: products.unit, sellingPrice: products.sellingPrice })
          .from(products)
          .where(and(this.live(tenantId), eq(products.id, id)))
          .for('update');
        if (!locked) throw new NotFoundException();
        const stored = (await loadPricing(tx, tenantId, [id])).get(id);
        const merged: ProductPricing = {
          unit: fields.unit ?? locked.unit,
          sellingPrice: fields.sellingPrice ?? locked.sellingPrice,
          units: units ?? stored?.units ?? [],
          tiers: priceTiers ?? stored?.tiers ?? [],
        };
        this.assertPricing(merged, priceTiers ? 'priceTiers' : 'sellingPrice');
        await tx
          .update(products)
          .set({ ...fields, updatedAt: new Date() })
          .where(and(this.live(tenantId), eq(products.id, id)));
        if (barcodes) await this.replaceBarcodes(tx, tenantId, id, barcodes);
        if (units) await this.replaceUnits(tx, tenantId, id, units);
        if (priceTiers) await this.replaceTiers(tx, tenantId, id, priceTiers);
        return merged;
      });
    } catch (e) {
      rethrow(e);
    }
    return {
      ...(await this.getProduct(tenantId, id)),
      warnings: pricingWarnings(pricing),
    };
  }

  async deleteProduct(tenantId: string, id: string) {
    const images = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(products)
        .set({ deletedAt: new Date() })
        .where(and(this.live(tenantId), eq(products.id, id)))
        .returning({ id: products.id });
      if (!row) throw new NotFoundException();
      // Free the barcodes for reuse; drop the image rows (bytes deleted after commit).
      await tx
        .delete(productBarcodes)
        .where(
          and(
            eq(productBarcodes.tenantId, tenantId),
            eq(productBarcodes.productId, id),
          ),
        );
      return tx
        .delete(productImages)
        .where(
          and(
            eq(productImages.tenantId, tenantId),
            eq(productImages.productId, id),
          ),
        )
        .returning({ key: productImages.storageKey });
    });
    await Promise.all(images.map((i) => this.storage.delete(i.key)));
  }

  // ---------- images ----------

  async addImage(
    tenantId: string,
    productId: string,
    file: { buffer: Buffer } | undefined,
  ) {
    await this.requireProduct(tenantId, productId);
    const kind =
      file && file.buffer.length <= MAX_IMAGE_BYTES
        ? detectImage(file.buffer)
        : null;
    if (!file || !kind) {
      throw fieldError(
        'file',
        'Gambar harus JPG, PNG atau WebP, maksimal 2 MB',
      );
    }
    const storageKey = `tenants/${tenantId}/products/${productId}/${randomUUID()}.${kind.ext}`;
    await this.storage.put(storageKey, file.buffer);
    try {
      const [row] = await this.db
        .insert(productImages)
        .values({
          tenantId,
          productId,
          storageKey,
          contentType: kind.contentType,
          sizeBytes: file.buffer.length,
        })
        .returning({
          id: productImages.id,
          contentType: productImages.contentType,
          sizeBytes: productImages.sizeBytes,
        });
      return row;
    } catch (e) {
      await this.storage.delete(storageKey);
      throw e;
    }
  }

  private async findImage(
    tenantId: string,
    productId: string,
    imageId: string,
  ) {
    await this.requireProduct(tenantId, productId);
    const [image] = await this.db
      .select({
        key: productImages.storageKey,
        contentType: productImages.contentType,
      })
      .from(productImages)
      .where(
        and(
          eq(productImages.tenantId, tenantId),
          eq(productImages.productId, productId),
          eq(productImages.id, imageId),
        ),
      );
    if (!image) throw new NotFoundException();
    return image;
  }

  async getImage(tenantId: string, productId: string, imageId: string) {
    const image = await this.findImage(tenantId, productId, imageId);
    const body = await this.storage.get(image.key);
    if (!body) throw new NotFoundException();
    return { body, contentType: image.contentType };
  }

  async deleteImage(tenantId: string, productId: string, imageId: string) {
    const image = await this.findImage(tenantId, productId, imageId);
    await this.db
      .delete(productImages)
      .where(
        and(
          eq(productImages.tenantId, tenantId),
          eq(productImages.id, imageId),
        ),
      );
    await this.storage.delete(image.key);
  }

  // ---------- helpers ----------

  private async requireCategory(tenantId: string, id: string) {
    const [row] = await this.db
      .select({ name: categories.name })
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), eq(categories.id, id)));
    // 422, not 404: the category is a field of the payload, not the resource in the path.
    if (!row) throw fieldError('categoryId', 'Kategori tidak ditemukan');
    return row;
  }

  private async requireProduct(tenantId: string, id: string) {
    const [row] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(this.live(tenantId), eq(products.id, id)));
    if (!row) throw new NotFoundException();
  }

  /** CAT-NAM-0001: letters/digits only, never a space (Lakasir flaw 9). */
  private async nextSku(
    tx: Tx,
    tenantId: string,
    category: string,
    name: string,
    bump: number,
  ) {
    const prefix = `${alnum(category).slice(0, 3) || 'PRD'}-${alnum(name).slice(0, 3) || 'X'}`;
    const [{ n }] = await tx
      .select({ n: count() })
      .from(products)
      .where(eq(products.tenantId, tenantId));
    return `${prefix}-${String(n + 1 + bump).padStart(4, '0')}`;
  }

  private async replaceBarcodes(
    tx: Tx,
    tenantId: string,
    productId: string,
    codes: string[],
  ) {
    await tx
      .delete(productBarcodes)
      .where(
        and(
          eq(productBarcodes.tenantId, tenantId),
          eq(productBarcodes.productId, productId),
        ),
      );
    if (codes.length)
      await tx
        .insert(productBarcodes)
        .values(codes.map((code) => ({ tenantId, productId, code })));
  }

  /** 422 on the first rule the product's units and tiers break (UMK-1985). */
  private assertPricing(
    pricing: ProductPricing,
    priceField: 'priceTiers' | 'sellingPrice' = 'priceTiers',
  ) {
    const [issue] = pricingIssues(pricing, priceField);
    if (issue) throw fieldError(issue.field, issue.message);
  }

  private async replaceUnits(
    tx: Tx,
    tenantId: string,
    productId: string,
    units: ProductUnit[],
  ) {
    await tx
      .delete(productUnits)
      .where(
        and(
          eq(productUnits.tenantId, tenantId),
          eq(productUnits.productId, productId),
        ),
      );
    if (units.length)
      await tx.insert(productUnits).values(
        units.map((u) => ({
          tenantId,
          productId,
          name: u.name,
          unitQty: u.unitQty,
          price: u.price,
        })),
      );
  }

  private async replaceTiers(
    tx: Tx,
    tenantId: string,
    productId: string,
    tiers: PriceTier[],
  ) {
    await tx
      .delete(productPriceTiers)
      .where(
        and(
          eq(productPriceTiers.tenantId, tenantId),
          eq(productPriceTiers.productId, productId),
        ),
      );
    if (tiers.length)
      await tx.insert(productPriceTiers).values(
        tiers.map((t) => ({
          tenantId,
          productId,
          minQty: t.minQty,
          price: t.price,
        })),
      );
  }

  private async barcodesOf(productIds: string[]) {
    const map = new Map<string, string[]>();
    if (!productIds.length) return map;
    const rows = await this.db
      .select({
        productId: productBarcodes.productId,
        code: productBarcodes.code,
      })
      .from(productBarcodes)
      .where(inArray(productBarcodes.productId, productIds))
      .orderBy(asc(productBarcodes.createdAt), asc(productBarcodes.code));
    for (const r of rows)
      map.set(r.productId, [...(map.get(r.productId) ?? []), r.code]);
    return map;
  }

  private present(
    {
      categoryName,
      ...row
    }: { categoryName: string; categoryId: string } & Record<string, unknown>,
    barcodes: string[],
    pricing?: StoredPricing,
  ) {
    return {
      ...row,
      category: { id: row.categoryId, name: categoryName },
      barcodes,
      // UMK-1985: other units (smallest pack first) and wholesale tiers per base unit (lowest quantity first).
      units: pricing?.units ?? [],
      priceTiers: pricing?.tiers ?? [],
    };
  }
}
