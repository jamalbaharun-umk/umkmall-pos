import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { WebhookInput, WebhookSignatureError } from '../adapters/adapter';
import { AdapterRegistry } from '../adapters/adapters.module';
import { isUuid } from '../common/validation';
import { Clock, PaymentSettings } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { merchantAccounts, merchantWebhookEvents } from '../db/schema';
import { MerchantsService } from './merchants.service';

/**
 * The inbox of a gateway's account notifications, by the rules of the payment inbox: verified by the adapter,
 * stored once per (provider, event id), answered 200, and only then processed. Processing never trusts the
 * notification: it finds OUR account by the reference and calls `settle`, which asks the gateway for the
 * status. So the same event twice changes nothing, and an old event that arrives late lands on the gateway's
 * current status. The tenant is the account row's. The body is not kept.
 */
@Injectable()
export class MerchantWebhooksService {
  private readonly logger = new Logger(MerchantWebhooksService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly adapters: AdapterRegistry,
    private readonly merchants: MerchantsService,
    private readonly settings: PaymentSettings,
    private readonly clock: Clock,
  ) {}

  async receive(provider: string, input: WebhookInput) {
    const adapter = this.adapters.onboarding(provider);
    if (!adapter) throw new NotFoundException();
    let notice;
    try {
      notice = await adapter.handleAccountWebhook(input);
    } catch (error) {
      if (error instanceof WebhookSignatureError)
        throw new UnauthorizedException({
          message: 'Webhook signature does not verify',
          code: 'invalid_signature',
        });
      throw new BadRequestException();
    }
    const [stored] = await this.db
      .insert(merchantWebhookEvents)
      .values({
        provider,
        eventId: notice.eventId,
        reference: notice.reference,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: merchantWebhookEvents.id });
    // The same event again: answered 200, not processed again.
    if (!stored) return { received: true, duplicate: true };
    await this.process(stored.id);
    return { received: true, duplicate: false };
  }

  /** Processes one stored event. Never throws: a failure stays in the inbox for a later try. */
  async process(id: string): Promise<void> {
    const [event] = await this.db
      .select()
      .from(merchantWebhookEvents)
      .where(eq(merchantWebhookEvents.id, id));
    if (!event || !['received', 'failed'].includes(event.state)) return;
    const now = this.clock.now();
    const [account] =
      event.reference && isUuid(event.reference)
        ? await this.db
            .select({
              id: merchantAccounts.id,
              tenantId: merchantAccounts.tenantId,
            })
            .from(merchantAccounts)
            .where(
              and(
                eq(merchantAccounts.id, event.reference),
                eq(merchantAccounts.provider, event.provider),
              ),
            )
        : [];
    if (!account) {
      await this.db
        .update(merchantWebhookEvents)
        .set({ state: 'unmatched', processedAt: now })
        .where(eq(merchantWebhookEvents.id, id));
      this.logger.warn(
        `account webhook ${event.provider}/${event.id} names no account of ours`,
      );
      return;
    }
    try {
      await this.merchants.settle(account.id, 'webhook');
      await this.db
        .update(merchantWebhookEvents)
        .set({
          state: 'processed',
          tenantId: account.tenantId,
          merchantAccountId: account.id,
          processedAt: now,
        })
        .where(eq(merchantWebhookEvents.id, id));
    } catch (error) {
      await this.db
        .update(merchantWebhookEvents)
        .set({
          state: 'failed',
          tenantId: account.tenantId,
          merchantAccountId: account.id,
          attempts: event.attempts + 1,
        })
        .where(eq(merchantWebhookEvents.id, id));
      this.logger.warn(
        `account webhook ${event.provider}/${event.id} failed (attempt ${event.attempts + 1}): ${(error as Error).name}`,
      );
    }
  }

  /** Retries events not yet processed, up to the configured number of attempts each. */
  async retryDue(limit = 100): Promise<number> {
    const due = await this.db
      .select({ id: merchantWebhookEvents.id })
      .from(merchantWebhookEvents)
      .where(
        and(
          inArray(merchantWebhookEvents.state, ['received', 'failed']),
          lt(merchantWebhookEvents.attempts, this.settings.webhookMaxAttempts),
        ),
      )
      .orderBy(asc(merchantWebhookEvents.createdAt))
      .limit(limit);
    for (const { id } of due) await this.process(id);
    return due.length;
  }
}
