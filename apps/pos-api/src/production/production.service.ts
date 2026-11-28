import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from '../audit/record';
import { storeDayOf } from '../common/store-day';
import {
  codedError,
  fieldError,
  LocalDate,
  Paging,
} from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import {
  isStocked,
  productionRunLines,
  productionRuns,
  products,
} from '../db/schema';
import { RecipesService } from '../recipes/recipes.service';
import { isUniqueViolation } from '../staff/http';
import { StockService, type Tx } from '../stock/stock.service';
import type { PosSession } from '../tenancy/session';
import {
  costPerPortion,
  MAX_STOCK_QTY,
  requirements,
  wholeUnits,
} from './requirements';

const batchCount = (n: z.ZodNumber) =>
  n
    .int('Jumlah batch harus bilangan bulat')
    .positive('Jumlah batch harus lebih dari 0')
    .max(1_000, 'Jumlah batch maksimal 1.000');

export const ProductionRunInput = z
  .object({
    recipeId: z.string({ required_error: 'Pilih resep' }).uuid('Pilih resep'),
    batches: batchCount(
      z.number({
        required_error: 'Jumlah batch wajib diisi',
        invalid_type_error: 'Harus berupa angka',
      }),
    ),
    actualYield: z
      .number({ required_error: 'Hasil sebenarnya wajib diisi' })
      .int('Hasil harus bilangan bulat')
      .positive('Hasil harus lebih dari 0')
      .max(10_000_000, 'Hasil maksimal 10.000.000'),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type ProductionRunInput = z.infer<typeof ProductionRunInput>;

export const PlanQuery = z
  .object({
    recipeId: z.string({ required_error: 'Pilih resep' }).uuid('Pilih resep'),
    batches: batchCount(
      z.coerce.number({ invalid_type_error: 'Harus berupa angka' }),
    ),
  })
  .strict();

export const RunListQuery = z
  .object({ from: LocalDate.optional(), to: LocalDate.optional(), ...Paging })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'Tanggal awal harus sebelum tanggal akhir',
    path: ['from'],
  });

/** Same key + same request → the first run; same key + another request → refused. */
const requestHash = (i: ProductionRunInput) =>
  createHash('sha256')
    .update(
      JSON.stringify([i.recipeId, i.batches, i.actualYield, i.note || null]),
    )
    .digest('hex');

const KEY_REUSED = 'Kunci ini sudah dipakai untuk produksi lain';
const unitLabel = (unit: string) => unit.toLowerCase();

type Need = {
  productId: string;
  name: string;
  unit: string;
  needed: number;
  available: number;
};

/**
 * Production runs (UMK-2132, design 45): the ingredients of a recipe out FIFO and its finished product in as a new
 * batch, in one transaction under the batches' row locks. The only writer of `pos.production_runs` and
 * `production_run_lines`. Every query filters the session's tenant.
 */
