import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { SalePayments } from './sale-payment.service';

/** Cash tendered for a sale that waited for a PG payment. Integer rupiah; the server computes the change. */
const CashInput = z
  .object({ paid: z.number().int().nonnegative().max(1_000_000_000_000) })
  .strict();

/**
 * The payment of one sale, for the cashier's waiting screen (UMK-1991). The tenant is the session's; the
 * sale is the actor's own, or any of the store's with `reports.view`; anything else answers 404.
 */
@Controller('sales/:id/payment')
export class SalePaymentController {
  constructor(private readonly payments: SalePayments) {}

  /** The poll: payment-api's stored status. Completes or cancels the sale when the payment has settled. */
  @Get()
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.payments.status(s, parseId(id), 'read');
  }

  /** "Cek status pembayaran": payment-api asks the PG first (a lost webhook is found here). */
  @Post('check')
  @HttpCode(200)
  @RequirePermission('sales.create')
  check(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.payments.status(s, parseId(id), 'sync');
  }

  /** The customer pays cash instead: the PG bill is closed and the sale is paid as cash. */
  @Post('cash')
  @HttpCode(200)
  @RequirePermission('sales.create')
  cash(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const saleId = parseId(id);
    return this.payments.payCash(s, saleId, validate(CashInput, body).paid);
  }

  /** Gives the sale up before it is paid. No PIN: it is not a void. */
  @Post('cancel')
  @HttpCode(200)
  @RequirePermission('sales.create')
  cancel(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.payments.cancel(s, parseId(id));
  }
}
