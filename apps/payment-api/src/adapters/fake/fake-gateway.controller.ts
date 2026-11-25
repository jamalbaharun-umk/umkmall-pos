import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { TenantId } from '../../auth/service.guard';
import { Rupiah, validate } from '../../common/validation';
import { PaymentsModule } from '../../payments/payments.controller';
import { WebhooksService } from '../../payments/webhooks.service';
import { MerchantWebhooksService } from '../../merchants/merchant-webhooks.service';
import { AdaptersModule } from '../adapters.module';
import {
  FAKE_PROVIDER,
  FAKE_SIGNATURE_HEADER,
  FakeAccount,
  FakeBill,
  FakeGatewayRefusal,
  FakeReview,
  LocalFakeGateway,
} from './local-fake-gateway';

const Delivery = z.enum(['send', 'drop', 'duplicate']).default('send');
type Delivery = z.infer<typeof Delivery>;
const PayBody = z.object({ amount: Rupiah.optional(), webhook: Delivery });
const ActBody = z.object({ webhook: Delivery });
const WebhookBody = z.object({
  eventId: z.string().trim().min(1).max(200).optional(),
});
const reason = z.string().trim().min(1, 'Required').max(500);
const ReviewBody = z.object({ reason: reason.optional(), webhook: Delivery });
const ReviewWithReasonBody = z.object({
  reason: z.string({ required_error: 'Required' }).pipe(reason),
  webhook: Delivery,
});
const OutageBody = z.object({
  down: z.boolean({
    required_error: 'Required',
    invalid_type_error: 'Must be true or false',
  }),
});
const SettingsBody = z.object({
  refundMode: z.enum(['pending', 'succeed', 'fail'], {
    required_error: 'Required',
  }),
});

const notFound = () =>
  new NotFoundException({ message: 'Not found', code: 'not_found' });

const REFUSALS: Record<string, string> = {
  bill_closed: 'The bill is closed at the gateway; use late-pay to pay it',
  already_paid: 'A dynamic QR takes one payment only',
  bill_open: 'The bill is still open at the gateway; use pay',
  refund_not_pending: 'The refund is already settled',
  account_not_reviewable:
    'The account is not in a status that allows this review',
};

