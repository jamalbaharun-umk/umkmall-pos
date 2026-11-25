import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Module,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { validate } from '../common/validation';
import { IdempotencyKey } from '../sales/sales.schemas';
import { assertPersonAtTill } from '../shifts/cash-ledger';
import { parseId } from '../staff/http';
import { RequirePermission } from '../staff/require-permission';
import { StockModule } from '../stock/stock.module';
import { CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { VoidPins } from './void-pin';
import { ManualRefundInput, SetPinInput, VoidInput } from './void.schemas';
import { VoidService } from './void.service';

/** A locked approver answers 429 with `retryAfter` in the body; mirror it in the Retry-After header. */
async function withRetryAfter<T>(res: Response, run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HttpException && e.getStatus() === 429) {
      const { retryAfter } = e.getResponse() as { retryAfter?: number };
      if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
    }
    throw e;
  }
}

@Controller('sales')
export class SaleVoidController {
  constructor(private readonly voids: VoidService) {}

  /**
   * Started by whoever is at the till (`sales.create`); approved by `approverId`, who must hold
   * `sales.void` and whose PIN is in the body. The session stays the starter's.
   */
  @Post(':id/void')
  @RequirePermission('sales.create')
  void(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const saleId = parseId(id);
    const { idempotencyKey } = validate(
      z.object({ idempotencyKey: IdempotencyKey }),
      { idempotencyKey: key },
    );
    const input = validate(VoidInput, body);
    return withRetryAfter(res, () =>
      this.voids.void(s, saleId, idempotencyKey, input),
    );
  }

  @Get(':id/void')
  get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.voids.ofSale(s, parseId(id));
  }

  /**
   * UMK-1991: the void of a sale paid through a payment gateway. The same body, starter and PIN approver
   * as a void; the gateway returns the money, so the answer carries `refundStatus`.
   */
  @Post(':id/refund')
  @RequirePermission('sales.create')
  refund(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertPersonAtTill(s.kind);
    const saleId = parseId(id);
    const { idempotencyKey } = validate(
      z.object({ idempotencyKey: IdempotencyKey }),
      { idempotencyKey: key },
    );
    const input = validate(VoidInput, body);
    return withRetryAfter(res, () =>
      this.voids.void(s, saleId, idempotencyKey, input, 'refund'),
    );
  }

  /** Asks a refund the gateway refused again. By someone who could have approved it. */
  @Post(':id/refund/retry')
  @HttpCode(200)
  @RequirePermission('sales.void')
  retryRefund(@CurrentSession() s: PosSession, @Param('id') id: string) {
    assertPersonAtTill(s.kind);
    return this.voids.retryRefund(s, parseId(id));
  }

  /** The store returned the money of a refused refund by hand; the note says how. */
  @Post(':id/refund/manual')
  @HttpCode(200)
  @RequirePermission('sales.void')
  manualRefund(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    assertPersonAtTill(s.kind);
    const saleId = parseId(id);
    return this.voids.markRefundManual(
      s,
      saleId,
      validate(ManualRefundInput, body).note,
    );
  }
}

@Controller('void-pin')
export class VoidPinController {
  constructor(private readonly pins: VoidPins) {}

  /** The approver picker of the void dialog: who can approve, who has a PIN, who is locked. */
  @Get('approvers')
  @RequirePermission('sales.create')
  approvers(@CurrentSession() s: PosSession) {
    return this.pins.approvers(s.tenantId);
  }

  @Get()
  @RequirePermission('sales.void')
  status(@CurrentSession() s: PosSession) {
    return this.pins.status(s);
  }

  /** Set or change the actor's own PIN. */
  @Put()
  @RequirePermission('sales.void')
  set(
    @CurrentSession() s: PosSession,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = validate(SetPinInput, body);
    return withRetryAfter(res, () =>
      this.pins.set(s, input.pin, input.currentPin),
    );
  }

  /** Owner only. */
  @Post(':actorId/unlock')
  @HttpCode(200)
  unlock(@CurrentSession() s: PosSession, @Param('actorId') actorId: string) {
    return this.pins.unlock(s, parseId(actorId));
  }

  /** Owner only: remove a forgotten PIN. */
  @Delete(':actorId')
  reset(@CurrentSession() s: PosSession, @Param('actorId') actorId: string) {
    return this.pins.reset(s, parseId(actorId));
  }
}

@Module({
  imports: [StockModule],
  controllers: [SaleVoidController, VoidPinController],
  providers: [VoidService, VoidPins],
})
export class VoidModule {}
