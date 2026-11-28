import { HttpException, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { codedError } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { categories, productBarcodes, products } from '../db/schema';
import { StockService } from '../stock/stock.service';
import { CatalogService, QUICK_CATEGORY } from './catalog.service';
import { ImportFileError, readRows, type ImportRow } from './import';

export type PreviewRow = Omit<ImportRow, 'errors'> & {
  status: 'ok' | 'error';
  errors: string[];
};

/**
 * UMK-2129: product import with a preview. The preview reads the file and checks every row, against the file
 * itself and against the store (a SKU, barcode or name already used is reported, never overwritten). The import
 * reads the same file again and saves only the rows that pass, one product at a time, so a row that fails at save
 * time (another session took its SKU) is reported and the others stay. A second import of the same file finds
 * every name taken and saves nothing twice. The tenant is always the session's.
 */
@Injectable()
export class ImportService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly stock: StockService,
  ) {}

  private read(csv: string): ImportRow[] {
    try {
      return readRows(csv);
    } catch (e) {
      if (e instanceof ImportFileError)
        throw codedError('CSV_INVALID', 'csv', e.message);
      throw e;
    }
  }

  async preview(tenantId: string, csv: string) {
    const rows = this.read(csv);
    const lower = (xs: Array<string | null>) =>
      [...new Set(xs.filter((x): x is string => !!x))].map((x) =>
        x.toLowerCase(),
      );
    const skus = [
      ...new Set(rows.map((r) => r.sku).filter(Boolean)),
    ] as string[];
    const codes = [
      ...new Set(rows.map((r) => r.barcode).filter(Boolean)),
    ] as string[];
    const names = lower(rows.map((r) => r.name));
    const live = and(
      eq(products.tenantId, tenantId),
      isNull(products.deletedAt),
    );
    const [takenSkus, takenCodes, takenNames] = await Promise.all([
      skus.length
        ? this.db
            .select({ v: products.sku })
            .from(products)
            .where(and(live, inArray(products.sku, skus)))
        : [],
      codes.length
        ? this.db
            .select({ v: productBarcodes.code })
            .from(productBarcodes)
            .where(
              and(
                eq(productBarcodes.tenantId, tenantId),
                inArray(productBarcodes.code, codes),
              ),
            )
        : [],
      names.length
        ? this.db
            .select({ v: sql<string>`lower(${products.name})` })
            .from(products)
            .where(
              and(live, inArray(sql<string>`lower(${products.name})`, names)),
            )
        : [],
    ]);
    const sku = new Set(takenSkus.map((r) => r.v));
    const code = new Set(takenCodes.map((r) => r.v));
    const name = new Set(takenNames.map((r) => r.v));
    const out: PreviewRow[] = rows.map((r) => {
      const errors = [...r.errors];
      if (r.sku && sku.has(r.sku)) errors.push('SKU sudah dipakai produk lain');
      if (r.barcode && code.has(r.barcode))
        errors.push('Barcode sudah dipakai produk lain');
      if (r.name && name.has(r.name.toLowerCase()))
        errors.push('Produk dengan nama ini sudah ada');
      return { ...r, errors, status: errors.length ? 'error' : 'ok' };
    });
    return {
      rows: out,
      total: out.length,
      okCount: out.filter((r) => r.status === 'ok').length,
      errorCount: out.filter((r) => r.status === 'error').length,
    };
  }

  /** Saves the rows that pass the preview's checks; answers how many were made and which rows were not. */
  async import(tenantId: string, actorId: string, csv: string) {
    const preview = await this.preview(tenantId, csv);
    const ok = preview.rows.filter((r) => r.status === 'ok');
    const categoryOf = await this.categories(
      tenantId,
      ok.map((r) => r.category ?? QUICK_CATEGORY),
    );
    let created = 0;
    const failed: Array<{ row: number; name: string; errors: string[] }> =
      preview.rows
        .filter((r) => r.status === 'error')
        .map(({ row, name, errors }) => ({ row, name, errors }));
    for (const r of ok) {
      try {
        const product = await this.catalog.createProduct(tenantId, {
          categoryId: categoryOf.get(
            (r.category ?? QUICK_CATEGORY).toLowerCase(),
          )!,
          name: r.name,
          sku: r.sku ?? undefined,
          unit: r.unit ?? undefined,
          costPrice: r.costPrice ?? undefined,
          sellingPrice: r.sellingPrice!,
          // A stock column (even 0) means the product tracks stock; without one it sells at once.
          type: r.stock === null ? 'non_stock' : 'product',
          barcodes: r.barcode ? [r.barcode] : undefined,
        });
        if (r.stock)
          await this.stock.opening(tenantId, actorId, {
            // `present` spreads the row: its id is there, typed loosely.
            productId: (product as unknown as { id: string }).id,
            qty: r.stock,
          });
        created++;
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        const body = e.getResponse() as { message?: unknown };
        failed.push({
          row: r.row,
          name: r.name,
          errors: [
            typeof body.message === 'string'
              ? body.message
              : 'Baris ini tidak bisa disimpan',
          ],
        });
      }
    }
    failed.sort((a, b) => a.row - b.row);
    return { created, failed, total: preview.total };
  }

  /** Category ids by lower-case name; the missing ones are made (a race answers the other insert's row). */
  private async categories(tenantId: string, wanted: string[]) {
    // The first spelling in the file names a new category ("Sembako" before "sembako").
    const first = new Map<string, string>();
    for (const n of wanted)
      if (!first.has(n.toLowerCase())) first.set(n.toLowerCase(), n);
    const names = [...first.values()];
    const map = new Map<string, string>();
    if (!names.length) return map;
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
