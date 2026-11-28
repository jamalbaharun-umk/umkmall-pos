import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { parseBody, parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  ManualCostInput,
  RecipeCreate,
  RecipesService,
  RecipeUpdate,
} from './recipes.service';

// UMK-2125 recipes R1. Every route shows or changes costs: `catalog.manage` (owners hold every permission).
// Not an agent route: the agent's create_recipe is a later unit.
@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @RequirePermission('catalog.manage')
  async list(@CurrentSession() s: PosSession) {
    return { data: await this.recipes.list(s.tenantId) };
  }

  @Get(':id')
  @RequirePermission('catalog.manage')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.recipes.get(s.tenantId, parseId(id));
  }

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