/** The gateway's own view of a sub-account. Its id stays at the gateway: no control answers it. */
const accountView = (account: FakeAccount) => ({
  status: account.status,
  reason: account.reason,
  profile: account.profile,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

const view = (bill: FakeBill) => ({
  providerRef: bill.providerRef,
  paymentId: bill.paymentId,
  orderRef: bill.orderRef,
  method: bill.method,
  amount: bill.amount,
  status: bill.status,
  expiresAt: bill.expiresAt,
  checkout: bill.checkout,
  receipts: bill.receipts,
  refunds: bill.refunds,
  createdAt: bill.createdAt,
});

/**
 * LOCAL USE ONLY. What a person does at the fake gateway: pay a bill, fail it, expire it, pay it late, settle
 * a refund. Each action changes only the gateway's own state and then notifies payment-api as a PG would.
 *
 * The notification is handed to `WebhooksService.receive`, the very call `POST /webhooks/fake` makes, so the
 * adapter's signature check, the inbox and `settle` all run. It is not sent over HTTP: nothing under `src/`
 * calls out. No action here writes a payment.
 */
@Injectable()
export class FakeGatewayControls {
  constructor(
    // Never null here: this module is mounted only when PAYMENT_ADAPTERS lists `fake`.
    @Inject(LocalFakeGateway) private readonly gateway: LocalFakeGateway,
    private readonly webhooks: WebhooksService,
    private readonly merchantWebhooks: MerchantWebhooksService,
  ) {}

  // ---- onboarding: the gateway's reviewer ---------------------------------------------------------------

  account(tenantId: string) {
    const account = this.gateway.accountOf(tenantId);
    if (!account) throw notFound();
    return accountView(account);
  }

  /** Reviews the tenant's sub-account, then notifies as a PG would, through the real account webhook path. */
  async review(
    tenantId: string,
    action: FakeReview,
    delivery: Delivery,
    why?: string,
  ) {
    const account = this.gateway.accountOf(tenantId);
    if (!account) throw notFound();
    try {
      this.gateway.review(account, action, why);
    } catch (error) {
      if (error instanceof FakeGatewayRefusal)
        throw new ConflictException({
          message: REFUSALS[error.code],
          code: error.code,
        });
      throw error;
    }
    return {
      account: accountView(account),
      webhook: await this.notifyAccount(account, delivery),
    };
  }

  /** Sends an account notification with nothing changed; with an earlier event id, the same event again. */
  async resendAccount(tenantId: string, eventId?: string) {
    const account = this.gateway.accountOf(tenantId);
    if (!account) throw notFound();
    return {
      account: accountView(account),
      webhook: await this.notifyAccount(account, 'send', eventId),
    };
  }

  outage(down: boolean) {
    this.gateway.accountsDown = down;
    return { down: this.gateway.accountsDown };
  }

  private async notifyAccount(
    account: FakeAccount,
    delivery: Delivery,
    eventId?: string,
  ) {
    const notification = this.gateway.accountNotification(account, eventId);
    const answers: { received: boolean; duplicate: boolean }[] = [];
    const times = delivery === 'drop' ? 0 : delivery === 'duplicate' ? 2 : 1;
    for (let i = 0; i < times; i++)
      answers.push(
        await this.merchantWebhooks.receive(FAKE_PROVIDER, {
          headers: { [FAKE_SIGNATURE_HEADER]: notification.signature },
          rawBody: Buffer.from(notification.body),
        }),
      );
    return {
      ...notification,
      signatureHeader: 'X-Fake-Signature',
      delivered: times > 0,
      answers,
    };
  }

  list(tenantId: string) {
    return { items: this.gateway.list(tenantId).map(view) };
  }

  onBill(
    tenantId: string,
    providerRef: string,
    delivery: Delivery,
    act: (gateway: LocalFakeGateway, bill: FakeBill) => void,
  ) {
    const bill = this.gateway.find(tenantId, providerRef);
    if (!bill) throw notFound();
    return this.actAndNotify(bill, delivery, () => act(this.gateway, bill));
  }

  onRefund(
    tenantId: string,
    refundId: string,
    delivery: Delivery,
    to: 'succeeded' | 'failed',
  ) {
    const bill = this.gateway.findRefund(tenantId, refundId);
    if (!bill) throw notFound();
    return this.actAndNotify(bill, delivery, () =>
      this.gateway.finishRefund(bill, refundId, to),
    );
  }

  /** Sends a notification for a bill with nothing changed; with an earlier event id, the same event again. */
  async resend(tenantId: string, providerRef: string, eventId?: string) {
    const bill = this.gateway.find(tenantId, providerRef);
    if (!bill) throw notFound();
    return {
      bill: view(bill),
      webhook: await this.notify(bill, 'send', eventId),
    };
  }

  private async actAndNotify(
    bill: FakeBill,
    delivery: Delivery,
    act: () => void,
  ) {
    try {
      act();
    } catch (error) {
      if (error instanceof FakeGatewayRefusal)
        throw new ConflictException({
          message: REFUSALS[error.code],
          code: error.code,
        });
      throw error;
    }
    return { bill: view(bill), webhook: await this.notify(bill, delivery) };
  }

  private async notify(bill: FakeBill, delivery: Delivery, eventId?: string) {
    const notification = this.gateway.notification(bill, eventId);
    const answers: { received: boolean; duplicate: boolean }[] = [];
    const times = delivery === 'drop' ? 0 : delivery === 'duplicate' ? 2 : 1;
    for (let i = 0; i < times; i++)
      answers.push(
        await this.webhooks.receive(FAKE_PROVIDER, {
          headers: { [FAKE_SIGNATURE_HEADER]: notification.signature },
          rawBody: Buffer.from(notification.body),
        }),
      );
    return {
      ...notification,
      signatureHeader: 'X-Fake-Signature',
      delivered: times > 0,
      answers,
    };
  }

  settings() {
    return { refundMode: this.gateway.refundMode };
  }

  configure(input: z.infer<typeof SettingsBody>) {
    this.gateway.refundMode = input.refundMode;
    return this.settings();
  }
}

/**
 * Behind the global ServiceGuard like every route of a calling service: the service key, then the tenant
 * header. A control reaches only the bills of that tenant.
 */
@Controller('dev/fake-gateway')
export class FakeGatewayController {
  constructor(private readonly controls: FakeGatewayControls) {}

  @Get('payments')
  list(@TenantId() tenantId: string) {
    return this.controls.list(tenantId);
  }

  @Post('payments/:providerRef/pay')
  @HttpCode(200)
  pay(
    @TenantId() tenantId: string,
    @Param('providerRef') providerRef: string,
    @Body() body: unknown,
  ) {
    const input = validate(PayBody, body ?? {});
    return this.controls.onBill(
      tenantId,
      providerRef,
      input.webhook,
      (gateway, bill) => gateway.pay(bill, input.amount),
    );
  }

  @Post('payments/:providerRef/late-pay')
  @HttpCode(200)
  latePay(
    @TenantId() tenantId: string,
    @Param('providerRef') providerRef: string,
    @Body() body: unknown,
  ) {
    const input = validate(PayBody, body ?? {});
    return this.controls.onBill(
      tenantId,
      providerRef,
      input.webhook,
      (gateway, bill) => gateway.latePay(bill, input.amount),
    );
  }

  @Post('payments/:providerRef/fail')
  @HttpCode(200)
  fail(
    @TenantId() tenantId: string,
    @Param('providerRef') providerRef: string,
    @Body() body: unknown,
  ) {
    const input = validate(ActBody, body ?? {});
    return this.controls.onBill(
      tenantId,
      providerRef,
      input.webhook,
      (gateway, bill) => gateway.close(bill, 'failed'),
    );
  }

  @Post('payments/:providerRef/expire')
  @HttpCode(200)
  expire(
    @TenantId() tenantId: string,
    @Param('providerRef') providerRef: string,
    @Body() body: unknown,
  ) {
    const input = validate(ActBody, body ?? {});
    return this.controls.onBill(
      tenantId,
      providerRef,
      input.webhook,
      (gateway, bill) => gateway.close(bill, 'expired'),
    );
  }

  @Post('payments/:providerRef/webhook')
  @HttpCode(200)
  webhook(
    @TenantId() tenantId: string,
    @Param('providerRef') providerRef: string,
    @Body() body: unknown,
  ) {
    const input = validate(WebhookBody, body ?? {});
    return this.controls.resend(tenantId, providerRef, input.eventId);
  }

  @Post('refunds/:id/succeed')
  @HttpCode(200)
  succeedRefund(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = validate(ActBody, body ?? {});
    return this.controls.onRefund(tenantId, id, input.webhook, 'succeeded');
  }

  @Post('refunds/:id/fail')
  @HttpCode(200)
  failRefund(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = validate(ActBody, body ?? {});
    return this.controls.onRefund(tenantId, id, input.webhook, 'failed');
  }

  // ---- onboarding: the sub-account of the header's tenant ------------------------------------------------

  @Get('account')
  account(@TenantId() tenantId: string) {
    return this.controls.account(tenantId);
  }

  @Post('account/approve')
  @HttpCode(200)
  approve(@TenantId() tenantId: string, @Body() body: unknown) {
    const input = validate(ReviewBody, body ?? {});
    return this.controls.review(tenantId, 'approve', input.webhook);
  }

  @Post('account/needs-fix')
  @HttpCode(200)
  needsFix(@TenantId() tenantId: string, @Body() body: unknown) {
    const input = validate(ReviewWithReasonBody, body ?? {});
    return this.controls.review(
      tenantId,
      'needs_fix',
      input.webhook,
      input.reason,
    );
  }

  @Post('account/reject')
  @HttpCode(200)
  reject(@TenantId() tenantId: string, @Body() body: unknown) {
    const input = validate(ReviewWithReasonBody, body ?? {});
    return this.controls.review(
      tenantId,
      'reject',
      input.webhook,
      input.reason,
    );
  }

  @Post('account/suspend')
  @HttpCode(200)
  suspend(@TenantId() tenantId: string, @Body() body: unknown) {
    const input = validate(ReviewWithReasonBody, body ?? {});
    return this.controls.review(
      tenantId,
      'suspend',
      input.webhook,
      input.reason,
    );
  }

  @Post('account/webhook')
  @HttpCode(200)
  accountWebhook(@TenantId() tenantId: string, @Body() body: unknown) {
    const input = validate(WebhookBody, body ?? {});
    return this.controls.resendAccount(tenantId, input.eventId);
  }

  // The gateway's, not a tenant's: while down, every onboarding call to the gateway fails.
  @Post('accounts/outage')
  @HttpCode(200)
  outage(@Body() body: unknown) {
    return this.controls.outage(validate(OutageBody, body ?? {}).down);
  }

  // The settings are the gateway's, not a tenant's: one local gateway, one behaviour.
  @Get('settings')
  settings() {
    return this.controls.settings();
  }

  @Post('settings')
  @HttpCode(200)
  configure(@Body() body: unknown) {
    return this.controls.configure(validate(SettingsBody, body ?? {}));
  }
}

@Module({
  imports: [AdaptersModule, PaymentsModule],
  controllers: [FakeGatewayController],
  providers: [FakeGatewayControls],
})
export class FakeGatewayModule {}
