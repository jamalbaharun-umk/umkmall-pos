import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  AgentQuoteInput,
  AgentSaleInput,
  DiscountApprovalInput,
  IdempotencyKey,
  PaidSinceQuery,
  QuoteInput,
  SaleInput,
  SalesQuery,
  SettingsInput,
} from './sales.schemas';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @AgentRoute()
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
      // UMKMall's agent never sets a price or a discount (AgentSaleInput).
      s.kind === 'agent'
        ? validate(AgentSaleInput, body)
        : validate(SaleInput, body),
    );
  }

  /** UMK-1985: the server's price of a cart (unit and wholesale tier), nothing written. */
  @AgentRoute()
  @Post('quote')
  @HttpCode(200)
  @RequirePermission('sales.create')
  quote(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.sales.quote(
      s,
      s.kind === 'agent'
        ? validate(AgentQuoteInput, body)
        : validate(QuoteInput, body),
    );
  }

  /** UMK-1990: who may approve a line discount above 30% by their PIN. */
  @Get('discount-approvers')
  @RequirePermission('sales.price_override')
  discountApprovers(@CurrentSession() s: PosSession) {
    return this.sales.discountApprovers(s);
  }

  /** UMK-1990: a PIN approval of a line discount above 30%, named by the sale's line. */
  @Post('discount-approvals')
  @RequirePermission('sales.price_override')
  approveDiscount(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.sales.approveDiscount(s, validate(DiscountApprovalInput, body));
  }

  @Get()
  list(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.sales.list(s, validate(SalesQuery, query));
  }

  /**
   * UMK-2046: the sales that waited for a payment gateway and were completed after `since`, for a till that
   * was off or away. The actor's own, or the store's with `reports.view` (as `GET /sales`).
   */
  @Get('paid-since')
  paidSince(@CurrentSession() s: PosSession, @Query() query: unknown) {
    return this.sales.paidSince(s, validate(PaidSinceQuery, query));
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
