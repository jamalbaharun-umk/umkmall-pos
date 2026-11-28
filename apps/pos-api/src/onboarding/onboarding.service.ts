import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  categories,
  paymentMethods,
  products,
  salesSettings,
} from '../db/schema';
import { CatalogService } from '../catalog/catalog.service';
import {
  BUSINESS_TEMPLATES,
  findTemplate,
  TEMPLATE_PAYMENT_METHODS,
  templateProducts,
} from './templates';

/** A product still waiting for its price: written by a template at Rp0 and kept off the till until priced. */
const unpricedWhere = (tenantId: string) =>
  and(
    eq(products.tenantId, tenantId),
    isNull(products.deletedAt),
    eq(products.sellingPrice, 0),
    eq(products.isActive, false),
    ne(products.type, 'ingredient'),
  );

/**
 * UMK-2128: the first screen's "Mulai dari template" and the "Isi harga" screen (design 44). The tenant is always the
 * session's. Applying a template twice adds nothing twice: a product whose name the store already has (ignoring case)
 * is skipped, categories and payment methods are found before they are made, and a tax the store already chose is
 * left as it is.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly catalog: CatalogService,
  ) {}

  templates() {
    return BUSINESS_TEMPLATES.map((t) => {
      const items = templateProducts(t);
      return {
        key: t.key,
        name: t.name,
        description: t.description,
        productCount: items.length,
        categories: t.categories.map((c) => c.name),
        sample: items.slice(0, 6).map((i) => i.name),
      };
    });
  }

  async apply(tenantId: string, key: string) {
    const template = findTemplate(key);
    if (!template) throw new NotFoundException();
    const items = templateProducts(template);

    const categoryOf = await this.categories(
      tenantId,
      template.categories.map((c) => c.name),
    );
    const taken = new Set(
      (
        await this.db
          .select({ v: sql<string>`lower(${products.name})` })
          .from(products)
          .where(
            and(
              eq(products.tenantId, tenantId),
              isNull(products.deletedAt),
              inArray(
                sql<string>`lower(${products.name})`,
                items.map((i) => i.name.toLowerCase()),
              ),
            ),
          )
      ).map((r) => r.v),
    );
    let created = 0;
    for (const item of items) {
      if (taken.has(item.name.toLowerCase())) continue;
      await this.catalog.createProduct(tenantId, {
        categoryId: categoryOf.get(item.category.toLowerCase())!,
        name: item.name,
        unit: item.unit,
        // No price yet: inactive at Rp0, so it never reaches the till before "Isi harga".
        sellingPrice: 0,
        type: template.type,
        isActive: false,
      });
      created++;
    }

    await this.db
      .insert(paymentMethods)
      .values(
        TEMPLATE_PAYMENT_METHODS.map((m) => ({
          tenantId,
          name: m.name,
          isCash: m.kind === 'cash',
          isWallet: m.kind === 'wallet',
        })),
      )
      .onConflictDoNothing();
    // Pajak 0% only when the store has not chosen a tax yet; a chosen one stays.
    await this.db
      .insert(salesSettings)
      .values({ tenantId, taxBps: 0, taxSetAt: new Date() })
      .onConflictDoUpdate({
        target: salesSettings.tenantId,
        set: { taxSetAt: sql`coalesce(${salesSettings.taxSetAt}, now())` },
        setWhere: sql`${salesSettings.taxSetAt} is null`,
      });

    return {
      template: template.key,
      created,
      skipped: items.length - created,
      unpriced: await this.unpricedCount(tenantId),
    };
  }

  async unpriced(tenantId: string) {
    const rows = await this.db
      .select({
        id: products.id,
        name: products.name,
        unit: products.unit,
        category: categories.name,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(unpricedWhere(tenantId))
      .orderBy(asc(categories.name), asc(products.name));
    return { data: rows, total: rows.length };
  }

  private async unpricedCount(tenantId: string) {
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(unpricedWhere(tenantId));
    return n;
  }

  /**
   * "Isi harga": each priced product gets its price and goes on sale (active). Only products still waiting for a
   * price are touched; a row that cannot be saved is reported and the others stay.
   */
  async setPrices(
    tenantId: string,
    items: Array<{ id: string; sellingPrice: number }>,
  ) {
    const waiting = new Set(
      (
        await this.db
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              unpricedWhere(tenantId),
              inArray(
                products.id,
                items.map((i) => i.id),
              ),
            ),
          )
      ).map((r) => r.id),
    );
    let priced = 0;
    const failed: Array<{ id: string; error: string }> = [];
    for (const item of items) {
      if (!waiting.has(item.id)) {
        failed.push({ id: item.id, error: 'Produk ini tidak menunggu harga' });
        continue;
      }
      try {
        await this.catalog.updateProduct(tenantId, item.id, {
          sellingPrice: item.sellingPrice,
          isActive: true,
        });
        priced++;
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        const body = e.getResponse() as { message?: unknown };
        failed.push({
          id: item.id,
          error:
            typeof body.message === 'string'
              ? body.message
              : 'Harga ini tidak bisa disimpan',
        });
      }
    }
    return { priced, failed, unpriced: await this.unpricedCount(tenantId) };
  }

  /** Category ids by lower-case name; the missing ones are made (a race answers the other insert's row). */
  private async categories(tenantId: string, names: string[]) {
    const map = new Map<string, string>();
    const find = async () => {
      const rows = await this.db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(
          and(
            eq(categories.tenantId, tenantId),
            inArray(
              sql<string>`lower(${categories.name})`,
              names.map((n) => n.toLowerCase()),
            ),
          ),
        );
      for (const r of rows) map.set(r.name.toLowerCase(), r.id);
    };
    await find();
    const missing = names.filter((n) => !map.has(n.toLowerCase()));
    if (missing.length) {
      await this.db
        .insert(categories)
        .values(missing.map((name) => ({ tenantId, name })))
        .onConflictDoNothing();
      await find();
    }
    return map;
  }
}
