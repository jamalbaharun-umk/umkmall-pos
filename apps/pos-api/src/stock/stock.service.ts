import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/db.module';
import { InjectDb } from '../db/db.module';
import {
  products,
  stockBatches,
  stockMovements,
  type StockReason,
  type StockSource,
} from '../db/schema';

/** A Drizzle transaction: every stock write runs inside the caller's (sale, purchase, opname) transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type Draw = {
  tenantId: string;
  productId: string;
  qty: number;
  refId?: string | null;
  actorId: string;
};

const positiveInt = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new UnprocessableEntityException(`${what} harus bilangan bulat > 0`);
};

/**
 * Stock in batches, drawn FIFO (oldest `received_at` first) under row locks. Ported from Lakasir's
 * StockService with flaw 8 fixed: Lakasir read the batch, then saved an absolute value with no lock.
 * Only `type = 'product'` tracks stock.
 */
@Injectable()
export class StockService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** The tenant's live product, or 404. Not locked: batches carry the locks. */
  private async product(tx: Tx | Db, tenantId: string, productId: string) {
    const [p] = await tx
      .select({ type: products.type, costPrice: products.costPrice })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.id, productId),
          isNull(products.deletedAt),
        ),
      );
    if (!p) throw new NotFoundException('Produk tidak ditemukan');
    return p;
  }

  private async tracked(tx: Tx, tenantId: string, productId: string) {
    const p = await this.product(tx, tenantId, productId);
    if (p.type !== 'product')
      throw new UnprocessableEntityException('Produk ini tidak memakai stok');
    return p;
  }

  /** A new batch plus its ledger row. Source `adjustment` records reason `opname` unless told otherwise. */
  async receive(
    tx: Tx,
    input: {
      tenantId: string;
      productId: string;
      qty: number;
      unitCost: number;
      source: StockSource;
      sourceId?: string | null;
      actorId: string;
      reason?: StockReason;
    },
  ) {
    positiveInt(input.qty, 'Jumlah');
    if (!Number.isSafeInteger(input.unitCost) || input.unitCost < 0)
      throw new UnprocessableEntityException('Harga modal tidak valid');
    await this.tracked(tx, input.tenantId, input.productId);
    const [batch] = await tx
      .insert(stockBatches)
      .values({
        tenantId: input.tenantId,
        productId: input.productId,
        qtyInitial: input.qty,
        qtyRemaining: input.qty,
        unitCost: input.unitCost,
        source: input.source,
        sourceId: input.sourceId ?? null,
      })
      .returning();
    await tx.insert(stockMovements).values({
      tenantId: input.tenantId,
      productId: input.productId,
      batchId: batch.id,
      delta: input.qty,
      reason:
        input.reason ??
        (input.source === 'adjustment' ? 'opname' : input.source),
      refId: input.sourceId ?? null,
      actorId: input.actorId,
    });
    return batch;
  }

  /**
   * Takes `qty` out FIFO and returns its cost. 422 when the locked batches hold less than `qty`.
   * A service or non-stock product draws nothing and costs `cost_price × qty`.
   * Callers consuming several products must call in product-id order (no deadlocks).
   */
  async consume(tx: Tx, input: Draw): Promise<{ costTotal: number }> {
    positiveInt(input.qty, 'Jumlah');
    const p = await this.product(tx, input.tenantId, input.productId);
    if (p.type !== 'product') return { costTotal: p.costPrice * input.qty };
    return this.draw(tx, input, 'sale');
  }

  /** Opname or correction: positive adds a batch at the latest batch cost, negative draws FIFO. */
  async adjust(
    tx: Tx,
    input: Omit<Draw, 'qty'> & { delta: number; reason: StockReason },
  ) {
    if (!Number.isSafeInteger(input.delta) || input.delta === 0)
      throw new UnprocessableEntityException('Selisih stok tidak valid');
    const p = await this.tracked(tx, input.tenantId, input.productId);
    if (input.delta < 0) {
      return this.draw(tx, { ...input, qty: -input.delta }, input.reason);
    }
    const [last] = await tx
      .select({ unitCost: stockBatches.unitCost })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.tenantId, input.tenantId),
          eq(stockBatches.productId, input.productId),
        ),
      )
      .orderBy(desc(stockBatches.receivedAt), desc(stockBatches.id))
      .limit(1);
    const batch = await this.receive(tx, {
      tenantId: input.tenantId,
      productId: input.productId,
      qty: input.delta,
      unitCost: last?.unitCost ?? p.costPrice,
      source: 'adjustment',
      sourceId: input.refId,
      actorId: input.actorId,
      reason: input.reason,
    });
    return { costTotal: batch.unitCost * input.delta };
  }

  private async draw(tx: Tx, input: Draw, reason: StockReason) {
    // FOR UPDATE: a concurrent draw waits here, then re-reads qty_remaining (READ COMMITTED re-check),
    // so two cashiers cannot both take the last unit.
    const batches = await tx
      .select({
        id: stockBatches.id,
        qtyRemaining: stockBatches.qtyRemaining,
        unitCost: stockBatches.unitCost,
      })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.tenantId, input.tenantId),
          eq(stockBatches.productId, input.productId),
          gt(stockBatches.qtyRemaining, 0),
        ),
      )
      .orderBy(asc(stockBatches.receivedAt), asc(stockBatches.id))
      .for('update');

    const available = batches.reduce((n, b) => n + b.qtyRemaining, 0);
    if (available < input.qty)
      throw new UnprocessableEntityException({
        message: 'Stok tidak cukup',
        productId: input.productId,
        available,
      });

    let left = input.qty;
    let costTotal = 0;
    for (const b of batches) {
      if (left === 0) break;
      const take = Math.min(left, b.qtyRemaining);
      await tx
        .update(stockBatches)
        .set({ qtyRemaining: b.qtyRemaining - take })
        .where(eq(stockBatches.id, b.id));
      await tx.insert(stockMovements).values({
        tenantId: input.tenantId,
        productId: input.productId,
        batchId: b.id,
        delta: -take,
        reason,
        refId: input.refId ?? null,
        actorId: input.actorId,
      });
      costTotal += take * b.unitCost;
      left -= take;
    }
    return { costTotal };
  }

  /** On-hand per tracked product id (0 when it has no batches). Untracked products are omitted. */
  async onHand(
    tenantId: string,
    productIds: string[],
    tx: Tx | Db = this.db,
  ): Promise<Record<string, number>> {
    if (productIds.length === 0) return {};
    const rows = await tx
      .select({
        productId: products.id,
        qty: sql<string>`coalesce(sum(${stockBatches.qtyRemaining}), 0)`,
      })
      .from(products)
      .leftJoin(
        stockBatches,
        and(
          eq(stockBatches.productId, products.id),
          eq(stockBatches.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(products.tenantId, tenantId),
          inArray(products.id, productIds),
          eq(products.type, 'product'),
        ),
      )
      .groupBy(products.id);
    return Object.fromEntries(rows.map((r) => [r.productId, Number(r.qty)]));
  }

  /** `GET /stock/products/:id`: on-hand and the batches still holding stock. */
  async productStock(tenantId: string, productId: string) {
    const p = await this.product(this.db, tenantId, productId);
    if (p.type !== 'product')
      return { productId, tracked: false, onHand: null, batches: [] };
    const batches = await this.db
      .select({
        id: stockBatches.id,
        qtyInitial: stockBatches.qtyInitial,
        qtyRemaining: stockBatches.qtyRemaining,
        unitCost: stockBatches.unitCost,
        source: stockBatches.source,
        receivedAt: stockBatches.receivedAt,
      })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.tenantId, tenantId),
          eq(stockBatches.productId, productId),
          gt(stockBatches.qtyRemaining, 0),
        ),
      )
      .orderBy(asc(stockBatches.receivedAt), asc(stockBatches.id));
    const onHand = batches.reduce((n, b) => n + b.qtyRemaining, 0);
    return { productId, tracked: true, onHand, batches };
  }

  /** `GET /stock/products/:id/movements`: the product's latest stock changes (Lakasir's stock history tab). */
  async movements(tenantId: string, productId: string) {
    await this.product(this.db, tenantId, productId);
    return this.db
      .select({
        id: stockMovements.id,
        delta: stockMovements.delta,
        reason: stockMovements.reason,
        createdAt: stockMovements.createdAt,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          eq(stockMovements.productId, productId),
        ),
      )
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(50);
  }

  /** `POST /stock/opening`: once per product (later stock is a purchase or opname, U6). */
  async opening(
    tenantId: string,
    actorId: string,
    input: { productId: string; qty: number; unitCost?: number },
  ) {
    return this.db.transaction(async (tx) => {
      const p = await this.tracked(tx, tenantId, input.productId);
      // Serialize two concurrent openings of one product on the product row.
      await tx.execute(
        sql`select 1 from pos.products where id = ${input.productId} for no key update`,
      );
      const [any] = await tx
        .select({ id: stockBatches.id })
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.tenantId, tenantId),
            eq(stockBatches.productId, input.productId),
          ),
        )
        .limit(1);
      if (any)
        throw new ConflictException(
          'Stok awal sudah dicatat; tambah stok lewat pembelian atau opname',
        );
      return this.receive(tx, {
        tenantId,
        productId: input.productId,
        qty: input.qty,
        unitCost: input.unitCost ?? p.costPrice,
        source: 'opening',
        actorId,
      });
    });
  }
}
