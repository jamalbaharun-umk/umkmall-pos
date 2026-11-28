import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, id, pos, rupiah, updatedAt } from './_base';
import { products } from './catalog';
import { tenants } from './tenants';

// UMK-2125 recipes R1: costing only. Nothing here moves stock or money; the one write outside these tables is
// `products.cost_price`, on the owner's "apply cost" request. Same-tenant references are checked by
// src/recipes/recipes.service.ts before every write.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

/** One recipe per product: a sellable product, or an ingredient made in-house (used as a sub-recipe). */
export const recipes = pos
  .table(
    'recipes',
    {
      id: id(),
      tenantId: tenantId(),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'restrict' }),
      // Portions one batch yields (1 adonan = 40 bungkus).
      yieldQty: integer('yield_qty').notNull(),
      yieldUnit: text('yield_unit').notNull().default('porsi'),
      // Labour per batch, for the read-only "HPP lengkap" only; never part of cost_price.
      laborCost: rupiah('labor_cost').notNull().default(0),
      note: text('note'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('recipes_tenant_product_uq').on(t.tenantId, t.productId),
      check('recipes_ck', sql`${t.yieldQty} > 0 and ${t.laborCost} >= 0`),
    ],
  )
  .enableRLS();

/** A line is an ingredient (quantity in its base unit) or a sub-recipe (quantity in portions of its yield). */
export const recipeLines = pos
  .table(
    'recipe_lines',
    {
      id: id(),
      tenantId: tenantId(),
      recipeId: uuid('recipe_id')
        .notNull()
        .references(() => recipes.id, { onDelete: 'cascade' }),
      position: integer('position').notNull(),
      ingredientId: uuid('ingredient_id').references(() => products.id, {
        onDelete: 'restrict',
      }),
      // A recipe used by another cannot be deleted (409) until no line names it.
      subRecipeId: uuid('sub_recipe_id').references(
        (): AnyPgColumn => recipes.id,
        { onDelete: 'restrict' },
      ),
      quantity: integer('quantity').notNull(),
      // Percent of what is bought that is lost (oil left in the pan): the line costs qty × 100 / (100 − waste).
      wastePercent: integer('waste_percent').notNull().default(0),
    },
    (t) => [
      index('recipe_lines_recipe_idx').on(t.recipeId),
      index('recipe_lines_tenant_idx').on(t.tenantId),
      index('recipe_lines_sub_recipe_idx').on(t.subRecipeId),
      index('recipe_lines_ingredient_idx').on(t.ingredientId),
      check(
        'recipe_lines_ck',
        sql`${t.quantity} > 0 and ${t.wastePercent} between 0 and 90
          and num_nonnulls(${t.ingredientId}, ${t.subRecipeId}) = 1`,
      ),
    ],
  )
  .enableRLS();

/**
 * Manual cost of an ingredient never bought: `cost` rupiah for `per_qty` base units (Rp17.000 per 1.000 ml), so a
 * price per gram may be a fraction. The latest purchase cost wins once there is one.
 */
export const ingredientCosts = pos
  .table(
    'ingredient_costs',
    {
      id: id(),
      tenantId: tenantId(),
      productId: uuid('product_id')
        .notNull()
        .references(() => products.id, { onDelete: 'cascade' }),
      cost: rupiah('cost').notNull(),
      perQty: integer('per_qty').notNull(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('ingredient_costs_tenant_product_uq').on(
        t.tenantId,
        t.productId,
      ),
      check('ingredient_costs_ck', sql`${t.cost} >= 0 and ${t.perQty} > 0`),
    ],
  )
  .enableRLS();
