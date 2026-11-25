import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdaptersModule } from '../adapters/adapters.module';
import { Public, TenantId } from '../auth/service.guard';
import { fieldError, validate } from '../common/validation';
import { Clock, PaymentSettings } from '../config';
import {
  AnyCancelBody,
  CancelBody,
  ChargeBody,
  IdempotencyKey,
  ListQuery,
  ManualRefundBody,
  ReceiptListQuery,
} from './payments.schemas';
import { PaymentsService } from './payments.service';
import { ReconciliationService } from './reconciliation.service';
import { SettlementService } from './settlement.service';
import { WebhooksService } from './webhooks.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** 201 for a new payment, 200 when the idempotency key replays the first one. */
  @Post()
  async charge(
    @TenantId() tenantId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsedKey = IdempotencyKey.safeParse(key);
    if (!parsedKey.success)
      throw fieldError('Idempotency-Key', parsedKey.error.issues[0].message);
    const { created, payment } = await this.payments.charge(
      tenantId,
      parsedKey.data,
      validate(ChargeBody, body),
    );
    res.status(created ? 201 : 200);
    return payment;
  }

  /**
   * Closes a charge key that has no payment (same key and body as the charge). 201 with the new `cancelled`
   * payment, or 200 with the payment that already has the key, unchanged.
   */
  @Post('close')
  async close(
    @TenantId() tenantId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsedKey = IdempotencyKey.safeParse(key);
    if (!parsedKey.success)
      throw fieldError('Idempotency-Key', parsedKey.error.issues[0].message);
    const { created, payment } = await this.payments.close(
      tenantId,
      parsedKey.data,
      validate(ChargeBody, body),
    );
    res.status(created ? 201 : 200);
    return payment;
  }

  @Get()
  list(@TenantId() tenantId: string, @Query() query: unknown) {
    return this.payments.list(tenantId, validate(ListQuery, query));
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.payments.get(tenantId, id);
  }

  @Post(':id/sync')
  @HttpCode(200)
  sync(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.payments.sync(tenantId, id);
  }

  /** payment-api picks: close an unpaid bill, void (CASHAC) or refund (PG). */
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.payments.cancel(tenantId, id, validate(AnyCancelBody, body));
  }

  @Post(':id/void')
  @HttpCode(200)
  void(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.payments.void(tenantId, id, validate(CancelBody, body));
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.payments.refund(tenantId, id, validate(CancelBody, body));
  }

  @Post(':id/refund/manual')
  @HttpCode(200)
  manualRefund(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.payments.markRefundedManually(
      tenantId,
      id,
      validate(ManualRefundBody, body),
    );
  }
}

@Controller('unmatched-receipts')
export class UnmatchedReceiptsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() query: unknown) {
    return this.payments.listUnmatched(
      tenantId,
      validate(ReceiptListQuery, query),
    );
  }
}

/**
 * PG → payment-api. No service key and no tenant header: the PG has neither. The adapter verifies the PG's
 * signature (401 otherwise), and the tenant is the one on our own payment row.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  receive(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.webhooks.receive(provider, {
      headers: req.headers,
      rawBody: req.rawBody ?? Buffer.alloc(0),
    });
  }
}

@Module({
  imports: [AdaptersModule],
  controllers: [
    PaymentsController,
    UnmatchedReceiptsController,
    WebhooksController,
  ],
  providers: [
    PaymentSettings,
    Clock,
    SettlementService,
    PaymentsService,
    WebhooksService,
    ReconciliationService,
  ],
  exports: [PaymentSettings, Clock],
})
export class PaymentsModule {}
