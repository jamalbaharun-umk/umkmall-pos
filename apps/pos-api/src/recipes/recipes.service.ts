import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fieldError } from '../common/validation';
import { type Db, InjectDb } from '../db/db.module';
import {
  ingredientCosts,
  products,
  recipeLines,
  recipes,
  stockBatches,
} from '../db/schema';
import { isUniqueViolation } from '../staff/http';
import {
  checkRecipeGraph,
  ceilFrac,
  type CostRecipe,
  MAX_RECIPE_DEPTH,
  MAX_WASTE_PERCENT,
  recipeCoster,
  type UnitCost,
} from './cost';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const Rupiah = z
  .number({ invalid_type_error: 'Harus berupa angka' })
  .int('Harus bilangan bulat rupiah')
  .min(0, 'Tidak boleh negatif')
  .max(1_000_000_000_000, 'Terlalu besar');

const Line = z
  .object({
    ingredientId: z.string().uuid().optional(),
    subRecipeId: z.string().uuid().optional(),
    // Base units of the ingredient (gram, ml, pcs), or portions of the sub-recipe's yield.
    quantity: z
      .number({ required_error: 'Takaran wajib diisi' })
      .int('Takaran harus bilangan bulat')
      .positive('Takaran harus lebih dari 0')
      .max(10_000_000, 'Takaran maksimal 10.000.000'),
    wastePercent: z
      .number()
      .int('Susut harus bilangan bulat')
      .min(0, 'Susut tidak boleh negatif')
      .max(MAX_WASTE_PERCENT, `Susut maksimal ${MAX_WASTE_PERCENT}%`)
      .default(0),
  })
  .strict()
  .refine((l) => Number(!!l.ingredientId) + Number(!!l.subRecipeId) === 1, {
    message: 'Pilih satu bahan atau satu sub-resep',
    path: ['ingredientId'],
  });

const fields = {
  yieldQty: z
    .number({ required_error: 'Hasil per adonan wajib diisi' })
    .int('Hasil harus bilangan bulat')
    .positive('Hasil harus lebih dari 0')
    .max(1_000_000, 'Hasil maksimal 1.000.000'),
  yieldUnit: z.string().trim().min(1).max(20).optional(),
  laborCost: Rupiah.optional(),
  note: z.string().trim().max(500).nullable().optional(),
  lines: z.array(Line).min(1, 'Isi minimal satu bahan').max(100),
};

export const RecipeCreate = z
  .object({ productId: z.string().uuid('Pilih produk'), ...fields })
  .strict();
export const RecipeUpdate = z.object(fields).partial().strict();
export const ManualCostInput = z
  .object({
    cost: Rupiah,
    // The pack the cost is for, in base units (Rp17.000 for 1.000 ml); 1 = per base unit.
    perQty: z
      .number()
      .int('Isi kemasan harus bilangan bulat')
      .positive('Isi kemasan harus lebih dari 0')
      .max(10_000_000, 'Isi kemasan maksimal 10.000.000')
      .default(1),
  })
  .strict();

type LineInput = z.infer<typeof Line>;

const pgCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
};

@Injectable()
export class RecipesService {
  constructor(@InjectDb() private readonly db: Db) {}

  // ---------- reads ----------

  /** The store's whole recipe graph and the unit cost of every ingredient it names. */
  private async load(db: Db | Tx, tenantId: string) {
    const [rows, lines] = await Promise.all([
      db
        .select({
          id: recipes.id,
          productId: recipes.productId,
          yieldQty: recipes.yieldQty,
          yieldUnit: recipes.yieldUnit,
          laborCost: recipes.laborCost,
          note: recipes.note,
          createdAt: recipes.createdAt,
          updatedAt: recipes.updatedAt,
          productName: products.name,
          productType: products.type,
          productUnit: products.unit,
          costPrice: products.costPrice,
          sellingPrice: products.sellingPrice,
        })
        .from(recipes)
        .innerJoin(products, eq(products.id, recipes.productId))
        .where(eq(recipes.tenantId, tenantId))
        .orderBy(asc(products.name), asc(recipes.id)),
      db
        .select({
          id: recipeLines.id,
          recipeId: recipeLines.recipeId,
          ingredientId: recipeLines.ingredientId,
          subRecipeId: recipeLines.subRecipeId,
          quantity: recipeLines.quantity,
          wastePercent: recipeLines.wastePercent,
        })
        .from(recipeLines)
        .where(eq(recipeLines.tenantId, tenantId))
        .orderBy(asc(recipeLines.recipeId), asc(recipeLines.position)),
    ]);
    const ingredientIds = [
      ...new Set(
        lines.flatMap((l) => (l.ingredientId ? [l.ingredientId] : [])),
      ),
    ];
    const costs = await this.unitCosts(db, tenantId, ingredientIds);
    const graph = new Map<string, CostRecipe>(
      rows.map((r) => [
        r.id,
        { id: r.id, yieldQty: r.yieldQty, laborCost: r.laborCost, lines: [] },
      ]),
    );
    for (const l of lines) graph.get(l.recipeId)?.lines.push(l);
    return { rows, lines, costs, graph, coster: recipeCoster(graph, costs) };
  }

