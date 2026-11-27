import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { codedError, fieldError } from '../common/validation';
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

  /** The tenant's live product; 404 for a path id, 422 on `productId` for a body (`inBody`). Not locked. */
  private async product(
    tx: Tx | Db,
    tenantId: string,
    productId: string,
    inBody = true,
  ) {
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
    if (!p)
      throw inBody
        ? fieldError('productId', 'Produk tidak ditemukan')
        : new NotFoundException('Produk tidak ditemukan');
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
    if (available < input.qty) {
      const [p] = await tx
        .select({ name: products.name })
        .from(products)
        .where(eq(products.id, input.productId));
      throw new UnprocessableEntityException({
        message: `Stok ${p?.name ?? 'produk'} tidak cukup (sisa ${available})`,
        productId: input.productId,
        available,
      });
    }

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

  /**
   * Puts back what a voided sale drew (UMK-1962): every unit returns to the batch it came from, so it
   * keeps that batch's cost and its place in the FIFO order. The caller holds the sale's row lock and
   * has checked the sale is not voided yet, so this runs once per sale. Batches are locked in the
   * order a sale locks them (product id, then FIFO). A product that draws no stock has nothing to return.
   */
  async restoreSale(
    tx: Tx,
    input: { tenantId: string; saleId: string; actorId: string },
  ): Promise<{ qty: number }> {
    const drawn = await tx
      .select({
        batchId: stockMovements.batchId,
        productId: stockMovements.productId,
        qty: sql<string>`-sum(${stockMovements.delta})`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, input.tenantId),
          eq(stockMovements.refId, input.saleId),
          eq(stockMovements.reason, 'sale'),
        ),
      )
      .groupBy(stockMovements.batchId, stockMovements.productId);
    if (drawn.length === 0) return { qty: 0 };
    const byBatch = new Map(drawn.map((d) => [d.batchId, d]));
    const batches = await tx
      .select({ id: stockBatches.id })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.tenantId, input.tenantId),
          inArray(stockBatches.id, [...byBatch.keys()]),
        ),
      )
      .orderBy(
        asc(stockBatches.productId),
        asc(stockBatches.receivedAt),
        asc(stockBatches.id),
      )
      .for('update');
    let total = 0;
    for (const b of batches) {
      const d = byBatch.get(b.id)!;
      const qty = Number(d.qty);
      await tx
        .update(stockBatches)
        .set({ qtyRemaining: sql`${stockBatches.qtyRemaining} + ${qty}` })
        .where(
          and(
            eq(stockBatches.tenantId, input.tenantId),
            eq(stockBatches.id, b.id),
          ),
        );
      await tx.insert(stockMovements).values({
        tenantId: input.tenantId,
        productId: d.productId,
        batchId: b.id,
        delta: qty,
        reason: 'sale_void',
        refId: input.saleId,
        actorId: input.actorId,
      });
      total += qty;
    }
    return { qty: total };
  }

  /**
   * Sends `qty` units of ONE batch back to its supplier (UMK-1970, purchase return): exactly that batch, under its
   * row lock, so the units leave at the batch's own cost and what was already sold keeps its cost. 422
   * `RETURN_EXCEEDS_BATCH` on `field` when the batch holds less. A caller returning several batches calls in
   * product-id order, the order a sale locks them.
   */
  async returnToSupplier(
    tx: Tx,
    input: {
      tenantId: string;
      batchId: string;
      qty: number;
      refId: string;
      actorId: string;
      field: string;
    },
  ): Promise<{ unitCost: number; productId: string }> {
    positiveInt(input.qty, 'Jumlah');
    const [b] = await tx
      .select({
        productId: stockBatches.productId,
        qtyRemaining: stockBatches.qtyRemaining,
        unitCost: stockBatches.unitCost,
      })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.tenantId, input.tenantId),
          eq(stockBatches.id, input.batchId),
        ),
      )
      .for('update');
    if (!b || b.qtyRemaining < input.qty)
      throw codedError(
        'RETURN_EXCEEDS_BATCH',
        input.field,
        `Jumlah retur melebihi barang yang tersisa di stok batch itu (sisa ${b?.qtyRemaining ?? 0})`,
        { available: b?.qtyRemaining ?? 0 },
      );
    await tx
      .update(stockBatches)
      .set({ qtyRemaining: b.qtyRemaining - input.qty })
      .where(
        and(
          eq(stockBatches.tenantId, input.tenantId),
          eq(stockBatches.id, input.batchId),
        ),
      );
    await tx.insert(stockMovements).values({
      tenantId: input.tenantId,
      productId: b.productId,
      batchId: input.batchId,
      delta: -input.qty,
      reason: 'purchase_return',
      refId: input.refId,
      actorId: input.actorId,
    });
    return { unitCost: b.unitCost, productId: b.productId };
  }

  /**
   * A purchase return undone (UMK-1970): `qty` units back into the batch they left, at that batch's cost, under its
   * row lock. Units sold since do not matter. Refused (`RETURN_UNDO_BATCH_FULL`) only when the batch would hold more
   * than it received, which no normal flow reaches.
   */
  async undoReturnToSupplier(
    tx: Tx,
    input: {
      tenantId: string;
      batchId: string;
      qty: number;
      refId: string;
      actorId: string;
    },
  ): Promise<void> {
    positiveInt(input.qty, 'Jumlah');
    const [b] = await tx
      .select({
        productId: stockBatches.productId,
        qtyInitial: stockBatches.qtyInitial,
        qtyRemaining: stockBatches.qtyRemaining,
      })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.tenantId, input.tenantId),
          eq(stockBatches.id, input.batchId),
        ),
      )
      .for('update');
    if (!b || b.qtyRemaining + input.qty > b.qtyInitial)
      throw codedError(
        'RETURN_UNDO_BATCH_FULL',
        '_',
        'Stok batch pembelian ini tidak bisa menampung barang retur lagi',
      );
    await tx
      .update(stockBatches)
      .set({ qtyRemaining: b.qtyRemaining + input.qty })
      .where(
        and(
          eq(stockBatches.tenantId, input.tenantId),
          eq(stockBatches.id, input.batchId),
        ),
      );
    await tx.insert(stockMovements).values({
      tenantId: input.tenantId,
      productId: b.productId,
      batchId: input.batchId,
      delta: input.qty,
      reason: 'purchase_return_reversal',
      refId: input.refId,
      actorId: input.actorId,
    });
  }

  /** On-hand of one product with its batches locked FOR UPDATE: a concurrent sale waits until the caller commits. */
  async lockedOnHand(tx: Tx, tenantId: string, productId: string) {
    const batches = await tx
      .select({ qty: stockBatches.qtyRemaining })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.tenantId, tenantId),
          eq(stockBatches.productId, productId),
          gt(stockBatches.qtyRemaining, 0),
        ),
      )
      .orderBy(asc(stockBatches.receivedAt), asc(stockBatches.id))
      .for('update');
    return batches.reduce((n, b) => n + b.qty, 0);
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
    const p = await this.product(this.db, tenantId, productId, false);
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
    await this.product(this.db, tenantId, productId, false);
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