@Injectable()
export class ProductionService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly recipes: RecipesService,
    private readonly stock: StockService,
  ) {}

  /**
   * The recipe, its finished product and the whole units of each raw ingredient `batches` batches take, sorted by
   * product id (the lock order of a sale). 422 on `recipeId` for a recipe not of this store, a deleted ingredient or
   * a finished product that keeps no stock.
   */
  private async prepare(
    db: Db | Tx,
    tenantId: string,
    recipeId: string,
    batches: number,
  ) {
    const { rows, graph, deletedIn } = await this.recipes.graph(db, tenantId);
    const recipe = rows.find((r) => r.id === recipeId);
    if (!recipe) throw fieldError('recipeId', 'Resep tidak ditemukan');
    const deleted = deletedIn(recipe.id);
    const exact = requirements(graph, recipe.id, batches);
    const ids = [...exact.keys()].sort();
    const items = ids.length
      ? await db
          .select({
            id: products.id,
            name: products.name,
            unit: products.unit,
          })
          .from(products)
          .where(
            and(eq(products.tenantId, tenantId), inArray(products.id, ids)),
          )
      : [];
    const byId = new Map(items.map((p) => [p.id, p]));
    const [finished] = await db
      .select({ deletedAt: products.deletedAt })
      .from(products)
      .where(
        and(eq(products.tenantId, tenantId), eq(products.id, recipe.productId)),
      );
    return {
      recipe,
      deleted,
      finishedLive: !!finished && finished.deletedAt === null,
      plannedYield: recipe.yieldQty * batches,
      needs: ids.map((id) => ({
        productId: id,
        name: byId.get(id)?.name ?? 'Bahan',
        unit: unitLabel(byId.get(id)?.unit ?? ''),
        units: wholeUnits(exact.get(id)!),
      })),
    };
  }

  private refuseUnusable(p: Awaited<ReturnType<ProductionService['prepare']>>) {
    if (p.deleted.length)
      throw codedError(
        'INGREDIENT_DELETED',
        'recipeId',
        'Ada bahan resep yang sudah dihapus dari katalog: ganti bahan itu di resep dulu',
      );
    if (!p.finishedLive || !isStocked(p.recipe.productType))
      throw codedError(
        'PRODUCT_NOT_STOCKED',
        'recipeId',
        'Produk hasil resep ini tidak memakai stok',
      );
  }

  /** Design 45 screen 1: what the batches would take and what is on hand. Read only, no lock. */
  async plan(tenantId: string, q: z.infer<typeof PlanQuery>) {
    const p = await this.prepare(this.db, tenantId, q.recipeId, q.batches);
    const onHand = await this.stock.onHand(
      tenantId,
      p.needs.map((n) => n.productId),
    );
    const ingredients = p.needs.map((n) => {
      const available = onHand[n.productId] ?? 0;
      return {
        productId: n.productId,
        name: n.name,
        unit: n.unit,
        needed: Number(n.units),
        available,
        enough: n.units <= BigInt(available),
      };
    });
    return {
      recipeId: p.recipe.id,
      product: { id: p.recipe.productId, name: p.recipe.productName },
      batches: q.batches,
      yieldQty: p.recipe.yieldQty,
      yieldUnit: p.recipe.yieldUnit,
      plannedYield: p.plannedYield,
      ingredients,
      deletedIngredientIds: p.deleted,
      canProduce:
        p.deleted.length === 0 &&
        p.finishedLive &&
        isStocked(p.recipe.productType) &&
        ingredients.every((i) => i.enough),
    };
  }

  private async byKey(db: Db | Tx, tenantId: string, key: string) {
    const [prior] = await db
      .select({ id: productionRuns.id, hash: productionRuns.requestHash })
      .from(productionRuns)
      .where(
        and(
          eq(productionRuns.tenantId, tenantId),
          eq(productionRuns.idempotencyKey, key),
        ),
      );
    return prior ?? null;
  }

  async create(s: PosSession, key: string, input: ProductionRunInput) {
    const hash = requestHash(input);
    const replay = (prior: { id: string; hash: string }) => {
      if (prior.hash !== hash) throw fieldError('idempotencyKey', KEY_REUSED);
      return prior.id;
    };
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        // A retry (double tap, lost answer) finds the first run and moves no stock.
        const prior = await this.byKey(tx, s.tenantId, key);
        if (prior) return replay(prior);
        const p = await this.prepare(
          tx,
          s.tenantId,
          input.recipeId,
          input.batches,
        );
        this.refuseUnusable(p);

        // Every ingredient's batches locked (FOR UPDATE, product-id order) and counted before anything is drawn:
        // one shortage refuses the whole run, with every short ingredient named, and nothing is written.
        const short: Need[] = [];
        for (const n of p.needs) {
          const available = await this.stock.lockedOnHand(
            tx,
            s.tenantId,
            n.productId,
          );
          if (n.units > BigInt(available))
            short.push({
              productId: n.productId,
              name: n.name,
              unit: n.unit,
              needed: n.units > MAX_STOCK_QTY ? MAX_STOCK_QTY : Number(n.units),
              available,
            });
        }
        if (short.length) throw insufficient(short);

        const runId = randomUUID();
        const lines: {
          ingredientId: string;
          quantity: number;
          cost: number;
        }[] = [];
        for (const n of p.needs) {
          const { costTotal } = await this.stock.drawForProduction(tx, {
            tenantId: s.tenantId,
            productId: n.productId,
            qty: Number(n.units),
            refId: runId,
            actorId: s.actorId,
          });
          lines.push({
            ingredientId: n.productId,
            quantity: Number(n.units),
            cost: costTotal,
          });
        }
        const ingredientCost = lines.reduce((sum, l) => sum + l.cost, 0);
        const unitCost = costPerPortion(ingredientCost, input.actualYield);
        const batch = await this.stock.receive(tx, {
          tenantId: s.tenantId,
          productId: p.recipe.productId,
          qty: input.actualYield,
          unitCost,
          source: 'production',
          sourceId: runId,
          actorId: s.actorId,
        });
        // Claims the key: a concurrent duplicate fails here and rolls its draws back.
        await tx.insert(productionRuns).values({
          id: runId,
          tenantId: s.tenantId,
          recipeId: p.recipe.id,
          productId: p.recipe.productId,
          batches: input.batches,
          plannedYield: p.plannedYield,
          actualYield: input.actualYield,
          yieldUnit: p.recipe.yieldUnit,
          ingredientCost,
          costPerPortion: unitCost,
          batchId: batch.id,
          note: input.note || null,
          actorId: s.actorId,
          actorKind: s.kind,
          idempotencyKey: key,
          requestHash: hash,
        });
        if (lines.length)
          await tx
            .insert(productionRunLines)
            .values(lines.map((l) => ({ ...l, tenantId: s.tenantId, runId })));
        await recordAudit(tx, s, 'production_run', {
          target: {
            type: 'production_run',
            id: runId,
            label: p.recipe.productName,
          },
          details: {
            productId: p.recipe.productId,
            batches: input.batches,
            plannedYield: p.plannedYield,
            actualYield: input.actualYield,
            ingredientCost,
            costPerPortion: unitCost,
          },
        });
        return runId;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const prior = await this.byKey(this.db, s.tenantId, key);
      if (!prior) throw e;
      id = replay(prior);
    }
    return this.get(s.tenantId, id);
  }

  private columns(tenantId: string) {
    return {
      id: productionRuns.id,
      date: sql<string>`to_char(${storeDayOf(tenantId, productionRuns.createdAt)}, 'YYYY-MM-DD')`,
      recipeId: productionRuns.recipeId,
      productId: productionRuns.productId,
      productName: products.name,
      batches: productionRuns.batches,
      plannedYield: productionRuns.plannedYield,
      actualYield: productionRuns.actualYield,
      yieldUnit: productionRuns.yieldUnit,
      ingredientCost: productionRuns.ingredientCost,
      costPerPortion: productionRuns.costPerPortion,
      batchId: productionRuns.batchId,
      note: productionRuns.note,
      actorId: productionRuns.actorId,
      actorKind: productionRuns.actorKind,
      createdAt: productionRuns.createdAt,
    };
  }

  async get(tenantId: string, id: string) {
    const [run] = await this.db
      .select(this.columns(tenantId))
      .from(productionRuns)
      .innerJoin(
        products,
        and(
          eq(products.tenantId, tenantId),
          eq(products.id, productionRuns.productId),
        ),
      )
      .where(
        and(eq(productionRuns.tenantId, tenantId), eq(productionRuns.id, id)),
      );
    if (!run) throw new NotFoundException();
    const lines = await this.db
      .select({
        ingredientId: productionRunLines.ingredientId,
        name: products.name,
        unit: products.unit,
        quantity: productionRunLines.quantity,
        cost: productionRunLines.cost,
      })
      .from(productionRunLines)
      .innerJoin(
        products,
        and(
          eq(products.tenantId, tenantId),
          eq(products.id, productionRunLines.ingredientId),
        ),
      )
      .where(
        and(
          eq(productionRunLines.tenantId, tenantId),
          eq(productionRunLines.runId, id),
        ),
      )
      .orderBy(asc(products.name), asc(productionRunLines.id));
    return {
      ...run,
      yieldDifference: run.actualYield - run.plannedYield,
      lines: lines.map((l) => ({ ...l, unit: unitLabel(l.unit) })),
    };
  }

  /** Design 45 screen 3, newest first; `from`/`to` are store days (the store's timezone) of the run. */
  async list(tenantId: string, q: z.infer<typeof RunListQuery>) {
    const day = storeDayOf(tenantId, productionRuns.createdAt);
    const where = and(
      eq(productionRuns.tenantId, tenantId),
      q.from ? gte(day, sql`${q.from}::date`) : undefined,
      q.to ? lte(day, sql`${q.to}::date`) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(this.columns(tenantId))
        .from(productionRuns)
        .innerJoin(
          products,
          and(
            eq(products.tenantId, tenantId),
            eq(products.id, productionRuns.productId),
          ),
        )
        .where(where)
        .orderBy(desc(productionRuns.createdAt), desc(productionRuns.id))
        .limit(q.perPage)
        .offset((q.page - 1) * q.perPage),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(productionRuns)
        .where(where),
    ]);
    return {
      data: rows.map((r) => ({
        ...r,
        yieldDifference: r.actualYield - r.plannedYield,
      })),
      page: q.page,
      perPage: q.perPage,
      total,
    };
  }
}

/** 422 `INSUFFICIENT_STOCK` on `batches` (the screen's "Ubah jumlah"), naming every short ingredient. */
function insufficient(short: Need[]) {
  const what = short
    .map((n) =>
      short.length === 1
        ? `${n.name} hanya ada ${n.available} ${n.unit}, produksi butuh ${n.needed} ${n.unit}`
        : `${n.name} (ada ${n.available} ${n.unit}, butuh ${n.needed} ${n.unit})`,
    )
    .join('; ');
  const message = `Bahan tidak cukup: ${what}`;
  return new HttpException(
    {
      message,
      errors: { batches: message },
      code: 'INSUFFICIENT_STOCK',
      shortages: short,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
