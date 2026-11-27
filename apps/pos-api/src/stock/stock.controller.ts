import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Uuid } from '../catalog/catalog.schemas';
import { LocalDate, validate } from '../common/validation';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { StockService } from './stock.service';

// Comma-separated product ids, at most one product-list page (100).
const OnHandQuery = z.object({
  ids: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(Uuid).max(100)),
});

const OpeningInput = z
  .object({
    productId: Uuid,
    qty: z.number().int().positive().max(1_000_000),
    unitCost: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
    // UMK-2087: optional best-before date; the service refuses one before today.
    expiresAt: LocalDate.optional(),
  })
  .strict();

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** On-hand per tracked product, for the product list's stock column. Untracked and foreign ids are omitted. */
  @Get('on-hand')
  onHand(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.stock.onHand(s.tenantId, validate(OnHandQuery, query).ids);
  }

  @Get('products/:id/movements')
  movements(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.stock.movements(s.tenantId, parseId(id));
  }

  @AgentRoute()
  @Get('products/:id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.stock.productStock(s.tenantId, parseId(id));
  }

  @Post('opening')
  @RequirePermission('catalog.manage')
  opening(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.stock.opening(
      s.tenantId,
      s.actorId,
      validate(OpeningInput, body),
    );
  }
}