  /** Latest purchase cost per base unit; else the manual cost; else none (the line is "missing cost"). */
  private async unitCosts(db: Db | Tx, tenantId: string, ids: string[]) {
    const out = new Map<string, UnitCost>();
    if (!ids.length) return out;
    const [bought, manual] = await Promise.all([
      db
        .selectDistinctOn([stockBatches.productId], {
          productId: stockBatches.productId,
          unitCost: stockBatches.unitCost,
        })
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.tenantId, tenantId),
            eq(stockBatches.source, 'purchase'),
            inArray(stockBatches.productId, ids),
          ),
        )
        .orderBy(
          asc(stockBatches.productId),
          sql`${stockBatches.receivedAt} desc`,
          sql`${stockBatches.createdAt} desc`,
        ),
      db
        .select({
          productId: ingredientCosts.productId,
          cost: ingredientCosts.cost,
          perQty: ingredientCosts.perQty,
        })
        .from(ingredientCosts)
        .where(
          and(
            eq(ingredientCosts.tenantId, tenantId),
            inArray(ingredientCosts.productId, ids),
          ),
        ),
    ]);
    for (const m of manual)
      out.set(m.productId, { amount: m.cost, per: m.perQty, source: 'manual' });
    for (const b of bought)
      out.set(b.productId, { amount: b.unitCost, per: 1, source: 'purchase' });
    return out;
  }

  async list(tenantId: string) {
    const { rows, coster } = await this.load(this.db, tenantId);
    return rows.map((r) => {
      const s = coster.summary(r.id);
      return {
        id: r.id,
        product: {
          id: r.productId,
          name: r.productName,
          type: r.productType,
        },
        yieldQty: r.yieldQty,
        yieldUnit: r.yieldUnit,
        costPerPortion: s.costPerPortion,
        fullCostPerPortion: s.fullCostPerPortion,
        missingCost: s.missingCostIngredientIds.length > 0,
      };
    });
  }

  async get(tenantId: string, id: string, db: Db | Tx = this.db) {
    const { rows, lines, costs, coster } = await this.load(db, tenantId);
    const r = rows.find((x) => x.id === id);
    if (!r) throw new NotFoundException();
    const own = lines.filter((l) => l.recipeId === id);
    const ingredientIds = own.flatMap((l) =>
      l.ingredientId ? [l.ingredientId] : [],
    );
    const names = new Map(
      ingredientIds.length
        ? (
            await db
              .select({
                id: products.id,
                name: products.name,
                unit: products.unit,
              })
              .from(products)
              .where(
                and(
                  eq(products.tenantId, tenantId),
                  inArray(products.id, ingredientIds),
                ),
              )
          ).map((p) => [p.id, p])
        : [],
    );
    const byId = new Map(rows.map((x) => [x.id, x]));
    const s = coster.summary(id);
    return {
      id: r.id,
      product: {
        id: r.productId,
        name: r.productName,
        type: r.productType,
        unit: r.productUnit,
        costPrice: r.costPrice,
        sellingPrice: r.sellingPrice,
      },
      yieldQty: r.yieldQty,
      yieldUnit: r.yieldUnit,
      laborCost: r.laborCost,
      note: r.note,
      lines: own.map((l, i) => {
        const sub = l.subRecipeId ? byId.get(l.subRecipeId) : undefined;
        const ingredient = l.ingredientId
          ? names.get(l.ingredientId)
          : undefined;
        const unitCost = l.ingredientId ? costs.get(l.ingredientId) : null;
        return {
          id: l.id,
          kind: l.ingredientId ? 'ingredient' : 'sub_recipe',
          ingredientId: l.ingredientId,
          subRecipeId: l.subRecipeId,
          name: ingredient?.name ?? sub?.productName ?? null,
          quantity: l.quantity,
          unit: ingredient?.unit ?? sub?.yieldUnit ?? null,
          wastePercent: l.wastePercent,
          // Rupiah per `per` base units, as the store gave it; null for a sub-recipe or a missing cost.
          unitCost: unitCost
            ? {
                amount: unitCost.amount,
                per: unitCost.per,
                source: unitCost.source,
              }
            : null,
          // This line's share of one batch, rounded up for display only (the totals round once).
          cost: ceilFrac(s.lines[i].cost),
          missingCost: s.lines[i].missing.length > 0,
        };
      }),
      batchCost: s.batchCost,
      costPerPortion: s.costPerPortion,
      // Read-only "HPP lengkap": cost per portion plus labour per batch ÷ yield. Fixed costs (expenses) are not
      // allocated to products anywhere in the POS, so none are added; cost_price stays variable cost (cogs).
      fullCostPerPortion: s.fullCostPerPortion,
      fixedCostsIncluded: false,
      missingCostIngredientIds: s.missingCostIngredientIds,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  // ---------- writes ----------

  /** One recipe write at a time per store, so two edits cannot build a cycle together. */
  private lock(tx: Tx, tenantId: string) {
    return tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('pos.recipes'), hashtext(${tenantId}))`,
    );
  }

  /** 422 unless every line names a live ingredient or a recipe of this store, and the graph stays sound. */
  private async checkLines(
    tx: Tx,
    tenantId: string,
    recipeId: string,
    lines: LineInput[],
  ) {
    const ingredientIds = [
      ...new Set(
        lines.flatMap((l) => (l.ingredientId ? [l.ingredientId] : [])),
      ),
    ];
    const found = ingredientIds.length
      ? await tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              eq(products.tenantId, tenantId),
              inArray(products.id, ingredientIds),
              isNull(products.deletedAt),
              eq(products.type, 'ingredient'),
            ),
          )
      : [];
    const okIngredients = new Set(found.map((f) => f.id));
    const badIngredient = lines.findIndex(
      (l) => l.ingredientId && !okIngredients.has(l.ingredientId),
    );
    if (badIngredient >= 0)
      throw fieldError(
        `lines.${badIngredient}.ingredientId`,
        'Bahan tidak ditemukan (harus produk bertipe bahan baku)',
      );

    const edgeRows = await tx
      .select({ id: recipes.id, sub: recipeLines.subRecipeId })
      .from(recipes)
      .leftJoin(recipeLines, eq(recipeLines.recipeId, recipes.id))
      .where(eq(recipes.tenantId, tenantId));
    const edges = new Map<string, string[]>();
    for (const e of edgeRows) {
      if (!edges.has(e.id)) edges.set(e.id, []);
      if (e.sub) edges.get(e.id)!.push(e.sub);
    }
    const badSub = lines.findIndex(
      (l) => l.subRecipeId && !edges.has(l.subRecipeId),
    );
    if (badSub >= 0)
      throw fieldError(
        `lines.${badSub}.subRecipeId`,
        'Sub-resep tidak ditemukan',
      );
    edges.set(
      recipeId,
      lines.flatMap((l) => (l.subRecipeId ? [l.subRecipeId] : [])),
    );
    const problem = checkRecipeGraph(edges);
    if (problem === 'cycle')
      throw fieldError(
        'lines',
        'Sub-resep tidak boleh memakai resep ini sendiri (berputar)',
      );
    if (problem === 'depth')
      throw fieldError(
        'lines',
        `Sub-resep paling dalam ${MAX_RECIPE_DEPTH} tingkat`,
      );
  }

  private async writeLines(
    tx: Tx,
    tenantId: string,
    recipeId: string,
    lines: LineInput[],
  ) {
    await tx
      .delete(recipeLines)
      .where(
        and(
          eq(recipeLines.tenantId, tenantId),
          eq(recipeLines.recipeId, recipeId),
        ),
      );
    await tx.insert(recipeLines).values(
      lines.map((l, i) => ({
        tenantId,
        recipeId,
        position: i,
        ingredientId: l.ingredientId ?? null,
        subRecipeId: l.subRecipeId ?? null,
        quantity: l.quantity,
        wastePercent: l.wastePercent,
      })),
    );
  }

  async create(tenantId: string, input: z.infer<typeof RecipeCreate>) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, tenantId);
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            eq(products.id, input.productId),
            isNull(products.deletedAt),
          ),
        );
      if (!product) throw fieldError('productId', 'Produk tidak ditemukan');
      const [taken] = await tx
        .select({ id: recipes.id })
        .from(recipes)
        .where(
          and(
            eq(recipes.tenantId, tenantId),
            eq(recipes.productId, input.productId),
          ),
        );
      if (taken)
        throw fieldError('productId', 'Produk ini sudah punya resep', 409);
      const [row] = await tx
        .insert(recipes)
        .values({
          tenantId,
          productId: input.productId,
          yieldQty: input.yieldQty,
          ...(input.yieldUnit !== undefined && { yieldUnit: input.yieldUnit }),
          ...(input.laborCost !== undefined && { laborCost: input.laborCost }),
          note: input.note ?? null,
        })
        .returning({ id: recipes.id })
        .catch((e: unknown) => {
          if (isUniqueViolation(e))
            throw fieldError('productId', 'Produk ini sudah punya resep', 409);
          throw e;
        });
      await this.checkLines(tx, tenantId, row.id, input.lines);
      await this.writeLines(tx, tenantId, row.id, input.lines);
      return this.get(tenantId, row.id, tx);
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: z.infer<typeof RecipeUpdate>,
  ) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, tenantId);
      const [row] = await tx
        .update(recipes)
        .set({
          ...(input.yieldQty !== undefined && { yieldQty: input.yieldQty }),
          ...(input.yieldUnit !== undefined && { yieldUnit: input.yieldUnit }),
          ...(input.laborCost !== undefined && { laborCost: input.laborCost }),
          ...(input.note !== undefined && { note: input.note }),
          updatedAt: new Date(),
        })
        .where(and(eq(recipes.tenantId, tenantId), eq(recipes.id, id)))
        .returning({ id: recipes.id });
      if (!row) throw new NotFoundException();
      if (input.lines) {
        await this.checkLines(tx, tenantId, id, input.lines);
        await this.writeLines(tx, tenantId, id, input.lines);
      }
      return this.get(tenantId, id, tx);
    });
  }

  async remove(tenantId: string, id: string) {
    const [row] = await this.db
      .delete(recipes)
      .where(and(eq(recipes.tenantId, tenantId), eq(recipes.id, id)))
      .returning({ id: recipes.id })
      .catch((e: unknown) => {
        if (pgCode(e) === '23503')
          throw new ConflictException(
            'Resep ini dipakai sebagai sub-resep resep lain',
          );
        throw e;
      });
    if (!row) throw new NotFoundException();
  }

  /**
   * "Pakai sebagai harga modal": the cost per portion becomes the product's cost_price. The selling price is
   * never touched. Refused (422) while a line has no cost, for an ingredient (its cost comes from purchases),
   * and above the selling price (the catalog's own rule).
   */
  async applyCost(tenantId: string, id: string) {
    const r = await this.get(tenantId, id);
    if (r.product.type === 'ingredient')
      throw fieldError(
        'productId',
        'Modal bahan baku diambil dari pembelian, bukan dari resep',
      );
    if (r.missingCostIngredientIds.length)
      throw fieldError(
        'lines',
        'Ada bahan yang belum punya harga: isi pembelian atau harga manual dulu',
      );
    if (r.costPerPortion > r.product.sellingPrice)
      throw fieldError(
        'costPrice',
        'Harga modal tidak boleh melebihi harga jual',
      );
    const [row] = await this.db
      .update(products)
      .set({ costPrice: r.costPerPortion, updatedAt: new Date() })
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.id, r.product.id),
          isNull(products.deletedAt),
        ),
      )
      .returning({
        id: products.id,
        costPrice: products.costPrice,
        sellingPrice: products.sellingPrice,
      });
    if (!row) throw new NotFoundException();
    return {
      productId: row.id,
      costPrice: row.costPrice,
      sellingPrice: row.sellingPrice,
    };
  }

  // ---------- manual ingredient cost ----------

  private async ingredient(tenantId: string, productId: string) {
    const [p] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.id, productId),
          isNull(products.deletedAt),
          eq(products.type, 'ingredient'),
        ),
      );
    if (!p) throw new NotFoundException();
  }

  async setManualCost(
    tenantId: string,
    productId: string,
    input: z.infer<typeof ManualCostInput>,
  ) {
    await this.ingredient(tenantId, productId);
    const [row] = await this.db
      .insert(ingredientCosts)
      .values({ tenantId, productId, cost: input.cost, perQty: input.perQty })
      .onConflictDoUpdate({
        target: [ingredientCosts.tenantId, ingredientCosts.productId],
        set: { cost: input.cost, perQty: input.perQty, updatedAt: new Date() },
      })
      .returning({
        productId: ingredientCosts.productId,
        cost: ingredientCosts.cost,
        perQty: ingredientCosts.perQty,
      });
    return row;
  }

  async removeManualCost(tenantId: string, productId: string) {
    const [row] = await this.db
      .delete(ingredientCosts)
      .where(
        and(
          eq(ingredientCosts.tenantId, tenantId),
          eq(ingredientCosts.productId, productId),
        ),
      )
      .returning({ id: ingredientCosts.id });
    if (!row) throw new NotFoundException();
  }
}
