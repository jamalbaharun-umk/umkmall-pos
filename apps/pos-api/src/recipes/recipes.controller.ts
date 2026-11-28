import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { parseBody, parseId } from '../staff/http';
import { hasPermission, RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  ManualCostInput,
  RecipeCreate,
  RecipesService,
  RecipeUpdate,
} from './recipes.service';

const BreakdownQuery = z
  .object({ productIds: z.array(z.string().uuid()).min(1).max(100) })
  .strict();

// UMK-2125 recipes R1. Every route shows or changes costs: `catalog.manage` (owners hold every permission).
// UMK-2127: the agent reaches only POST /recipes (create_recipe), GET /recipes/:id (its checks) and
// GET /recipes/breakdown (hpp_product_data); it never edits, deletes or applies a cost.
@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @RequirePermission('catalog.manage')
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.recipes.list(s.tenantId) };
  }

  /** Recipes of the given products, for UMKMall's HPP data: `reports.view` (a read-only agent) or `catalog.manage`. */
  @AgentRoute()
  @Get('breakdown')
  async breakdown(@CurrentSession() s: PosSession, @Query() query: unknown) {
    if (
      !hasPermission(s, 'reports.view') &&
      !hasPermission(s, 'catalog.manage')
    )
      throw new ForbiddenException();
    const raw = (query as { productIds?: unknown } | null)?.productIds;
    const { productIds } = parseBody(BreakdownQuery, {
      productIds: (typeof raw === 'string' ? raw.split(',') : []).filter(
        Boolean,
      ),
    });
    return { data: await this.recipes.breakdowns(s.tenantId, productIds) };
  }

  @AgentRoute()
  @Get(':id')
  @RequirePermission('catalog.manage')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.recipes.get(s.tenantId, parseId(id));
  }

  @AgentRoute()
  @Post()
  @RequirePermission('catalog.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.recipes.create(s.tenantId, parseBody(RecipeCreate, body));
  }

  @Patch(':id')
  @RequirePermission('catalog.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const recipeId = parseId(id);
    return this.recipes.update(
      s.tenantId,
      recipeId,
      parseBody(RecipeUpdate, body),
    );
  }

  @Delete(':id')
  @RequirePermission('catalog.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.recipes.remove(s.tenantId, parseId(id));
  }

  /** "Pakai sebagai harga modal": the cost per portion becomes the product's cost_price. */
  @Post(':id/apply-cost')
  @RequirePermission('catalog.manage')
  @HttpCode(200)
  applyCost(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.recipes.applyCost(s.tenantId, parseId(id));
  }
}

/** Manual cost of an ingredient never bought (the latest purchase cost wins once there is one). */
@Controller('ingredient-costs')
export class IngredientCostsController {
  constructor(private readonly recipes: RecipesService) {}

  @Put(':productId')
  @RequirePermission('catalog.manage')
  set(
    @CurrentSession() s: PosSession,
    @Param('productId') productId: string,
    @Body() body: unknown,
  ) {
    const id = parseId(productId);
    return this.recipes.setManualCost(
      s.tenantId,
      id,
      parseBody(ManualCostInput, body),
    );
  }

  @Delete(':productId')
  @RequirePermission('catalog.manage')
  @HttpCode(204)
  async remove(
    @CurrentSession() s: PosSession,
    @Param('productId') productId: string,
  ) {
    await this.recipes.removeManualCost(s.tenantId, parseId(productId));
  }
}

@Module({
  controllers: [RecipesController, IngredientCostsController],
  providers: [RecipesService],
})
export class RecipesModule {}
