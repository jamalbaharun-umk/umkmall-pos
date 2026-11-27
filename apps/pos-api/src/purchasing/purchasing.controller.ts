import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { IdempotencyKey } from '../sales/sales.schemas';
import { ShiftsModule } from '../shifts/shifts.module';
import { StockModule } from '../stock/stock.module';
import { parseId } from '../staff/http';
import { hasPermission, RequirePermission } from '../staff/require-permission';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import {
  PaymentInput,
  PurchasePaymentsService,
  RefundInput,
  ReturnInput,
  VoidInput,
} from './purchase-payments.service';
import {
  OrderCreate,
  OrderUpdate,
  PurchasingService,
} from './purchasing.service';

/** Purchase costs are for `purchasing.manage` or `reports.view` (like sale cost); others see the rest. */
const seesCost = (s: PosSession) =>
  hasPermission(s, 'purchasing.manage') || hasPermission(s, 'reports.view');

/** The money of a purchase (UMK-1970) is cost too: hidden with the total, the status and due date stay. */
const MONEY = [
  'total',
  'paid',
  'returned',
  'remaining',
  'credit',
  'refunded',
  'refundDue',
] as const;
const withoutMoney = <T extends object>(r: T) =>
  ({
    ...r,
    ...Object.fromEntries(MONEY.map((k) => [k, undefined])),
  }) as T;

const keyOf = (key: unknown) =>
  validate(z.object({ idempotencyKey: IdempotencyKey }), {
    idempotencyKey: key,
  }).idempotencyKey;

@Controller('purchasing/orders')
export class PurchasingController {
  constructor(
    private readonly orders: PurchasingService,
    private readonly payments: PurchasePaymentsService,
  ) {}

  /** The list, plus the store's debt to its suppliers (`summary`, for cost viewers only). */
  @Get()
  async list(@CurrentSession() s: PosSession) {
    const rows = await this.orders.list(s.tenantId);
    if (!seesCost(s)) return { data: rows.map(withoutMoney) };
    return { data: rows, summary: await this.orders.summary(s.tenantId) };
  }

  @Post()
  @RequirePermission('purchasing.manage')
  create(@CurrentSession() s: PosSession, @Body() body: unknown) {
    return this.orders.create(
      s.tenantId,
      s.actorId,
      validate(OrderCreate, body),
    );
  }

  /**
   * UMK-2070: goods received in one step (written and approved in one transaction), once per Idempotency-Key. The
   * one purchase route UMKMall's agent reaches: it can neither approve nor edit any other purchase.
   */
  @AgentRoute()
  @Post('stock-in')
  @RequirePermission('purchasing.manage')
  stockIn(
    @CurrentSession() s: PosSession,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    return this.orders.stockIn(
      s.tenantId,
      s.actorId,
      keyOf(key),
      validate(OrderCreate, body),
    );
  }

  @Get(':id')
  async get(@CurrentSession() s: PosSession, @Param('id') id: string) {
    const order = await this.orders.get(s.tenantId, parseId(id));
    if (seesCost(s)) return order;
    return {
      ...withoutMoney(order),
      lines: order.lines.map((l) => ({ ...l, unitCost: undefined })),
      payments: undefined,
      returns: undefined,
      refunds: undefined,
    };
  }

  /** "Bayar pemasok" (UMK-1970): at most the debt, from the drawer or outside it; `Idempotency-Key` required. */
  @Post(':id/payments')
  @RequirePermission('purchasing.manage')
  pay(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const orderId = parseId(id);
    return this.payments.pay(
      s,
      orderId,
      keyOf(key),
      validate(PaymentInput, body),
    );
  }

  /** The correction of a payment: voided with a reason, never edited or deleted. */
  @Post(':id/payments/:paymentId/void')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  voidPayment(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
  ) {
    const orderId = parseId(id);
    const payment = parseId(paymentId);
    return this.payments.voidPayment(
      s,
      orderId,
      payment,
      validate(VoidInput, body).reason,
    );
  }

  /** "Retur barang": lines and quantities back to the supplier, out of their stock batches; `Idempotency-Key`. */
  @Post(':id/returns')
  @RequirePermission('purchasing.manage')
  createReturn(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const orderId = parseId(id);
    return this.payments.createReturn(
      s,
      orderId,
      keyOf(key),
      validate(ReturnInput, body),
    );
  }

  /** Undo a return (UMK-1970 addition): the goods back into their batches, the debt back up; a reason is required. */
  @Post(':id/returns/:returnId/reverse')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  reverseReturn(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Param('returnId') returnId: string,
    @Body() body: unknown,
  ) {
    const orderId = parseId(id);
    const ret = parseId(returnId);
    return this.payments.reverseReturn(
      s,
      orderId,
      ret,
      validate(VoidInput, body).reason,
    );
  }

  /** "Terima uang retur": money the supplier hands back, into the drawer or the store cash; `Idempotency-Key`. */
  @Post(':id/refunds')
  @RequirePermission('purchasing.manage')
  refund(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const orderId = parseId(id);
    return this.payments.refund(
      s,
      orderId,
      keyOf(key),
      validate(RefundInput, body),
    );
  }

  /** The correction of a refund: voided with a reason, never edited or deleted. */
  @Post(':id/refunds/:refundId/void')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  voidRefund(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Param('refundId') refundId: string,
    @Body() body: unknown,
  ) {
    const orderId = parseId(id);
    const refund = parseId(refundId);
    return this.payments.voidRefund(
      s,
      orderId,
      refund,
      validate(VoidInput, body).reason,
    );
  }

  @Patch(':id')
  @RequirePermission('purchasing.manage')
  update(
    @CurrentSession() s: PosSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.orders.update(
      s.tenantId,
      parseId(id),
      validate(OrderUpdate, body),
    );
  }

  @Delete(':id')
  @RequirePermission('purchasing.manage')
  @HttpCode(204)
  async remove(@CurrentSession() s: PosSession, @Param('id') id: string) {
    await this.orders.remove(s.tenantId, parseId(id));
  }

  @Post(':id/approve')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  approve(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.orders.approve(s.tenantId, s.actorId, parseId(id));
  }

  @Post(':id/cancel')
  @RequirePermission('purchasing.manage')
  @HttpCode(200)
  cancel(@CurrentSession() s: PosSession, @Param('id') id: string) {
    return this.orders.cancel(s.tenantId, parseId(id));
  }
}

@Module({
  imports: [StockModule, ShiftsModule],
  controllers: [PurchasingController],
  providers: [PurchasingService, PurchasePaymentsService],
})
export class PurchasingModule {}
