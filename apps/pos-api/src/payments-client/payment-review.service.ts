import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import { sales, saleVoids } from '../db/schema';
import { saleNumbers } from '../sales/numbers';
import { paymentHttpError } from './sale-payment.service';
import { PaymentsClient } from './payments.client';

const FAILED_REFUNDS_LIMIT = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviewQuery = {
  needsReview?: boolean;
  page: number;
  perPage: number;
};

/**
 * The owner's "Perlu ditinjau" list (UMK-2041): money a payment gateway received that paid no sale (late, a
 * second time, another amount), as payment-api keeps and refunds it, and this store's PG refunds the gateway
 * refused. Read-only: payment-api refunds unmatched money itself, and a refused refund is retried or marked on
 * its sale.
 *
 * The tenant is the caller's session's, for the call to payment-api and for every pos query: an order
 * reference payment-api answers is shown as a sale only when it IS a sale of this store.
 */
@Injectable()
export class PaymentReview {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly client: PaymentsClient,
  ) {}

  async list(tenantId: string, q: ReviewQuery) {
    const failedRefunds = await this.failedRefunds(tenantId);
    if (!this.client.enabled)
      return {
        enabled: false,
        receipts: { items: [], page: q.page, perPage: q.perPage, total: 0 },
        failedRefunds,
      };
    const page = await this.client
      .unmatchedReceipts(tenantId, q)
      .catch((error: unknown) => {
        throw paymentHttpError(error);
      });
    const ids = [
      ...new Set(
        page.items.map((r) => r.orderRef).filter((ref) => UUID.test(ref)),
      ),
    ];
    const rows = ids.length
      ? await this.db
          .select({
            id: sales.id,
            number: sales.number,
            holdNumber: sales.holdNumber,
            status: sales.status,
          })
          .from(sales)
          .where(and(eq(sales.tenantId, tenantId), inArray(sales.id, ids)))
      : [];
    const saleOf = new Map(rows.map((row) => [row.id, row]));
    return {
      enabled: true,
      receipts: {
        items: page.items.map((r) => {
          const sale = saleOf.get(r.orderRef.toLowerCase()) ?? null;
          return {
            id: r.id,
            kind: r.kind,
            amount: r.grossAmount,
            needsReview: r.needsReview,
            refundStatus: r.refundStatus,
            receivedAt: r.createdAt,
            saleId: sale?.id ?? null,
            saleNumber: sale ? saleNumbers(sale).number : null,
            saleStatus: sale?.status ?? null,
          };
        }),
        page: page.page,
        perPage: page.perPage,
        total: page.total,
      },
      failedRefunds,
    };
  }

  /** This store's sales whose PG refund the gateway refused: the owner retries or marks them on the sale. */
  private async failedRefunds(tenantId: string) {
    const rows = await this.db
      .select({
        saleId: sales.id,
        number: sales.number,
        holdNumber: sales.holdNumber,
        amount: sales.total,
        reasonCode: saleVoids.reasonCode,
        requestedAt: saleVoids.createdAt,
      })
      .from(saleVoids)
      .innerJoin(
        sales,
        and(
          eq(sales.tenantId, saleVoids.tenantId),
          eq(sales.id, saleVoids.saleId),
        ),
      )
      .where(
        and(
          eq(saleVoids.tenantId, tenantId),
          eq(saleVoids.refundStatus, 'failed'),
        ),
      )
      .orderBy(desc(saleVoids.createdAt))
      .limit(FAILED_REFUNDS_LIMIT);
    return rows.map((row) => ({
      saleId: row.saleId,
      saleNumber: saleNumbers(row).number,
      amount: row.amount,
      reasonCode: row.reasonCode,
      requestedAt: row.requestedAt,
    }));
  }
}
