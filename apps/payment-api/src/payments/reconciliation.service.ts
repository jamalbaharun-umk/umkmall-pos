import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { Clock, PaymentSettings } from '../config';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { payments, unmatchedReceipts } from '../db/schema';
import { SettlementService } from './settlement.service';
import { CLOSED_UNPAID, IN_FLIGHT } from './transitions';
import { WebhooksService } from './webhooks.service';

/**
 * The last net: nobody has to press anything and no webhook has to arrive. Every tick asks the PG, through
 * `settle`, about each payment still in flight for longer than the threshold (and each refund of unmatched
 * money still on its way), then retries the webhook inbox.
 *
 * It sweeps across tenants on purpose: it is a system job, and each payment's tenant is its own row's.
 * It never voids or cancels anything by itself; a paid CASHAC payment is not touched at all.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settlement: SettlementService,
    private readonly webhooks: WebhooksService,
    private readonly settings: PaymentSettings,
    private readonly clock: Clock,
  ) {}

  onModuleInit() {
    if (this.settings.reconcileIntervalMs <= 0) return;
    this.timer = setInterval(
      () =>
        void this.tick().catch((error) =>
          // The next tick tries again; the failure must be seen. The name only: a message can carry internals.
          this.logger.error(
            `reconciliation tick failed: ${(error as Error).name}`,
          ),
        ),
      this.settings.reconcileIntervalMs,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(limit = 200) {
    if (this.running) return { settled: 0, failed: 0, events: 0 };
    this.running = true;
    try {
      const cutoff = new Date(
        this.clock.now().getTime() - this.settings.reconcileAfterMs,
      );
      // Longest unasked first, so a backlog larger than the limit is still worked through.
      const longestUnasked = sql`${payments.lastSyncedAt} asc nulls first`;
      const inFlight = await this.db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            inArray(payments.status, [...IN_FLIGHT]),
            lte(payments.updatedAt, cutoff),
          ),
        )
        .orderBy(longestUnasked, asc(payments.updatedAt))
        .limit(limit);
      // A closed bill can still take money (a QR the PG could not close, a payment on its way at expiry), and
      // its webhook can be lost. Closed payments are asked about until the bill's expiry plus the margin; the
      // money is then recorded as unmatched and refunded by `settle`. A CASHAC payment is never closed unpaid.
      const stillPayableSince = new Date(
        this.clock.now().getTime() - this.settings.lateSweepMs,
      );
      const closed = await this.db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            inArray(payments.status, [...CLOSED_UNPAID]),
            sql`coalesce(${payments.expiresAt}, ${payments.updatedAt}) >= ${stillPayableSince.toISOString()}::timestamptz`,
            or(
              isNull(payments.lastSyncedAt),
              lte(payments.lastSyncedAt, cutoff),
            ),
          ),
        )
        .orderBy(longestUnasked)
        .limit(limit);
      const refunding = await this.db
        .select({ id: unmatchedReceipts.paymentId })
        .from(unmatchedReceipts)
        .where(
          and(
            eq(unmatchedReceipts.refundStatus, 'pending'),
            lte(unmatchedReceipts.updatedAt, cutoff),
          ),
        )
        .groupBy(unmatchedReceipts.paymentId)
        // Longest waiting first, so the limit never starves the same refunds.
        .orderBy(sql`min(${unmatchedReceipts.updatedAt})`)
        .limit(limit);
      const ids = [
        ...new Set([...inFlight, ...closed, ...refunding].map((r) => r.id)),
      ];
      let settled = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          await this.settlement.settle(id, 'reconciliation');
          settled++;
        } catch (error) {
          // The PG is down for this one; the next tick asks again.
          failed++;
          this.logger.warn(
            `reconciliation could not settle payment ${id}: ${(error as Error).name}`,
          );
        }
      }
      const events = await this.webhooks.retryDue();
      return { settled, failed, events };
    } finally {
      this.running = false;
    }
  }
}
