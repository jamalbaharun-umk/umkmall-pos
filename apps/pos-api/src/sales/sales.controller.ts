import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  IdempotencyKey,
  SaleInput,
  SalesQuery,
  SettingsInput,
} from './sales.schemas';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @RequirePermission('sales.create')
  create(
    @CurrentSession() s: PosSession,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.sales.create(
      s,
      validate(z.object({ idempotencyKey: IdempotencyKey }), {
        idempotencyKey: key,
      }).idempotencyKey,
      validate(SaleInput, body),
    );
  }

  @Get()
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.sales.list(s, validate(SalesQuery, query));
  }

  @Get('settings')
  settings(@CurrentSession() s: PosSession) {
    return this.sales.settings(s.tenantId);
  }

  @Put('settings')
  @RequirePermission('catalog.manage')
  updateSettings(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.sales.updateSettings(
      s.tenantId,
      validate(SettingsInput, body).taxBps,
    );
  }

  @Get(':id')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.sales.get(s, parseId(id));
  }

  @Get(':id/receipt')
  receipt(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.sales.receipt(s, parseId(id));
  }
}
