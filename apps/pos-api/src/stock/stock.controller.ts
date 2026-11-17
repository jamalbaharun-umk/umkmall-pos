import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { parse, Uuid } from '../catalog/catalog.schemas';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { StockService } from './stock.service';

const OpeningInput = z
  .object({
    productId: Uuid,
    qty: z.number().int().positive().max(1_000_000),
    unitCost: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  })
  .strict();

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('products/:id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.stock.productStock(s.tenantId, parseId(id));
  }

  @Post('opening')
  @RequirePermission('catalog.manage')
  opening(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.stock.opening(s.tenantId, s.actorId, parse(OpeningInput, body));
  }
}
