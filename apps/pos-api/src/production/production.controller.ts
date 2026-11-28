import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { RecipesModule } from '../recipes/recipes.controller';
import { IdempotencyKey } from '../sales/sales.schemas';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { StockModule } from '../stock/stock.module';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  PlanQuery,
  ProductionRunInput,
  ProductionService,
  RunListQuery,
} from './production.service';

// UMK-2132 recipes R2 (design 45). Stock and cost figures: `catalog.manage`, as every recipe route. Not an agent
// route: the agent never records a production run.
@Controller('production-runs')
@RequirePermission('catalog.manage')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Post()
  create(
    @CurrentSession() s: PosSession,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { idempotencyKey } = validate(
      z.object({ idempotencyKey: IdempotencyKey }),
      { idempotencyKey: key },
    );
    return this.production.create(
      s,
      idempotencyKey,
      validate(ProductionRunInput, body),
    );
  }

  @Get()
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.production.list(s.tenantId, validate(RunListQuery, query));
  }

  /** What a run would take and what is on hand (design 45 screen 1). */
  @Get('plan')
  plan(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.production.plan(s.tenantId, validate(PlanQuery, query));
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.production.get(s.tenantId, parseId(id));
  }
}

@Module({
  imports: [RecipesModule, StockModule],
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class ProductionModule {}
