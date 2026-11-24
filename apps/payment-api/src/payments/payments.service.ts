import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { PaymentAdapter, PaymentRef } from '../adapters/adapter';
import { AdapterRegistry } from '../adapters/adapters.module';
import { fieldError, isUuid } from '../common/validation';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { paymentEvents, payments, PaymentStatus } from '../db/schema';
import type { CancelInput, ChargeInput, ListInput } from './payments.schemas';

type PaymentRow = typeof payments.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type CancelOperation = 'cancel' | 'void' | 'refund';

const refusal = (code: string, message: string) =>
  new ConflictException({ message, code });

const notFound = () =>
  new NotFoundException({ message: 'Payment not found', code: 'not_found' });

const toRef = (p: PaymentRow): PaymentRef => ({
  id: p.id,
  tenantId: p.tenantId,
  orderRef: p.orderRef,
  method: p.method,
  amount: p.amount,
  providerRef: p.providerRef,
});

/** What a caller sees. No tenant id (the caller sent it) and no request hash. */
function view(p: PaymentRow, kind: PaymentAdapter['kind'] | null) {
  return {
    id: p.id,
    orderRef: p.orderRef,
    method: p.method,
    kind,
    amount: p.amount,
    status: p.status,
    idempotencyKey: p.idempotencyKey,
    providerRef: p.providerRef,
    paidAt: p.paidAt,
    cancelledAt: p.cancelledAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Every query filters `tenantId`, which only ever comes from the service guard. Another tenant's payment
 * id answers 404, exactly like an id that does not exist.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly adapters: AdapterRegistry,
  ) {}

  /**
   * Creates the payment and charges it. `created` is false when the idempotency key was already used by
   * the same request: the first payment is returned and nothing is charged again.
   */
  async charge(tenantId: string, key: string, input: ChargeInput) {
    const adapter = this.adapters.get(input.method);
    if (!adapter) throw fieldError('method', 'Unknown payment method');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          input.orderRef,
          input.method,
          input.amount,
          input.actorRef,
        ]),
      )
      .digest('hex');

    const claimed = await this.db.transaction(async (tx) => {
      // The insert claims the idempotency key and the order's one live-payment slot; a duplicate (also a
      // concurrent one) inserts nothing.
      const [row] = await tx
        .insert(payments)
        .values({
          tenantId,
          orderRef: input.orderRef,
          method: input.method,
          amount: input.amount,
          status: 'pending',
          idempotencyKey: key,
          requestHash,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) return null;
      await tx.insert(paymentEvents).values({
        tenantId,
        paymentId: row.id,
        type: 'charged',
        actorRef: input.actorRef,
      });
      // CASHAC never calls out, so the payment is settled in the same transaction: no pending row is
      // ever left behind for it.
      if (adapter.kind === 'cashac') return this.settleCharge(tx, row, adapter);
      return row;
    });

    if (!claimed) {
      const [existing] = await this.db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, tenantId),
            eq(payments.idempotencyKey, key),
          ),
        );
      if (!existing)
        throw refusal(
          'order_already_paid',
          'This order already has a pending or paid payment',
        );
      if (existing.requestHash !== requestHash)
        throw refusal(
          'idempotency_key_reused',
          'Idempotency-Key was already used for another request',
        );
      return { created: false, payment: await this.withEvents(existing) };
    }

    // A PG is called only after the pending row is committed, so a crash here leaves a payment that
    // `sync` (getStatus) can resolve. On failure the payment stays pending and the caller retries or syncs.
    const settled =
      adapter.kind === 'cashac'
        ? claimed
        : await this.gateway(() =>
            this.settleCharge(this.db, claimed, adapter),
          );
    return { created: true, payment: await this.withEvents(settled) };
  }

  private async settleCharge(
    db: Db | Tx,
    row: PaymentRow,
    adapter: PaymentAdapter,
  ): Promise<PaymentRow> {
    const result = await adapter.charge(toRef(row));
    return this.applyStatus(db, row, result.status, result.providerRef);
  }

  /** Moves a pending payment to what the adapter reported. A payment no longer pending is left alone. */
  private async applyStatus(
    db: Db | Tx,
    row: PaymentRow,
    status: PaymentStatus,
    providerRef?: string,
  ): Promise<PaymentRow> {
    if (status === 'pending' && providerRef === undefined) return row;
    const now = new Date();
    const [updated] = await db
      .update(payments)
      .set({
        status,
        providerRef: providerRef ?? row.providerRef,
        paidAt: status === 'paid' ? now : row.paidAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(payments.tenantId, row.tenantId),
          eq(payments.id, row.id),
          eq(payments.status, 'pending'),
        ),
      )
      .returning();
    return updated ?? (await this.find(row.tenantId, row.id));
  }

  async get(tenantId: string, id: string) {
    return this.withEvents(await this.find(tenantId, id));
  }

  async list(tenantId: string, q: ListInput) {
    const where = and(
      eq(payments.tenantId, tenantId),
      q.orderRef ? eq(payments.orderRef, q.orderRef) : undefined,
      q.idempotencyKey
        ? eq(payments.idempotencyKey, q.idempotencyKey)
        : undefined,
      q.status ? eq(payments.status, q.status) : undefined,
    );
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(payments)
      .where(where);
    const rows = await this.db
      .select()
      .from(payments)
      .where(where)
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    return {
      items: rows.map((p) =>
        view(p, this.adapters.get(p.method)?.kind ?? null),
      ),
      page: q.page,
      perPage: q.perPage,
      total,
    };
  }

  /** For a pending payment: asks the adapter where it stands and stores the answer. */
  async sync(tenantId: string, id: string) {
    const row = await this.find(tenantId, id);
    if (row.status !== 'pending') return this.withEvents(row);
    const adapter = this.adapterOf(row);
    const updated = await this.gateway(async () => {
      const result = await adapter.getStatus(toRef(row));
      return this.applyStatus(this.db, row, result.status, result.providerRef);
    });
    return this.withEvents(updated);
  }

  /**
   * Cancels a paid payment in full. `cancel` lets payment-api pick: void when the adapter supports it,
   * else refund. `void` and `refund` are refused when the adapter cannot do exactly that.
   */
  async cancel(
    tenantId: string,
    id: string,
    operation: CancelOperation,
    input: CancelInput,
  ) {
    if (!isUuid(id)) throw notFound();
    const updated = await this.db.transaction(async (tx) => {
      // Row lock for the whole cancel: two concurrent cancels produce one adapter call and one audit row.
      const [row] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)))
        .for('update');
      if (!row) throw notFound();
      const adapter = this.adapterOf(row);

      const path =
        operation !== 'cancel'
          ? operation
          : adapter.supportsVoid
            ? 'void'
            : adapter.supportsRefund
              ? 'refund'
              : null;
      if (path === null)
        throw refusal(
          'cancel_not_supported',
          'This payment method can be neither voided nor refunded',
        );
      if (path === 'void' && !adapter.supportsVoid)
        throw refusal(
          'void_not_supported',
          'This payment method cannot be voided; refund it instead',
        );
      if (path === 'refund' && !adapter.supportsRefund)
        throw refusal(
          'refund_not_supported',
          'This payment method cannot be refunded; void it instead',
        );

      const target = path === 'void' ? 'voided' : 'refunded';
      // A retry of a cancel that already happened: the first result, no second call, no second audit row.
      if (row.status === target) return row;
      if (row.status !== 'paid')
        throw refusal(
          'not_cancellable',
          'Only a paid payment can be cancelled',
        );

      await this.gateway(() =>
        path === 'void'
          ? adapter.void(toRef(row), input)
          : adapter.refund(toRef(row), input),
      );
      const now = new Date();
      const [done] = await tx
        .update(payments)
        .set({ status: target, cancelledAt: now, updatedAt: now })
        .where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)))
        .returning();
      await tx.insert(paymentEvents).values({
        tenantId,
        paymentId: id,
        type: target,
        actorRef: input.actorRef,
        approvedBy: input.approvedBy,
        reason: input.reason,
      });
      return done;
    });
    return this.withEvents(updated);
  }

  private async find(tenantId: string, id: string): Promise<PaymentRow> {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)));
    if (!row) throw notFound();
    return row;
  }

  private adapterOf(row: PaymentRow): PaymentAdapter {
    const adapter = this.adapters.get(row.method);
    // A stored method whose adapter was removed from the deploy: a server fault, never a client error.
    if (!adapter) throw new Error('No adapter for a stored payment method');
    return adapter;
  }

  /** An adapter failure (a PG that is down) answers 503 and never leaks the adapter's error. */
  private async gateway<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.error(`adapter call failed: ${(error as Error).name}`);
      throw new ServiceUnavailableException({
        message: 'Payment gateway unavailable',
        code: 'gateway_unavailable',
      });
    }
  }

  private async withEvents(p: PaymentRow) {
    const events = await this.db
      .select({
        type: paymentEvents.type,
        actorRef: paymentEvents.actorRef,
        approvedBy: paymentEvents.approvedBy,
        reason: paymentEvents.reason,
        createdAt: paymentEvents.createdAt,
      })
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.tenantId, p.tenantId),
          eq(paymentEvents.paymentId, p.id),
        ),
      )
      .orderBy(asc(paymentEvents.createdAt), asc(paymentEvents.id));
    return {
      ...view(p, this.adapters.get(p.method)?.kind ?? null),
      events,
    };
  }
}
