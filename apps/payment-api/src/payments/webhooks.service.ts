import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { WebhookInput, WebhookSignatureError } from '../adapters/adapter';
import { AdapterRegistry } from '../adapters/adapters.module';
import { isUuid } from '../common/validation';
import { Clock, PaymentSettings } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { payments, webhookEvents } from '../db/schema';
import { SettlementService } from './settlement.service';

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 3_600_000;

/**
 * The webhook inbox. A PG notification is verified, stored once per (provider, event id), answered 200, and
 * only then processed. Processing never trusts the notification: it finds OUR payment by the reference and
 * calls `settle`, which asks the PG for the status and the exact amount. The tenant is the payment row's.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly adapters: AdapterRegistry,
    private readonly settlement: SettlementService,
    private readonly settings: PaymentSettings,
    private readonly clock: Clock,
  ) {}

  async receive(provider: string, input: WebhookInput) {
    const adapter = this.adapters.forProvider(provider);
    if (!adapter) throw new NotFoundException();
    let notice;
    try {
      notice = await adapter.handleWebhook(input);
    } catch (error) {
      if (error instanceof WebhookSignatureError)
        throw new UnauthorizedException({
          message: 'Webhook signature does not verify',
          code: 'invalid_signature',
        });
      throw new BadRequestException();
    }
    const [stored] = await this.db
      .insert(webhookEvents)
      .values({
        provider,
        eventId: notice.eventId,
        reference: notice.reference,
        body: input.rawBody.toString('utf8'),
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    // The same event again: answered 200, not processed again.
    if (!stored) return { received: true, duplicate: true };
    // Stored is what the PG needs to know. A failure from here on is ours to retry, not the PG's.
    await this.process(stored.id);
    return { received: true, duplicate: false };
  }

  /** Processes one stored event. Never throws: a failure stays in the inbox for a later try. */
  async process(id: string): Promise<void> {
    const [event] = await this.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, id));
    if (!event || !['received', 'failed', 'unmatched'].includes(event.state))
      return;
    const now = this.clock.now();
    try {
      // The reference must be one of our payment ids, of a method this provider serves.
      const [payment] =
        event.reference && isUuid(event.reference)
          ? await this.db
              .select({
                id: payments.id,
                tenantId: payments.tenantId,
                method: payments.method,
              })
              .from(payments)
              .where(eq(payments.id, event.reference))
          : [];
      if (
        !payment ||
        this.adapters.get(payment.method)?.provider !== event.provider
      ) {
        // Kept and flagged, never dropped: money may be behind it. The reconciliation pairs it later if the
        // payment appears.
        if (event.state !== 'unmatched') {
          await this.db
            .update(webhookEvents)
            .set({ state: 'unmatched', processedAt: now })
            .where(eq(webhookEvents.id, id));
          this.logger.warn(
            `webhook ${event.provider}/${event.id} names no payment of ours`,
          );
        }
        return;
      }
      await this.settlement.settle(payment.id, 'webhook');
      await this.db
        .update(webhookEvents)
        .set({
          state: 'processed',
          tenantId: payment.tenantId,
          paymentId: payment.id,
          processedAt: now,
          nextAttemptAt: null,
        })
        .where(eq(webhookEvents.id, id));
    } catch (error) {
      const attempts = event.attempts + 1;
      const parked = attempts >= this.settings.webhookMaxAttempts;
      await this.db
        .update(webhookEvents)
        .set({
          state: parked ? 'parked' : 'failed',
          attempts,
          nextAttemptAt: parked
            ? null
            : new Date(
                now.getTime() +
                  Math.min(
                    BACKOFF_BASE_MS * 2 ** (attempts - 1),
                    BACKOFF_MAX_MS,
                  ),
              ),
        })
        .where(eq(webhookEvents.id, id));
      // Parked = the alert: an error-level log line a person must look at. The payment itself is still
      // settled by the reconciliation, and other events are not held behind this one.
      if (parked)
        this.logger.error(
          `ALERT webhook ${event.provider}/${event.id} parked after ${attempts} attempts: ${(error as Error).name}`,
        );
      else
        this.logger.warn(
          `webhook ${event.provider}/${event.id} failed (attempt ${attempts}): ${(error as Error).name}`,
        );
    }
  }

  /** Retries events whose delay has passed, and looks again for the payment of unmatched ones. */
  async retryDue(limit = 100): Promise<number> {
    const now = this.clock.now();
    const due = await this.db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(
        or(
          and(
            inArray(webhookEvents.state, ['received', 'failed']),
            or(
              isNull(webhookEvents.nextAttemptAt),
              lte(webhookEvents.nextAttemptAt, now),
            ),
          ),
          // An unknown reference is looked up again for a day (the payment may appear); it is kept after that.
          and(
            eq(webhookEvents.state, 'unmatched'),
            gte(webhookEvents.createdAt, new Date(now.getTime() - 86_400_000)),
          ),
        ),
      )
      .orderBy(asc(webhookEvents.createdAt))
      .limit(limit);
    for (const { id } of due) await this.process(id);
    return due.length;
  }
}
